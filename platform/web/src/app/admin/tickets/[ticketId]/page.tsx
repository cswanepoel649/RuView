import { notFound } from 'next/navigation';
import { Button, Card, CardBody, CardHeader, Field, PageHeader, Select } from '@/components/ui';
import { TicketThread, type TicketMessage } from '@/components/monitoring/TicketThread';
import { requireStaff } from '@/lib/auth';
import { createClient } from '@/lib/supabase/server';
import { updateTicketAction } from '@/app/actions/tickets';
import type { Ticket } from '@/lib/types';

export default async function AdminTicket({ params }: { params: Promise<{ ticketId: string }> }) {
  await requireStaff();
  const { ticketId } = await params;
  const db = await createClient();
  const { data: t } = await db.from('support_tickets').select('*, clients(id, display_name), properties(id, name), devices(id, name)').eq('id', ticketId).maybeSingle();
  if (!t) notFound();
  const [{ data: msgs }, { data: staff }] = await Promise.all([
    db.from('ticket_messages').select('*, profiles!ticket_messages_author_id_fkey(full_name, email, platform_role)').eq('ticket_id', ticketId).order('created_at'),
    db.from('profiles').select('id, full_name, email').not('platform_role', 'is', null).order('full_name'),
  ]);
  const ticket = t as Ticket & { clients: { id: string; display_name: string }; properties: { id: string; name: string } | null; devices: { id: string; name: string } | null };
  return (
    <>
      <PageHeader title={`Ticket #${ticket.reference}`} breadcrumbs={[{ href: '/admin/tickets', label: 'Support' }, { href: `/admin/clients/${ticket.clients.id}`, label: ticket.clients.display_name }]}
        subtitle={[ticket.properties?.name, ticket.devices?.name].filter(Boolean).join(' · ')} />
      <div className="grid gap-6 xl:grid-cols-[1fr_300px]">
        <TicketThread t={ticket} messages={(msgs ?? []) as TicketMessage[]} staff canReply />
        <Card className="h-fit"><CardHeader title="Triage" /><CardBody>
          <form action={updateTicketAction} className="space-y-3">
            <input type="hidden" name="id" value={ticket.id} />
            <Field label="Status"><Select name="status" defaultValue={ticket.status}>{['open', 'in_progress', 'waiting_client', 'resolved', 'closed'].map((s) => <option key={s} value={s}>{s.replace('_', ' ')}</option>)}</Select></Field>
            <Field label="Priority"><Select name="priority" defaultValue={ticket.priority}>{['low', 'normal', 'high', 'urgent'].map((s) => <option key={s} value={s}>{s}</option>)}</Select></Field>
            <Field label="Assignee"><Select name="assigned_to" defaultValue={ticket.assigned_to ?? ''}><option value="">Unassigned</option>{((staff ?? []) as { id: string; full_name: string | null; email: string }[]).map((u) => <option key={u.id} value={u.id}>{u.full_name ?? u.email}</option>)}</Select></Field>
            <Button type="submit">Update</Button>
          </form>
        </CardBody></Card>
      </div>
    </>
  );
}
