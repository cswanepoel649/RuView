import { describe, expect, it } from 'vitest';
import { roomShare, slotSeries, weekHeatmap } from '../src/lib/analytics';

describe('analytics', () => {
  it('bucketing keeps gaps as null and uses max across nodes', () => {
    const from = new Date('2026-01-05T10:00:00Z');
    const rows = [
      { device_id: 'a', room_id: 'r', bucket: '2026-01-05T10:00:00Z', presence_ratio: 0.2, max_persons: 1, avg_motion_energy: null },
      { device_id: 'b', room_id: 'r', bucket: '2026-01-05T10:00:00Z', presence_ratio: 1, max_persons: 1, avg_motion_energy: null },
      { device_id: 'a', room_id: 'r', bucket: '2026-01-05T10:01:00Z', presence_ratio: 0, max_persons: 0, avg_motion_energy: null },
    ];
    const s = slotSeries(rows, from, new Date('2026-01-05T11:00:00Z'), 30, 'UTC');
    expect(s).toHaveLength(2);
    expect(s[0]!.value).toBe(50);
    expect(s[1]!.value).toBeNull();
    expect(s[0]!.label).toBe('10:00');
  });
  it('respects property timezone', () => {
    const s = slotSeries([], new Date('2026-01-05T22:00:00Z'), new Date('2026-01-05T23:00:00Z'), 60, 'Africa/Johannesburg');
    expect(s[0]!.label).toBe('00:00');
  });
  it('heatmap is Monday-first in local time', () => {
    // 2026-01-05 is a Monday; 23:30 UTC = Tuesday 01:30 in Johannesburg
    const h = weekHeatmap([{ room_id: 'r', hour: '2026-01-05T23:00:00Z', occupied_ratio: 0.5, max_persons: 1, minutes: 60 }], 'Africa/Johannesburg');
    expect(h).toEqual([{ day: 1, hour: 1, value: 50 }]);
  });
  it('room share is minute-weighted', () => {
    const m = roomShare([
      { room_id: 'r', hour: 'x', occupied_ratio: 1, max_persons: 1, minutes: 30 },
      { room_id: 'r', hour: 'y', occupied_ratio: 0, max_persons: 0, minutes: 90 },
    ]);
    expect(m.get('r')).toBe(25);
  });
});
