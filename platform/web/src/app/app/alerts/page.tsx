import { Button, Card, CardHeader, EmptyState, PageHeader, cn } from '@/components/ui';
import { EventList } from '@/components/monitoring/EventList';
import { EventDetail } from '@/components/monitoring/EventDetail';
import { SeverityBadge } from '@/components/monitoring/badges';
import { canOperate, requireClientUser } from '@/lib/auth';
import { createClient } from '@/lib/supabase/server';
import { EVENT_SELECT, flattenEvents } from '@/lib/queries';
import { timeAgo } from '@/lib/format';
import { markAllReadAction } from '@/app/actions/events';
import type { Notification } from '@/lib/types';

export const metadata = { title: 'Alerts' };

export default async function ClientAlerts({ searchParams }: { searchParams: Promise<{ event?: string }> }) {
  const s = await requireClientUser();
  const sp = await searchParams;
  const db = await createClient();
  const [{ data: notes }, { data: open }, sel] = await Promise.all([
    db.from('notifications').select('*').eq('user_id', s.userId).eq('channel', 'in_app').order('created_at', { ascending: false }).limit(60),
    db.from('events').select(EVENT_SELECT).in('severity', ['critical', 'warning']).is('resolved_at', null).order('occurred_at', { ascending: false }).limit(30),
    sp.event ? db.from('events').select(EVENT_SELECT).eq('id', sp.event).maybeSingle() : Promise.resolve({ data: null }),
  ]);
  const selected = sel.data ? flattenEvents([sel.data])[0] : null;
  const list = (notes ?? []) as Notification[];
  return (
    <>
      <PageHeader title="Alerts" subtitle="Notifications based on your alert settings, and anything still needing attention."
        actions={list.some((n) => !n.read_at) && <form action={markAllReadAction}><Button variant="secondary" type="submit">Mark all read</Button></form>} />
      <div className="grid gap-6 xl:grid-cols-[1fr_1fr]">
        <div className="space-y-6">
          {selected && <EventDetail e={selected} canAct={canOperate(s, selected.client_id)} />}
          <Card><CardHeader title="Needs attention" subtitle="Unresolved alarms and warnings" />
            <EventList events={flattenEvents(open)} hrefFor={(e) => `?event=${e.id}`} empty="Nothing needs attention." />
          </Card>
        </div>
        <Card><CardHeader title="Notifications" />
          {list.length === 0 ? <EmptyState title="No notifications yet." /> : (
            <ul className="divide-y divide-border">{list.map((n) => (
              <li key={n.id}><a href={n.event_id ? `?event=${n.event_id}` : '#'} className={cn('flex items-start gap-3 px-5 py-3 hover:bg-surface-2', !n.read_at && 'bg-info-soft/40')}>
                {!n.read_at && <span className="mt-2 h-2 w-2 shrink-0 rounded-full bg-info" aria-label="unread" />}
                <span className="min-w-0 flex-1"><span className="flex items-center justify-between gap-2"><span className="truncate text-sm font-medium">{n.title}</span><span className="shrink-0 text-xs text-muted">{timeAgo(n.created_at)}</span></span>
                  {n.body && <span className="line-clamp-2 block text-sm text-muted">{n.body}</span>}</span>
                <SeverityBadge severity={n.severity} />
              </a></li>
            ))}</ul>
          )}
        </Card>
      </div>
    </>
  );
}
