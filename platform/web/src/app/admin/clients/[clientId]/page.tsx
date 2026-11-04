import Link from 'next/link';
import { notFound } from 'next/navigation';
import { Badge, Card, CardBody, CardHeader, EmptyState, Field, Input, PageHeader, Select, Table, Td, Th, Button } from '@/components/ui';
import { ActionForm, ConfirmSubmit, SubmitButton } from '@/components/ui/forms';
import { ClientFields, TimezoneSelect } from '@/components/admin/ClientFields';
import { EventList } from '@/components/monitoring/EventList';
import { ModeBadge } from '@/components/monitoring/badges';
import { requireStaff } from '@/lib/auth';
import { createClient } from '@/lib/supabase/server';
import { EVENT_SELECT, flattenEvents } from '@/lib/queries';
import { formatAddress, timeAgo } from '@/lib/format';
import type { Client, ClientContact, Property } from '@/lib/types';
import {
  addContactAction, createPropertyAction, deleteContactAction, inviteClientUserAction, updateClientAction, updateMemberRoleAction,
} from '../actions';

export default async function ClientDetail({ params }: { params: Promise<{ clientId: string }> }) {
  const s = await requireStaff();
  const { clientId } = await params;
  const db = await createClient();
  const { data: client } = await db.from('clients').select('*').eq('id', clientId).maybeSingle();
  if (!client) notFound();
  const [contacts, members, properties, events, devices] = await Promise.all([
    db.from('client_contacts').select('*').eq('client_id', clientId).order('sort_order'),
    db.from('client_members').select('user_id, role, created_at, profiles!client_members_user_id_fkey(email, full_name)').eq('client_id', clientId),
    db.from('properties').select('*').eq('client_id', clientId).order('name'),
    db.from('events').select(EVENT_SELECT).eq('client_id', clientId).order('occurred_at', { ascending: false }).limit(10),
    db.from('devices').select('property_id, status, kind').eq('client_id', clientId),
  ]);
  const c = client as Client;
  const devs = (devices.data ?? []) as { property_id: string | null; status: string; kind: string }[];
  type Member = { user_id: string; role: string; created_at: string; profiles: { email: string; full_name: string | null } | null };

  return (
    <>
      <PageHeader title={c.display_name} breadcrumbs={[{ href: '/admin/clients', label: 'Clients' }]}
        subtitle={<span className="flex flex-wrap items-center gap-2"><Badge tone={c.status === 'active' ? 'ok' : 'warn'}>{c.status}</Badge>{c.account_ref && <span>Ref {c.account_ref}</span>}<span>{c.primary_email}</span></span>} />

      <div className="grid gap-6 xl:grid-cols-[1.5fr_1fr]">
        <div className="space-y-6">
          <Card>
            <CardHeader title="Properties" subtitle="Homes and sites monitored for this client" />
            {(properties.data ?? []).length === 0 ? <EmptyState title="No properties yet.">Create the first property below, then start an installation.</EmptyState> : (
              <ul className="divide-y divide-border">
                {((properties.data ?? []) as Property[]).map((p) => {
                  const pd = devs.filter((d) => d.property_id === p.id);
                  const off = pd.filter((d) => d.status === 'offline').length;
                  return (
                    <li key={p.id}>
                      <Link href={`/admin/properties/${p.id}`} className="flex flex-wrap items-center justify-between gap-3 px-5 py-3 hover:bg-surface-2">
                        <span><span className="font-medium">{p.name}</span><span className="block text-sm text-muted">{formatAddress(p)}</span></span>
                        <span className="flex items-center gap-2 text-sm">
                          <Badge>{p.status}</Badge><ModeBadge mode={p.security_mode} />
                          <span className="text-muted">{pd.length} devices{off ? <span className="text-bad"> · {off} offline</span> : null}</span>
                        </span>
                      </Link>
                    </li>
                  );
                })}
              </ul>
            )}
            <CardBody className="border-t border-border">
              <details>
                <summary className="cursor-pointer text-sm font-medium text-brand">Add property</summary>
                <ActionForm action={createPropertyAction} className="mt-4 grid gap-4 md:grid-cols-2">
                  <input type="hidden" name="client_id" value={c.id} />
                  <Field label="Property name"><Input name="name" required placeholder="e.g. Main residence" /></Field>
                  <Field label="Timezone" hint="Used for schedules and quiet hours."><TimezoneSelect /></Field>
                  <Field label="Address line 1"><Input name="address_line1" /></Field>
                  <Field label="Address line 2"><Input name="address_line2" /></Field>
                  <Field label="City"><Input name="city" /></Field>
                  <Field label="Region / province"><Input name="region" /></Field>
                  <Field label="Postal code"><Input name="postal_code" /></Field>
                  <Field label="Country"><Input name="country" /></Field>
                  <Field label="Exit delay (seconds)" hint="Grace period after arming."><Input name="exit_delay_s" type="number" min={0} max={600} defaultValue={60} /></Field>
                  <Field label="Access notes" hint="Gate codes, parking — staff only."><Input name="access_notes" /></Field>
                  <div className="md:col-span-2 flex justify-end"><SubmitButton>Create property</SubmitButton></div>
                </ActionForm>
              </details>
            </CardBody>
          </Card>

          <Card>
            <CardHeader title="Recent activity" />
            <EventList events={flattenEvents(events.data)} hrefFor={(e) => `/admin/alerts?event=${e.id}`} />
          </Card>

          {s.isAdmin && (
            <Card>
              <CardHeader title="Account details" />
              <CardBody>
                <ActionForm action={updateClientAction}>
                  <input type="hidden" name="id" value={c.id} />
                  <ClientFields c={c} />
                  <div className="mt-6 flex justify-end"><SubmitButton>Save changes</SubmitButton></div>
                </ActionForm>
              </CardBody>
            </Card>
          )}
        </div>

        <div className="space-y-6">
          <Card>
            <CardHeader title="Portal users" subtitle="People who can sign in to this client's dashboard" />
            {(members.data ?? []).length === 0 ? <EmptyState title="No users yet." /> : (
              <Table>
                <thead><tr><Th>User</Th><Th>Role</Th></tr></thead>
                <tbody>
                  {((members.data ?? []) as unknown as Member[]).map((m) => (
                    <tr key={m.user_id}>
                      <Td><p className="font-medium">{m.profiles?.full_name ?? m.profiles?.email}</p><p className="text-xs text-muted">{m.profiles?.email} · added {timeAgo(m.created_at)}</p></Td>
                      <Td>
                        {s.isAdmin ? (
                          <form action={updateMemberRoleAction} className="flex gap-1">
                            <input type="hidden" name="client_id" value={c.id} /><input type="hidden" name="user_id" value={m.user_id} />
                            <Select name="role" defaultValue={m.role} className="py-1"><option value="owner">Owner</option><option value="member">Member</option><option value="viewer">Viewer</option><option value="remove">Remove access</option></Select>
                            <Button variant="secondary" type="submit" className="py-1">Apply</Button>
                          </form>
                        ) : <Badge>{m.role}</Badge>}
                      </Td>
                    </tr>
                  ))}
                </tbody>
              </Table>
            )}
            {s.isAdmin && (
              <CardBody className="border-t border-border">
                <ActionForm action={inviteClientUserAction} resetOnSuccess className="space-y-3">
                  <input type="hidden" name="client_id" value={c.id} />
                  <div className="grid gap-3 sm:grid-cols-2">
                    <Field label="Email"><Input name="email" type="email" required /></Field>
                    <Field label="Full name"><Input name="full_name" /></Field>
                  </div>
                  <Field label="Role" hint="Owners manage the account; members operate (arm/disarm, zones); viewers can only look.">
                    <Select name="role" defaultValue="owner"><option value="owner">Owner</option><option value="member">Member</option><option value="viewer">Viewer</option></Select>
                  </Field>
                  <div className="flex justify-end"><SubmitButton pendingLabel="Inviting…">Send invitation</SubmitButton></div>
                </ActionForm>
              </CardBody>
            )}
          </Card>

          <Card>
            <CardHeader title="Contacts" subtitle="Emergency, billing and technical contacts" />
            <ul className="divide-y divide-border">
              {((contacts.data ?? []) as ClientContact[]).map((ct) => (
                <li key={ct.id} className="flex items-start justify-between gap-3 px-5 py-3">
                  <div>
                    <p className="font-medium">{ct.name} <Badge className="ml-1">{ct.kind}</Badge></p>
                    <p className="text-sm text-muted">{[ct.relationship, ct.phone, ct.email].filter(Boolean).join(' · ')}</p>
                  </div>
                  <form action={deleteContactAction}>
                    <input type="hidden" name="id" value={ct.id} /><input type="hidden" name="client_id" value={c.id} />
                    <ConfirmSubmit message={`Remove contact ${ct.name}?`} variant="secondary">Remove</ConfirmSubmit>
                  </form>
                </li>
              ))}
            </ul>
            <CardBody className="border-t border-border">
              <ActionForm action={addContactAction} resetOnSuccess className="grid gap-3 sm:grid-cols-2">
                <input type="hidden" name="client_id" value={c.id} />
                <Field label="Name"><Input name="name" required /></Field>
                <Field label="Type"><Select name="kind" defaultValue="emergency"><option value="primary">Primary</option><option value="emergency">Emergency</option><option value="billing">Billing</option><option value="technical">Technical</option><option value="other">Other</option></Select></Field>
                <Field label="Phone"><Input name="phone" type="tel" /></Field>
                <Field label="Email"><Input name="email" type="email" /></Field>
                <Field label="Relationship" className="sm:col-span-2"><Input name="relationship" placeholder="e.g. neighbour, son" /></Field>
                <div className="sm:col-span-2 flex justify-end"><SubmitButton>Add contact</SubmitButton></div>
              </ActionForm>
            </CardBody>
          </Card>
        </div>
      </div>
    </>
  );
}
