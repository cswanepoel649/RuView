import { describe, expect, it } from 'vitest';
import { HeartbeatRequest, TelemetryRequest, EventsRequest, normaliseEnrollmentCode, GatewayCommand } from '../src/protocol';

describe('gateway protocol schemas', () => {
  it('accepts a valid telemetry batch and rejects forged fields', () => {
    const ok = TelemetryRequest.parse({ samples: [{ node_id: 1, observed_at: new Date().toISOString(), presence: true,
      motion_level: 'present_still', person_count: 1, source: 'edge', rssi: -60 }] });
    expect(ok.minutes).toEqual([]);
    expect(() => TelemetryRequest.parse({ samples: [{ node_id: 999, observed_at: 'x', presence: 1 }] })).toThrow();
    expect(() => TelemetryRequest.parse({ samples: [{ node_id: 1, observed_at: new Date().toISOString(), presence: true,
      motion_level: 'present_still', person_count: 1, source: 'edge', confidence: 3 }] })).toThrow();
  });
  it('only allows edge-originated event kinds from gateways', () => {
    expect(() => EventsRequest.parse({ events: [{ type: 'intrusion_detected', node_id: 1, occurred_at: new Date().toISOString(), dedupe_key: 'x' }] })).toThrow();
  });
  it('validates heartbeat node reports', () => {
    expect(() => HeartbeatRequest.parse({ agent_version: '1', uptime_s: 1, lan_ips: ['10.0.0.300'], sensing: { reachable: true, source: 'esp32' }, nodes: [] })).toThrow();
    const hb = HeartbeatRequest.parse({ agent_version: '1', uptime_s: 1, lan_ips: ['10.0.0.3'], sensing: { reachable: true, source: 'esp32' },
      nodes: [{ node_id: 1, ip: '10.0.0.9', mac: 'aa:bb:cc:dd:ee:ff', last_seen_ms: 10, packets_per_s: 21, packet_types: { csi: 20, vitals: 1 } }] });
    expect(hb.protocol).toBe(1);
  });
  it('normalises enrollment codes', () => {
    expect(normaliseEnrollmentCode('ab12cd34ef56')).toBe('AB12-CD34-EF56');
  });
  it('parses OTA commands strictly', () => {
    expect(() => GatewayCommand.parse({ id: crypto.randomUUID(), device_id: crypto.randomUUID(), attempt: 1, node_id: 1, node_ip: '1.1.1.1',
      type: 'ota_update', payload: { release_id: crypto.randomUUID(), version: '1', url: 'https://x/y', sha256: 'zz', size: 1, psk: 'a'.repeat(64) } })).toThrow();
  });
});
