/**
 * Decoders for UDP datagrams emitted by RuView `esp32-csi-node` firmware.
 * Layouts verified against firmware sources (not the sensing-server parser,
 * which has known offset bugs — see platform/docs/ARCHITECTURE.md §1.3 L1/L2):
 *   0xC5110001 csi_collector.c csi_serialize_frame()
 *   0xC5110002 edge_processing.h edge_vitals_pkt_t (32 B)
 *   0xC5110003 edge_processing.h edge_feature_pkt_t (48 B)
 *   0xC5110004 edge_processing.h edge_fused_vitals_pkt_t (48 B)  — mmWave nodes
 *   0xC5110007 wasm_runtime.h WASM output (8 + 5n B)              — current firmware (#928)
 *   0xC5110004 WASM output on firmware ≤ v0.6.x (shared fused-vitals magic; disambiguated by layout)
 *   0xC5110005 compressed CSI, 0xC5110006 ADR-081 feature state  (counted, not decoded)
 */

export const MAGIC = {
  CSI_FRAME: 0xc5110001,
  VITALS: 0xc5110002,
  FEATURES: 0xc5110003,
  FUSED_OR_WASM: 0xc5110004,
  WASM_OUTPUT: 0xc5110007,
  COMPRESSED: 0xc5110005,
  FEATURE_STATE: 0xc5110006,
} as const;

export interface CsiFrameHeader {
  kind: 'csi';
  nodeId: number;
  antennas: number;
  subcarriers: number;
  freqMhz: number;
  sequence: number;
  rssi: number;
  noiseFloor: number;
  iqBytes: number;
}

export interface EdgeVitals {
  kind: 'vitals' | 'fused';
  nodeId: number;
  presence: boolean;
  fall: boolean;
  motion: boolean;
  breathingBpm: number;
  heartBpm: number;
  rssi: number;
  persons: number;
  motionEnergy: number;
  presenceScore: number;
  timestampMs: number;
  mmwave?: {
    present: boolean;
    type: number;
    fusionConfidence: number;
    heartBpm: number;
    breathingBpm: number;
    distanceCm: number;
    targets: number;
    confidence: number;
  };
}

export interface WasmOutput {
  kind: 'wasm';
  nodeId: number;
  moduleId: number;
  events: { type: number; value: number }[];
}

export interface FeatureVector {
  kind: 'features';
  nodeId: number;
  seq: number;
  timestampUs: bigint;
  features: number[];
}

export interface OtherPacket {
  kind: 'compressed' | 'feature_state';
  nodeId: number;
}

export type DecodedPacket = CsiFrameHeader | EdgeVitals | WasmOutput | FeatureVector | OtherPacket;

function dv(buf: Uint8Array) {
  return new DataView(buf.buffer, buf.byteOffset, buf.byteLength);
}

export function packetMagic(buf: Uint8Array): number | null {
  return buf.length >= 4 ? dv(buf).getUint32(0, true) : null;
}

function finite(n: number): number {
  return Number.isFinite(n) ? n : 0;
}

export function decodeCsiFrame(buf: Uint8Array): CsiFrameHeader | null {
  if (buf.length < 20 || packetMagic(buf) !== MAGIC.CSI_FRAME) return null;
  const d = dv(buf);
  const antennas = d.getUint8(5) || 1;
  const subcarriers = d.getUint16(6, true);
  const iqBytes = buf.length - 20;
  if (iqBytes < antennas * subcarriers * 2) return null;
  return {
    kind: 'csi',
    nodeId: d.getUint8(4),
    antennas,
    subcarriers,
    freqMhz: d.getUint32(8, true),
    sequence: d.getUint32(12, true),
    rssi: d.getInt8(16),
    noiseFloor: d.getInt8(17),
    iqBytes,
  };
}

function decodeVitalsCommon(buf: Uint8Array, kind: 'vitals' | 'fused'): EdgeVitals {
  const d = dv(buf);
  const flags = d.getUint8(5);
  return {
    kind,
    nodeId: d.getUint8(4),
    presence: (flags & 0x01) !== 0,
    fall: (flags & 0x02) !== 0,
    motion: (flags & 0x04) !== 0,
    breathingBpm: d.getUint16(6, true) / 100,
    heartBpm: d.getUint32(8, true) / 10000,
    rssi: d.getInt8(12),
    persons: d.getUint8(13),
    motionEnergy: finite(d.getFloat32(16, true)),
    presenceScore: finite(d.getFloat32(20, true)),
    timestampMs: d.getUint32(24, true),
  };
}

export function decodeVitals(buf: Uint8Array): EdgeVitals | null {
  if (buf.length !== 32 || packetMagic(buf) !== MAGIC.VITALS) return null;
  return decodeVitalsCommon(buf, 'vitals');
}

/**
 * 0xC5110004 is used by both fused vitals (48 bytes) and WASM output (8 + 5·n).
 * A 48-byte WASM packet would carry exactly 8 events, i.e. u16@6 == 8, which as
 * a fused packet would mean a breathing rate of 0.08 BPM — not a real reading.
 */
export function decodeFusedOrWasm(buf: Uint8Array): EdgeVitals | WasmOutput | null {
  if (buf.length < 8 || packetMagic(buf) !== MAGIC.FUSED_OR_WASM) return null;
  const d = dv(buf);
  const count = d.getUint16(6, true);
  const looksWasm = buf.length === 8 + 5 * count;
  if (buf.length === 48 && !(looksWasm && count === 8)) {
    const v = decodeVitalsCommon(buf, 'fused');
    v.mmwave = {
      present: (d.getUint8(5) & 0x08) !== 0,
      type: d.getUint8(14),
      fusionConfidence: d.getUint8(15),
      heartBpm: finite(d.getFloat32(28, true)),
      breathingBpm: finite(d.getFloat32(32, true)),
      distanceCm: finite(d.getFloat32(36, true)),
      targets: d.getUint8(40),
      confidence: d.getUint8(41),
    };
    return v;
  }
  if (!looksWasm) return null;
  return parseWasm(buf);
}

/** WASM output packet (0xC5110007 on current firmware). */
export function decodeWasmOutput(buf: Uint8Array): WasmOutput | null {
  if (buf.length < 8 || packetMagic(buf) !== MAGIC.WASM_OUTPUT) return null;
  const count = dv(buf).getUint16(6, true);
  return buf.length === 8 + 5 * count ? parseWasm(buf) : null;
}

function parseWasm(buf: Uint8Array): WasmOutput {
  const d = dv(buf);
  const count = d.getUint16(6, true);
  const events: WasmOutput['events'] = [];
  for (let i = 0; i < count; i++) {
    const o = 8 + i * 5;
    events.push({ type: d.getUint8(o), value: finite(d.getFloat32(o + 1, true)) });
  }
  return { kind: 'wasm', nodeId: d.getUint8(4), moduleId: d.getUint8(5), events };
}

export function decodeFeatureVector(buf: Uint8Array): FeatureVector | null {
  if (buf.length !== 48 || packetMagic(buf) !== MAGIC.FEATURES) return null;
  const d = dv(buf);
  const features: number[] = [];
  for (let i = 0; i < 8; i++) features.push(finite(d.getFloat32(16 + i * 4, true)));
  return { kind: 'features', nodeId: d.getUint8(4), seq: d.getUint16(6, true), timestampUs: d.getBigInt64(8, true), features };
}

/** Decode any known packet; returns null for unknown/malformed datagrams. */
export function decodePacket(buf: Uint8Array): DecodedPacket | null {
  switch (packetMagic(buf)) {
    case MAGIC.CSI_FRAME: return decodeCsiFrame(buf);
    case MAGIC.VITALS: return decodeVitals(buf);
    case MAGIC.FUSED_OR_WASM: return decodeFusedOrWasm(buf);
    case MAGIC.WASM_OUTPUT: return decodeWasmOutput(buf);
    case MAGIC.FEATURES: return decodeFeatureVector(buf);
    case MAGIC.COMPRESSED: return buf.length >= 5 ? { kind: 'compressed', nodeId: buf[4]! } : null;
    case MAGIC.FEATURE_STATE: return buf.length >= 5 ? { kind: 'feature_state', nodeId: buf[4]! } : null;
    default: return null;
  }
}

// ---------------------------------------------------------------------------
// Encoders — used by tests and the gateway agent's self-test only. The
// platform never fabricates sensor data; these build byte-exact firmware
// packets so the decode path can be verified without hardware.
// ---------------------------------------------------------------------------
export function encodeVitals(v: Omit<EdgeVitals, 'kind' | 'mmwave'>): Uint8Array {
  const b = new Uint8Array(32);
  const d = dv(b);
  d.setUint32(0, MAGIC.VITALS, true);
  d.setUint8(4, v.nodeId);
  d.setUint8(5, (v.presence ? 1 : 0) | (v.fall ? 2 : 0) | (v.motion ? 4 : 0));
  d.setUint16(6, Math.round(v.breathingBpm * 100), true);
  d.setUint32(8, Math.round(v.heartBpm * 10000), true);
  d.setInt8(12, v.rssi);
  d.setUint8(13, v.persons);
  d.setFloat32(16, v.motionEnergy, true);
  d.setFloat32(20, v.presenceScore, true);
  d.setUint32(24, v.timestampMs >>> 0, true);
  return b;
}

export function encodeCsiFrame(h: { nodeId: number; subcarriers: number; freqMhz: number; sequence: number; rssi: number; noiseFloor: number }): Uint8Array {
  const b = new Uint8Array(20 + h.subcarriers * 2);
  const d = dv(b);
  d.setUint32(0, MAGIC.CSI_FRAME, true);
  d.setUint8(4, h.nodeId);
  d.setUint8(5, 1);
  d.setUint16(6, h.subcarriers, true);
  d.setUint32(8, h.freqMhz, true);
  d.setUint32(12, h.sequence >>> 0, true);
  d.setInt8(16, h.rssi);
  d.setInt8(17, h.noiseFloor);
  return b;
}

export function encodeFusedVitals(v: Omit<EdgeVitals, 'kind'>): Uint8Array {
  const b = new Uint8Array(48);
  b.set(encodeVitals(v), 0);
  const d = dv(b);
  d.setUint32(0, MAGIC.FUSED_OR_WASM, true);
  const m = v.mmwave;
  if (m) {
    d.setUint8(5, d.getUint8(5) | (m.present ? 0x08 : 0));
    d.setUint8(14, m.type);
    d.setUint8(15, m.fusionConfidence);
    d.setFloat32(28, m.heartBpm, true);
    d.setFloat32(32, m.breathingBpm, true);
    d.setFloat32(36, m.distanceCm, true);
    d.setUint8(40, m.targets);
    d.setUint8(41, m.confidence);
  }
  // timestamp lives at 24 in both layouts; reserved fields stay zero
  return b;
}

export function encodeWasmOutput(nodeId: number, moduleId: number, events: { type: number; value: number }[], magic: number = MAGIC.WASM_OUTPUT): Uint8Array {
  const b = new Uint8Array(8 + events.length * 5);
  const d = dv(b);
  d.setUint32(0, magic, true);
  d.setUint8(4, nodeId);
  d.setUint8(5, moduleId);
  d.setUint16(6, events.length, true);
  events.forEach((e, i) => {
    d.setUint8(8 + i * 5, e.type);
    d.setFloat32(9 + i * 5, e.value, true);
  });
  return b;
}
