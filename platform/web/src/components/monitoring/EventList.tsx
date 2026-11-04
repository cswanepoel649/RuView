import Link from 'next/link';
import { ShieldAlert, TriangleAlert, Info, HeartPulse, Cpu, Activity } from 'lucide-react';
import { formatDateTime, timeAgo } from '@/lib/format';
import type { EventRow } from '@/lib/types';
import { EmptyState, cn } from '../ui';

const CATEGORY_ICON: Record<string, typeof Info> = { security: ShieldAlert, safety: HeartPulse, device: Cpu, activity: Activity, system: Info };

export function categoryOf(type: string): string {
  if (type.startsWith('intrusion') || type.startsWith('entry_delay') || type === 'security_mode_changed') return 'security';
  if (type === 'fall_detected') return 'safety';
  if (type.startsWith('presence')) return 'activity';
  if (type === 'problem_reported') return 'system';
  return 'device';
}

export function EventList({ events, context, tz, hrefFor, empty = 'No events yet.' }: {
  events: (EventRow & { property_name?: string; client_name?: string; room_name?: string })[];
  context?: 'admin' | 'client'; tz?: string; hrefFor?: (e: EventRow) => string | null; empty?: string;
}) {
  if (!events.length) return <EmptyState title={empty} />;
  return (
    <ul className="divide-y divide-border">
      {events.map((e) => {
        const Icon = e.severity === 'critical' ? ShieldAlert : e.severity === 'warning' ? TriangleAlert : CATEGORY_ICON[categoryOf(e.event_type)] ?? Info;
        const href = hrefFor?.(e);
        const body = (
          <div className="flex gap-3 px-5 py-3">
            <span className={cn('mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-full',
              e.severity === 'critical' ? 'bg-bad-soft text-bad' : e.severity === 'warning' ? 'bg-warn-soft text-warn' : 'bg-surface-2 text-muted')}>
              <Icon className="h-4 w-4" aria-hidden />
            </span>
            <div className="min-w-0 flex-1">
              <div className="flex flex-wrap items-baseline justify-between gap-x-3">
                <p className="truncate text-sm font-medium">{e.title}</p>
                <time className="shrink-0 text-xs text-muted" dateTime={e.occurred_at} title={formatDateTime(e.occurred_at, tz)}>{timeAgo(e.occurred_at)}</time>
              </div>
              {e.message && <p className="mt-0.5 line-clamp-2 text-sm text-muted">{e.message}</p>}
              <p className="mt-1 flex flex-wrap gap-x-2 text-xs text-muted">
                {context === 'admin' && e.client_name && <span>{e.client_name}</span>}
                {e.property_name && <span>· {e.property_name}</span>}
                {e.room_name && <span>· {e.room_name}</span>}
                {e.acknowledged_at ? <span className="text-ok">· Acknowledged</span> : e.severity !== 'info' ? <span className="text-warn">· Needs attention</span> : null}
              </p>
            </div>
          </div>
        );
        return <li key={e.id}>{href ? <Link href={href} className="block hover:bg-surface-2">{body}</Link> : body}</li>;
      })}
    </ul>
  );
}
