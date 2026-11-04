import { Card, CardBody, Field, Input, PageHeader, Select, Textarea } from '@/components/ui';
import { ActionForm, SubmitButton } from '@/components/ui/forms';
import { requireClientUser } from '@/lib/auth';
import { createClient } from '@/lib/supabase/server';
import { createTicketAction } from '@/app/actions/tickets';

export const metadata = { title: 'Report a problem' };

export default async function NewTicket({ searchParams }: { searchParams: Promise<{ property?: string; device?: string }> }) {
  const s = await requireClientUser();
  const sp = await searchParams;
  const db = await createClient();
  const [{ data: props }, { data: devs }] = await Promise.all([
    db.from('properties').select('id, name, client_id').order('name'),
    db.from('devices').select('id, name, property_id').order('name'),
  ]);
  const operable = s.memberships.filter((m) => m.role !== 'viewer');
  return (
    <>
      <PageHeader title="Report a problem" breadcrumbs={[{ href: '/app/support', label: 'Support' }]} />
      <Card><CardBody>
        {operable.length === 0 ? <p className="text-sm text-muted">Viewer accounts cannot open requests — ask an account owner.</p> : (
          <ActionForm action={createTicketAction} className="grid gap-4 md:grid-cols-2">
            <Field label="Account"><Select name="client_id">{operable.map((m) => <option key={m.client_id} value={m.client_id}>{m.client_name}</option>)}</Select></Field>
            <Field label="Category"><Select name="category" defaultValue={sp.device ? 'device' : 'other'}><option value="device">Device problem</option><option value="alert">Alert / false alarm</option><option value="installation">Installation</option><option value="account">Account</option><option value="other">Other</option></Select></Field>
            <Field label="Property"><Select name="property_id" defaultValue={sp.property ?? ''}><option value="">—</option>{((props ?? []) as { id: string; name: string }[]).map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}</Select></Field>
            <Field label="Device"><Select name="device_id" defaultValue={sp.device ?? ''}><option value="">—</option>{((devs ?? []) as { id: string; name: string }[]).map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}</Select></Field>
            <Field label="Urgency"><Select name="priority" defaultValue="normal"><option value="low">Low</option><option value="normal">Normal</option><option value="high">High</option></Select></Field>
            <Field label="Subject"><Input name="subject" required minLength={3} maxLength={200} /></Field>
            <Field label="What happened?" className="md:col-span-2" hint="When did it start? Any lights on the device? Did the power or internet go out?"><Textarea name="description" required maxLength={10000} /></Field>
            <div className="md:col-span-2 flex justify-end"><SubmitButton>Submit</SubmitButton></div>
          </ActionForm>
        )}
      </CardBody></Card>
    </>
  );
}
