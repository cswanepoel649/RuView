import type { MotionLevel, SecurityMode, Severity, DeviceStatus } from './types';

export function timeAgo(iso: string | null | undefined, now = Date.now()): string {
  if (!iso) return 'never';
  const s = Math.round((now - Date.parse(iso)) / 1000);
  if (s < 5) return 'just now';
  if (s < 60) return `${s}s ago`;
  const m = Math.round(s / 60);
  if (m < 60) return `${m} min ago`;
  const h = Math.round(m / 60);
  if (h < 48) return `${h} h ago`;
  return `${Math.round(h / 24)} d ago`;
}

export function formatDateTime(iso: string | null | undefined, tz?: string): string {
  if (!iso) return '—';
  return new Intl.DateTimeFormat('en-GB', { dateStyle: 'medium', timeStyle: 'short', timeZone: tz }).format(new Date(iso));
}

export const MOTION_LABEL: Record<MotionLevel, string> = {
  absent: 'Clear', present_still: 'Present · still', present_moving: 'Present · moving', active: 'Very active',
};
export const MODE_LABEL: Record<SecurityMode, string> = { disarmed: 'Disarmed', armed_home: 'Armed · Home', armed_away: 'Armed · Away' };
export const SEVERITY_LABEL: Record<Severity, string> = { info: 'Info', warning: 'Warning', critical: 'Critical' };
export const STATUS_LABEL: Record<DeviceStatus, string> = {
  inventory: 'In stock', assigned: 'Assigned', provisioned: 'Provisioned', online: 'Online', offline: 'Offline', fault: 'Fault', retired: 'Retired',
};

export function formatAddress(p: { address_line1?: string | null; city?: string | null; region?: string | null; postal_code?: string | null; country?: string | null }) {
  return [p.address_line1, p.city, p.region, p.postal_code, p.country].filter(Boolean).join(', ') || 'No address';
}

export function rssiQuality(rssi: number | null | undefined): { bars: 0 | 1 | 2 | 3 | 4; label: string } {
  if (rssi == null) return { bars: 0, label: 'Unknown' };
  if (rssi >= -55) return { bars: 4, label: 'Excellent' };
  if (rssi >= -67) return { bars: 3, label: 'Good' };
  if (rssi >= -75) return { bars: 2, label: 'Fair' };
  return { bars: 1, label: 'Weak' };
}

export function bytes(n: number | null | undefined) {
  if (n == null) return '—';
  return n > 1048576 ? `${(n / 1048576).toFixed(2)} MB` : `${(n / 1024).toFixed(1)} KB`;
}

/** Current time as ISO string (request-time helper for query filters). */
export const isoNow = () => new Date().toISOString();
