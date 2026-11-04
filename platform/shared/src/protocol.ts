/**
 * Gateway ⇄ cloud wire protocol (v1). Single source of truth for both the
 * Next.js ingest routes (validation at the system boundary) and ruview-agent.
 */
import { z } from 'zod';

export const PROTOCOL_VERSION = 1 as const;
export const GATEWAY_API_PREFIX = '/api/gateway/v1' as const;

const ipv4 = z.string().regex(/^(25[0-5]|2[0-4]\d|1\d\d|[1-9]?\d)(\.(25[0-5]|2[0-4]\d|1\d\d|[1-9]?\d)){3}$/);
const mac = z.string().regex(/^[0-9a-f]{2}(:[0-9a-f]{2}){5}$/);
const isoTime = z.iso.datetime({ offset: true });
const nodeId = z.int().min(0).max(255);
const finiteNum = z.number().refine(Number.isFinite, 'must be finite');

export const MotionLevel = z.enum(['absent', 'present_still', 'present_moving', 'active']);
export type MotionLevel = z.infer<typeof MotionLevel>;

export const SampleSource = z.enum(['edge', 'server', 'merged']);

export const Vitals = z.object({
  breathing_bpm: finiteNum.min(0).max(120).nullable(),
  heart_bpm: finiteNum.min(0).max(250).nullable(),
  source: z.enum(['edge', 'mmwave', 'server']),
});

export const NodeSample = z.object({
  node_id: nodeId,
  observed_at: isoTime,
  presence: z.boolean(),
  motion_level: MotionLevel,
  person_count: z.int().min(0).max(16),
  motion_energy: finiteNum.nullable().optional(),
  presence_score: finiteNum.nullable().optional(),
  confidence: finiteNum.min(0).max(1).nullable().optional(),
  rssi: z.int().min(-127).max(0).nullable().optional(),
  frame_rate: finiteNum.min(0).max(1000).nullable().optional(),
  source: SampleSource,
  vitals: Vitals.nullable().optional(),
  extra: z.record(z.string(), z.unknown()).optional(),
});
export type NodeSample = z.infer<typeof NodeSample>;

export const MinuteBucket = z.object({
  node_id: nodeId,
  bucket: isoTime,
  samples: z.int().min(0).max(100000),
  presence_ratio: finiteNum.min(0).max(1),
  max_persons: z.int().min(0).max(16),
  avg_motion_energy: finiteNum.nullable().optional(),
  max_motion_energy: finiteNum.nullable().optional(),
  active_ratio: finiteNum.min(0).max(1).nullable().optional(),
  avg_rssi: finiteNum.nullable().optional(),
  avg_frame_rate: finiteNum.nullable().optional(),
  avg_breathing_bpm: finiteNum.nullable().optional(),
  avg_heart_bpm: finiteNum.nullable().optional(),
});
export type MinuteBucket = z.infer<typeof MinuteBucket>;

export const TelemetryRequest = z.object({
  samples: z.array(NodeSample).max(500).default([]),
  minutes: z.array(MinuteBucket).max(2000).default([]),
});
export type TelemetryRequest = z.infer<typeof TelemetryRequest>;

export const TelemetryResponse = z.object({
  accepted: z.int(),
  minutes: z.int(),
  rejected: z.int(),
  unknown_nodes: z.array(z.int()),
});
export type TelemetryResponse = z.infer<typeof TelemetryResponse>;

export const EdgeEvent = z.object({
  type: z.literal('fall_detected'),
  node_id: nodeId,
  occurred_at: isoTime,
  dedupe_key: z.string().min(1).max(120),
  data: z.record(z.string(), z.unknown()).optional(),
});
export type EdgeEvent = z.infer<typeof EdgeEvent>;

export const EventsRequest = z.object({ events: z.array(EdgeEvent).max(200) });
export type EventsRequest = z.infer<typeof EventsRequest>;

export const NodeReport = z.object({
  node_id: nodeId,
  ip: ipv4.nullable().optional(),
  mac: mac.nullable().optional(),
  last_seen_ms: z.int().min(0),
  packets_per_s: finiteNum.min(0),
  packet_types: z.record(z.string(), z.int().min(0)),
  rssi: z.int().min(-127).max(0).nullable().optional(),
  edge_tier_observed: z.int().min(0).max(2).nullable().optional(),
  firmware_version: z.string().max(64).nullable().optional(),
  ota: z.object({
    reachable: z.boolean(),
    version: z.string().max(64).nullable().optional(),
    running_partition: z.string().max(32).nullable().optional(),
    checked_at: isoTime,
  }).nullable().optional(),
});
export type NodeReport = z.infer<typeof NodeReport>;

export const HeartbeatRequest = z.object({
  protocol: z.literal(PROTOCOL_VERSION).default(PROTOCOL_VERSION),
  agent_version: z.string().max(32),
  uptime_s: z.int().min(0),
  lan_ips: z.array(ipv4).max(8),
  sensing: z.object({
    reachable: z.boolean(),
    source: z.string().max(32).nullable(),
    tick: z.int().nullable().optional(),
    clients: z.int().nullable().optional(),
    error: z.string().max(500).nullable().optional(),
  }),
  system: z.object({
    hostname: z.string().max(128).optional(),
    platform: z.string().max(64).optional(),
    load1: finiteNum.optional(),
    mem_free_mb: finiteNum.optional(),
    mem_total_mb: finiteNum.optional(),
    disk_free_mb: finiteNum.nullable().optional(),
    cpu_temp_c: finiteNum.nullable().optional(),
  }).optional(),
  buffer: z.object({ pending_minutes: z.int().min(0), pending_events: z.int().min(0) }).optional(),
  nodes: z.array(NodeReport).max(64),
});
export type HeartbeatRequest = z.infer<typeof HeartbeatRequest>;

export const OtaPayload = z.object({
  release_id: z.uuid(),
  version: z.string(),
  url: z.url(),
  sha256: z.string().regex(/^[0-9a-f]{64}$/),
  size: z.int().positive(),
  psk: z.string().min(32).max(64),
});

const CommandBase = z.object({
  id: z.uuid(),
  device_id: z.uuid(),
  attempt: z.int(),
  node_id: nodeId.nullable(),
  node_ip: z.string().nullable(),
});
export const GatewayCommand = z.discriminatedUnion('type', [
  CommandBase.extend({ type: z.literal('ota_update'), payload: OtaPayload }),
  CommandBase.extend({ type: z.literal('probe_node'), payload: z.object({}).passthrough() }),
  CommandBase.extend({ type: z.literal('restart_agent'), payload: z.object({}).passthrough() }),
]);
export type GatewayCommand = z.infer<typeof GatewayCommand>;

export const HeartbeatResponse = z.object({
  server_time: isoTime,
  property_id: z.uuid().nullable(),
  config: z.object({
    telemetry_interval_s: z.int().min(1).max(300),
    heartbeat_interval_s: z.int().min(5).max(600),
    vitals_enabled: z.boolean(),
  }),
  node_map: z.array(z.object({
    node_id: nodeId,
    device_id: z.uuid(),
    room_id: z.uuid().nullable(),
    name: z.string(),
    hw_id: z.string().nullable(),
  })),
  commands: z.array(GatewayCommand),
});
export type HeartbeatResponse = z.infer<typeof HeartbeatResponse>;

export const CommandResult = z.object({
  success: z.boolean(),
  result: z.record(z.string(), z.unknown()).optional(),
  error: z.string().max(2000).optional(),
});
export type CommandResult = z.infer<typeof CommandResult>;

export const EnrollRequest = z.object({
  enrollment_code: z.string().regex(/^[A-Z0-9]{4}-?[A-Z0-9]{4}-?[A-Z0-9]{4}$/),
  hw_id: z.string().min(8).max(128).regex(/^[A-Za-z0-9._:-]+$/),
  hostname: z.string().max(128),
  agent_version: z.string().max(32),
  platform: z.string().max(64),
});
export type EnrollRequest = z.infer<typeof EnrollRequest>;

export const EnrollResponse = z.object({
  gateway_id: z.uuid(),
  property_id: z.uuid().nullable(),
  token: z.string().startsWith('gw_'),
});
export type EnrollResponse = z.infer<typeof EnrollResponse>;

/** Normalise an enrollment code to XXXX-XXXX-XXXX. */
export function normaliseEnrollmentCode(code: string): string {
  const c = code.toUpperCase().replace(/[^A-Z0-9]/g, '');
  return `${c.slice(0, 4)}-${c.slice(4, 8)}-${c.slice(8, 12)}`;
}
