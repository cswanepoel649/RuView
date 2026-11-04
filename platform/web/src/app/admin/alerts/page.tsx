import { Button, Card, CardHeader, PageHeader, Select } from '@/components/ui';
import { EventList } from '@/components/monitoring/EventList';
import { EventDetail } from '@/components/monitoring/EventDetail';
import { requireStaff } from '@/lib/auth';
import { createClient } from '@/lib/supabase/server';
import { EVENT_SELECT, flattenEvents } from '@/lib/queries';

export const metadata = { title: 'Alerts' };

export default async function AdminAlerts({ searchParams }: { searchParams: Promise<{ severity?: string; state?: string; type?: string; event?: string }> }) {
  await requireStaff();
  const sp = await searchParams;
  const db = await createClient();
  let q = db.from('events').select(EVENT_SELECT).order('occurred_at', { ascending: false }).limit(150);
  q = sp.severity ? q.eq('severity', sp.severity) : q.in('severity', ['critical', 'warning']);
  if (sp.state !== 'all') q = q.is('resolved_at', null);
  if (sp.state === 'open') q = q.is('acknowledged_at', null);
  if (sp.type) q = q.eq('event_type', sp.type);
  const [{ data }, { data: types }, sel] = await Promise.all([
    q, db.from('event_types').select('code, label').order('label'),
    sp.event ? db.from('events').select(EVENT_SELECT).eq('id', sp.event).maybeSingle() : Promise.resolve({ data: null }),
  ]);
  const selected = sel.data ? flattenEvents([sel.data])[0] : null;
  return (
    <>
      <PageHeader title="Alerts" subtitle="Security, safety and device alerts across all clients." />
      <div className="grid gap-6 xl:grid-cols-[1.2fr_1fr]">
        <Card>
          <form className="flex flex-wrap gap-2 border-b border-border px-5 py-3">
            <Select name="severity" defaultValue={sp.severity ?? ''} className="max-w-[170px]"><option value="">Critical + warning</option><option value="critical">Critical</option><option value="warning">Warning</option><option value="info">Info</option></Select>
            <Select name="state" defaultValue={sp.state ?? ''} className="max-w-[170px]"><option value="">Unresolved</option><option value="open">Unacknowledged</option><option value="all">All</option></Select>
            <Select name="type" defaultValue={sp.type ?? ''} className="max-w-[220px]"><option value="">All types</option>{((types ?? []) as { code: string; label: string }[]).map((t) => <option key={t.code} value={t.code}>{t.label}</option>)}</Select>
            <Button variant="secondary" type="submit">Filter</Button>
          </form>
          <EventList events={flattenEvents(data)} context="admin" hrefFor={(e) => `?${new URLSearchParams({ ...sp, event: e.id })}`} empty="No matching alerts." />
        </Card>
        <div>{selected ? <EventDetail e={selected} canAct /> : <Card><CardHeader title="Select an alert" subtitle="Details, context and acknowledgement appear here." /></Card>}</div>
      </div>
    </>
  );
}
