import { Badge, Button, Card, CardBody, CardHeader, Field, Input } from '../ui';
import { SeverityBadge } from './badges';
import { eventAction } from '@/app/actions/events';
import { formatDateTime } from '@/lib/format';
import type { EventRow } from '@/lib/types';

export function EventDetail({ e, canAct, tz }: { e: EventRow & { property_name?: string; room_name?: string; client_name?: string }; canAct: boolean; tz?: string }) {
  return (
    <Card>
      <CardHeader title={e.title} subtitle={<span className="flex flex-wrap items-center gap-2"><SeverityBadge severity={e.severity} /><span>{formatDateTime(e.occurred_at, tz)}</span>{e.client_name && <span>· {e.client_name}</span>}{e.property_name && <span>· {e.property_name}</span>}{e.room_name && <span>· {e.room_name}</span>}</span>} />
      <CardBody className="space-y-4">
        {e.message && <p className="text-sm">{e.message}</p>}
        {Object.keys(e.data ?? {}).length > 0 && (
          <dl className="grid grid-cols-2 gap-2 text-sm">{Object.entries(e.data).map(([k, v]) => <div key={k}><dt className="text-xs text-muted">{k.replace(/_/g, ' ')}</dt><dd className="font-medium">{typeof v === 'object' ? JSON.stringify(v) : String(v)}</dd></div>)}</dl>
        )}
        <div className="flex flex-wrap gap-2 text-sm">
          {e.acknowledged_at ? <Badge tone="ok">Acknowledged {formatDateTime(e.acknowledged_at, tz)}</Badge> : <Badge tone="warn">Not acknowledged</Badge>}
          {e.resolved_at && <Badge tone="ok">Resolved</Badge>}
          {e.ack_note && <span className="text-muted">“{e.ack_note}”</span>}
        </div>
        {canAct && !e.resolved_at && (
          <form action={eventAction} className="flex flex-wrap items-end gap-2">
            <input type="hidden" name="id" value={e.id} />
            <Field label="Note (optional)" className="min-w-[240px] flex-1"><Input name="note" maxLength={1000} placeholder="e.g. false alarm — cleaner on site" /></Field>
            {!e.acknowledged_at && <Button type="submit" name="op" value="ack" variant="secondary">Acknowledge</Button>}
            <Button type="submit" name="op" value="resolve">Resolve</Button>
          </form>
        )}
      </CardBody>
    </Card>
  );
}
