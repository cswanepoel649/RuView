'use server';
import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { z } from 'zod';
import { requireAdmin, requireStaff } from '@/lib/auth';
import { createClient } from '@/lib/supabase/server';
import { adminClient } from '@/lib/supabase/admin';
import { serverEnv } from '@/lib/env';
import { dbError, optEmail, optStr, parseForm, reqStr } from '@/lib/actions';
import type { ActionResult } from '@/components/ui/forms';

const ClientForm = z.object({
  display_name: reqStr(200),
  legal_name: optStr(200),
  kind: z.enum(['individual', 'business']),
  primary_email: optEmail,
  primary_phone: optStr(40),
  account_ref: optStr(60),
  notes: optStr(5000),
  status: z.enum(['active', 'suspended', 'archived']).default('active'),
  billing_line1: optStr(200), billing_city: optStr(100), billing_postal: optStr(20), billing_country: optStr(60),
});

function toRow(d: z.infer<typeof ClientForm>) {
  const { billing_line1, billing_city, billing_postal, billing_country, ...rest } = d;
  return { ...rest, billing_address: { line1: billing_line1, city: billing_city, postal_code: billing_postal, country: billing_country } };
}

export async function createClientAction(_: ActionResult, fd: FormData): Promise<ActionResult> {
  const s = await requireAdmin();
  const p = parseForm(ClientForm, fd);
  if (!p.ok) return p.result;
  const db = await createClient();
  const { data, error } = await db.from('clients').insert({ ...toRow(p.data), created_by: s.userId }).select('id').single();
  if (error) return dbError(error)!;
  revalidatePath('/admin/clients');
  redirect(`/admin/clients/${data.id}`);
}

export async function updateClientAction(_: ActionResult, fd: FormData): Promise<ActionResult> {
  await requireAdmin();
  const id = z.uuid().parse(fd.get('id'));
  const p = parseForm(ClientForm, fd);
  if (!p.ok) return p.result;
  const db = await createClient();
  const { error } = await db.from('clients').update(toRow(p.data)).eq('id', id);
  if (error) return dbError(error)!;
  revalidatePath(`/admin/clients/${id}`);
  return { ok: true, message: 'Client updated.' };
}

const ContactForm = z.object({
  client_id: z.uuid(), name: reqStr(120), relationship: optStr(60), email: optEmail, phone: optStr(40),
  kind: z.enum(['primary', 'emergency', 'billing', 'technical', 'other']), notes: optStr(1000),
});
export async function addContactAction(_: ActionResult, fd: FormData): Promise<ActionResult> {
  await requireStaff();
  const p = parseForm(ContactForm, fd);
  if (!p.ok) return p.result;
  const db = await createClient();
  const { error } = await db.from('client_contacts').insert(p.data);
  if (error) return dbError(error)!;
  revalidatePath(`/admin/clients/${p.data.client_id}`);
  return { ok: true, message: 'Contact added.', nonce: Date.now() };
}
export async function deleteContactAction(fd: FormData) {
  await requireStaff();
  const id = z.uuid().parse(fd.get('id'));
  const clientId = z.uuid().parse(fd.get('client_id'));
  const db = await createClient();
  await db.from('client_contacts').delete().eq('id', id);
  revalidatePath(`/admin/clients/${clientId}`);
}

const InviteForm = z.object({ client_id: z.uuid(), email: z.email().max(254), full_name: optStr(120), role: z.enum(['owner', 'member', 'viewer']) });

/**
 * Invite a household user. Uses Supabase Auth invite email; if the person already
 * has an account, they are simply granted membership. If email delivery fails, a
 * one-time invite link is returned for the operator to send manually.
 */
export async function inviteClientUserAction(_: ActionResult, fd: FormData): Promise<ActionResult> {
  const s = await requireAdmin();
  const p = parseForm(InviteForm, fd);
  if (!p.ok) return p.result;
  const email = p.data.email.toLowerCase();
  const admin = adminClient();
  const redirectTo = `${serverEnv().APP_URL}/auth/confirm`;
  let userId: string | null = null;
  let manualLink: string | null = null;

  const { data: existing } = await admin.from('profiles').select('id').eq('email', email).maybeSingle();
  if (existing) {
    userId = existing.id as string;
  } else {
    const { data, error } = await admin.auth.admin.inviteUserByEmail(email, { redirectTo, data: { full_name: p.data.full_name } });
    if (data?.user) userId = data.user.id;
    if (error || !userId) {
      const link = await admin.auth.admin.generateLink({ type: 'invite', email, options: { redirectTo, data: { full_name: p.data.full_name } } });
      if (link.error || !link.data.user) return { error: `Could not invite user: ${error?.message ?? link.error?.message}` };
      userId = link.data.user.id;
      const th = link.data.properties?.hashed_token;
      manualLink = th ? `${serverEnv().APP_URL}/auth/confirm?token_hash=${th}&type=invite` : link.data.properties?.action_link ?? null;
    }
  }
  const db = await createClient();
  const { error } = await db.from('client_members').upsert({ client_id: p.data.client_id, user_id: userId, role: p.data.role, invited_by: s.userId });
  if (error) return dbError(error)!;
  revalidatePath(`/admin/clients/${p.data.client_id}`);
  return manualLink
    ? { ok: true, message: `Invite email could not be sent. Share this one-time link securely: ${manualLink}` }
    : { ok: true, message: existing ? `${email} already had an account and now has access.` : `Invitation sent to ${email}.`, nonce: Date.now() };
}

export async function updateMemberRoleAction(fd: FormData) {
  await requireAdmin();
  const clientId = z.uuid().parse(fd.get('client_id'));
  const userId = z.uuid().parse(fd.get('user_id'));
  const role = z.enum(['owner', 'member', 'viewer', 'remove']).parse(fd.get('role'));
  const db = await createClient();
  if (role === 'remove') await db.from('client_members').delete().eq('client_id', clientId).eq('user_id', userId);
  else await db.from('client_members').update({ role }).eq('client_id', clientId).eq('user_id', userId);
  revalidatePath(`/admin/clients/${clientId}`);
}

const PropertyForm = z.object({
  client_id: z.uuid(), name: reqStr(200), address_line1: optStr(200), address_line2: optStr(200), city: optStr(100),
  region: optStr(100), postal_code: optStr(20), country: optStr(60), timezone: z.string().min(1).max(64),
  exit_delay_s: z.coerce.number().int().min(0).max(600).default(60), access_notes: optStr(2000),
});
export async function createPropertyAction(_: ActionResult, fd: FormData): Promise<ActionResult> {
  await requireStaff();
  const p = parseForm(PropertyForm, fd);
  if (!p.ok) return p.result;
  const db = await createClient();
  const { data, error } = await db.from('properties').insert(p.data).select('id').single();
  if (error) return dbError(error)!;
  revalidatePath(`/admin/clients/${p.data.client_id}`);
  redirect(`/admin/properties/${data.id}`);
}
