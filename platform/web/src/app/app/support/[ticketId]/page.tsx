import { notFound } from 'next/navigation';
import { PageHeader } from '@/components/ui';
import { TicketThread, type TicketMessage } from '@/components/monitoring/TicketThread';
import { canOperate, requireClientUser } from '@/lib/auth';
import { createClient } from '@/lib/supabase/server';
import type { Ticket } from '@/lib/types';

export default async function ClientTicket({ params }: { params: Promise<{ ticketId: string }> }) {
  const s = await requireClientUser();
  const { ticketId } = await params;
  const db = await createClient();
  const { data: t } = await db.from('support_tickets').select('*').eq('id', ticketId).maybeSingle();
  if (!t) notFound();
  // RLS hides internal staff notes from clients.
  const { data: msgs } = await db.from('ticket_messages').select('*, profiles!ticket_messages_author_id_fkey(full_name, email, platform_role)').eq('ticket_id', ticketId).order('created_at');
  const ticket = t as Ticket;
  return (
    <>
      <PageHeader title={`Request #${ticket.reference}`} breadcrumbs={[{ href: '/app/support', label: 'Support' }]} />
      <TicketThread t={ticket} messages={(msgs ?? []) as TicketMessage[]} staff={false} canReply={canOperate(s, ticket.client_id) && ticket.status !== 'closed'} />
    </>
  );
}
