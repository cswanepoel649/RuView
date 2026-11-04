import { Badge, Card, CardBody, CardHeader, Checkbox, Field, Select, Textarea } from '../ui';
import { ActionForm, SubmitButton } from '../ui/forms';
import { replyTicketAction } from '@/app/actions/tickets';
import { formatDateTime } from '@/lib/format';
import type { Ticket } from '@/lib/types';

export interface TicketMessage { id: string; body: string; internal: boolean; created_at: string; author_id: string | null; profiles: { full_name: string | null; email: string; platform_role: string | null } | null }

export function TicketThread({ t, messages, staff, canReply }: { t: Ticket; messages: TicketMessage[]; staff: boolean; canReply: boolean }) {
  return (
    <Card>
      <CardHeader title={`#${t.reference} · ${t.subject}`} subtitle={<span className="flex flex-wrap gap-2"><Badge>{t.category}</Badge><Badge tone={t.status === 'resolved' || t.status === 'closed' ? 'ok' : 'info'}>{t.status.replace('_', ' ')}</Badge><Badge tone={t.priority === 'urgent' || t.priority === 'high' ? 'warn' : 'neutral'}>{t.priority}</Badge><span>opened {formatDateTime(t.created_at)}</span></span>} />
      <CardBody className="space-y-4">
        <div className="rounded-lg bg-surface-2 p-4 text-sm whitespace-pre-wrap">{t.description}</div>
        {messages.map((m) => (
          <div key={m.id} className={m.internal ? 'rounded-lg border border-warn/40 bg-warn-soft p-3' : m.profiles?.platform_role ? 'rounded-lg border border-brand/30 bg-brand-soft p-3' : 'rounded-lg border border-border p-3'}>
            <p className="mb-1 text-xs text-muted">{m.profiles?.full_name ?? m.profiles?.email ?? 'Support team'}{m.profiles?.platform_role ? ' · Support' : ''}{m.internal ? ' · internal note' : ''} · {formatDateTime(m.created_at)}</p>
            <p className="whitespace-pre-wrap text-sm">{m.body}</p>
          </div>
        ))}
        {canReply && (
          <ActionForm action={replyTicketAction} resetOnSuccess className="space-y-3">
            <input type="hidden" name="ticket_id" value={t.id} />
            <Field label="Reply"><Textarea name="body" required maxLength={10000} /></Field>
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div className="flex flex-wrap items-center gap-4">
                {staff && <Checkbox name="internal" label="Internal note (staff only)" />}
                {staff && <Select name="status" defaultValue="" className="max-w-[200px]"><option value="">Keep status</option><option value="in_progress">In progress</option><option value="waiting_client">Waiting on client</option><option value="resolved">Resolved</option></Select>}
              </div>
              <SubmitButton>Send</SubmitButton>
            </div>
          </ActionForm>
        )}
      </CardBody>
    </Card>
  );
}
