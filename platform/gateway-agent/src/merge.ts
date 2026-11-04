/**
 * Merge on-device edge vitals (tier 2) with sensing-server classification into
 * one NodeSample. Rules (documented in docs/ARCHITECTURE.md §6):
 *   presence      edge flag if fresh, else server classification
 *   motion_level  server classification if fresh, else derived from edge motion flag;
 *                 forced to 'absent' when not present and ≥ 'present_still' when present
 *   persons       edge n_persons ∨ server estimate (≥ 1 when present)
 *   no fresh source ⇒ no sample (the cloud marks the room "no data", never "empty")
 */
import type { NodeSample } from '@ruview/shared/protocol';
import type { NodeRegistry } from './nodeRegistry';
import type { SensingClient } from './sensingClient';

export function buildSample(nodeId: number, reg: NodeRegistry, sensing: SensingClient, vitalsEnabled: boolean, now = Date.now()): NodeSample | null {
  const edge = reg.freshVitals(nodeId);
  const server = sensing.isLive() ? sensing.node(nodeId) : null;
  if (!edge && !server) return null;
  const obs = reg.get(nodeId);

  const presence = edge ? edge.presence : server!.presence;
  let motion: NodeSample['motion_level'];
  if (server) motion = server.motionLevel;
  else motion = edge!.motion ? 'present_moving' : edge!.presence ? 'present_still' : 'absent';
  if (!presence) motion = 'absent';
  else if (motion === 'absent') motion = 'present_still';

  const persons = presence ? Math.max(1, Math.min(16, edge?.persons || server?.personCount || 1)) : 0;
  const csiRate = reg.rate(nodeId, 'csi');

  const sample: NodeSample = {
    node_id: nodeId,
    observed_at: new Date(Math.max(edge?.receivedAt ?? 0, server?.receivedAt ?? 0) || now).toISOString(),
    presence,
    motion_level: motion,
    person_count: persons,
    motion_energy: edge ? edge.motionEnergy : null,
    presence_score: edge ? edge.presenceScore : null,
    confidence: server?.confidence ?? null,
    rssi: obs?.rssi ?? null,
    frame_rate: csiRate > 0 ? Math.round(csiRate * 10) / 10 : (server?.frameRateHz ?? null),
    source: edge && server ? 'merged' : edge ? 'edge' : 'server',
  };
  if (vitalsEnabled && edge && presence && (edge.breathingBpm > 0 || edge.heartBpm > 0)) {
    sample.vitals = {
      breathing_bpm: edge.breathingBpm > 0 && edge.breathingBpm <= 120 ? round1(edge.breathingBpm) : null,
      heart_bpm: edge.heartBpm > 0 && edge.heartBpm <= 250 ? round1(edge.heartBpm) : null,
      source: edge.kind === 'fused' ? 'mmwave' : 'edge',
    };
  }
  if (edge?.kind === 'fused' && edge.mmwave) {
    sample.extra = { mmwave_present: edge.mmwave.present, mmwave_distance_cm: edge.mmwave.distanceCm, mmwave_targets: edge.mmwave.targets };
  }
  return sample;
}

const round1 = (n: number) => Math.round(n * 10) / 10;
