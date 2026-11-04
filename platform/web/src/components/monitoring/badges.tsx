import { Badge, StatusDot } from '../ui';
import { MODE_LABEL, STATUS_LABEL, rssiQuality, timeAgo } from '@/lib/format';
import type { DeviceStatus, SecurityMode, Severity } from '@/lib/types';

export function SeverityBadge({ severity }: { severity: Severity }) {
  const t = severity === 'critical' ? 'bad' : severity === 'warning' ? 'warn' : 'neutral';
  return <Badge tone={t}>{severity === 'critical' ? 'Critical' : severity === 'warning' ? 'Warning' : 'Info'}</Badge>;
}

export function DeviceStatusBadge({ status, lastSeen }: { status: DeviceStatus; lastSeen?: string | null }) {
  const tone = status === 'online' ? 'ok' : status === 'offline' || status === 'fault' ? 'bad' : status === 'retired' ? 'neutral' : 'info';
  return (
    <span className="inline-flex items-center gap-2">
      <StatusDot tone={tone} live={status === 'online'} />
      <span className="text-sm">{STATUS_LABEL[status]}</span>
      {lastSeen && status !== 'online' && <span className="text-xs text-muted">· {timeAgo(lastSeen)}</span>}
    </span>
  );
}

export function ModeBadge({ mode }: { mode: SecurityMode }) {
  return <Badge tone={mode === 'disarmed' ? 'neutral' : 'brand'}>{MODE_LABEL[mode]}</Badge>;
}

export function SignalBars({ rssi }: { rssi: number | null | undefined }) {
  const q = rssiQuality(rssi);
  return (
    <span className="inline-flex items-end gap-0.5" title={rssi != null ? `${rssi} dBm · ${q.label}` : 'No signal data'} aria-label={`Signal ${q.label}`}>
      {[1, 2, 3, 4].map((b) => (
        <span key={b} className={`w-1 rounded-sm ${b <= q.bars ? (q.bars <= 1 ? 'bg-bad' : q.bars === 2 ? 'bg-warn' : 'bg-ok') : 'bg-border'}`} style={{ height: 3 + b * 3 }} />
      ))}
      {rssi != null && <span className="ml-1 text-xs text-muted tabular">{rssi} dBm</span>}
    </span>
  );
}
