import { describe, expect, it } from 'vitest';
import {
  decodePacket, decodeCsiFrame, decodeFusedOrWasm, decodeVitals, encodeCsiFrame, encodeFusedVitals,
  encodeVitals, encodeWasmOutput, MAGIC,
} from '../src/esp32/packets';

const vitals = { nodeId: 7, presence: true, fall: true, motion: false, breathingBpm: 14.25, heartBpm: 72.5,
  rssi: -61, persons: 2, motionEnergy: 0.375, presenceScore: 1.5, timestampMs: 123456 };

describe('ESP32 packet codecs', () => {
  it('decodes CSI header with firmware offsets (seq@12, rssi@16)', () => {
    const buf = encodeCsiFrame({ nodeId: 3, subcarriers: 64, freqMhz: 2437, sequence: 0x01020304, rssi: -48, noiseFloor: -92 });
    const h = decodeCsiFrame(buf)!;
    expect(h).toMatchObject({ nodeId: 3, subcarriers: 64, freqMhz: 2437, sequence: 0x01020304, rssi: -48, noiseFloor: -92, iqBytes: 128 });
    // the sensing-server bug would read rssi from byte 14 (part of the sequence)
    expect(buf[14]).not.toBe(256 - 48);
  });
  it('rejects truncated CSI frames', () => {
    const buf = encodeCsiFrame({ nodeId: 1, subcarriers: 64, freqMhz: 2412, sequence: 1, rssi: -50, noiseFloor: -90 });
    expect(decodeCsiFrame(buf.subarray(0, 60))).toBeNull();
  });
  it('round-trips the 32-byte vitals packet', () => {
    const v = decodeVitals(encodeVitals(vitals))!;
    expect(v.kind).toBe('vitals');
    expect(v).toMatchObject({ ...vitals });
  });
  it('distinguishes fused vitals from WASM output sharing magic 0xC5110004', () => {
    const fused = decodeFusedOrWasm(encodeFusedVitals({ ...vitals, mmwave: { present: true, type: 2, fusionConfidence: 80,
      heartBpm: 70, breathingBpm: 15, distanceCm: 140, targets: 1, confidence: 80 } }))!;
    expect(fused.kind).toBe('fused');
    if (fused.kind === 'fused') {
      expect(fused.presence).toBe(true);
      expect(fused.mmwave?.distanceCm).toBe(140);
      expect(fused.mmwave?.present).toBe(true);
    }
    const wasm = decodeFusedOrWasm(encodeWasmOutput(7, 1, [{ type: 3, value: 0.5 }, { type: 9, value: -1 }]))!;
    expect(wasm).toEqual({ kind: 'wasm', nodeId: 7, moduleId: 1, events: [{ type: 3, value: 0.5 }, { type: 9, value: -1 }] });
    // 8-event WASM packet is also 48 bytes — must still be WASM
    const eight = decodeFusedOrWasm(encodeWasmOutput(7, 1, Array.from({ length: 8 }, (_, i) => ({ type: i, value: i }))))!;
    expect(eight.kind).toBe('wasm');
  });
  it('ignores unknown or malformed datagrams', () => {
    expect(decodePacket(new Uint8Array([1, 2, 3]))).toBeNull();
    expect(decodePacket(new Uint8Array(32))).toBeNull();
    const bad = encodeVitals(vitals).subarray(0, 31);
    expect(decodePacket(bad)).toBeNull();
    const nan = encodeVitals({ ...vitals, motionEnergy: NaN });
    expect(decodeVitals(nan)!.motionEnergy).toBe(0);
  });
  it('exposes magic constants', () => {
    expect(MAGIC.VITALS).toBe(0xc5110002);
  });
});
