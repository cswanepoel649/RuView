import 'server-only';
import { cache } from 'react';
import { redirect } from 'next/navigation';
import { createClient } from './supabase/server';
import type { MemberRole, Profile } from './types';

export interface Membership { client_id: string; role: MemberRole; client_name: string; client_status: string }
export interface SessionContext {
  userId: string;
  email: string;
  profile: Profile;
  isStaff: boolean;
  isAdmin: boolean;
  memberships: Membership[];
}

/** Per-request session context (verified JWT claims + profile + memberships). */
export const getSession = cache(async (): Promise<SessionContext | null> => {
  const supabase = await createClient();
  const { data } = await supabase.auth.getClaims();
  const sub = data?.claims?.sub;
  if (!sub) return null;
  const [{ data: profile }, { data: members }] = await Promise.all([
    supabase.from('profiles').select('id, email, full_name, phone, platform_role').eq('id', sub).single(),
    supabase.from('client_members').select('client_id, role, clients(display_name, status)').eq('user_id', sub),
  ]);
  if (!profile) return null;
  const memberships: Membership[] = ((members ?? []) as unknown as { client_id: string; role: MemberRole; clients: { display_name: string; status: string } | null }[])
    .map((m) => ({ client_id: m.client_id, role: m.role, client_name: m.clients?.display_name ?? '—', client_status: m.clients?.status ?? 'active' }));
  return {
    userId: sub,
    email: (profile as Profile).email,
    profile: profile as Profile,
    isStaff: !!(profile as Profile).platform_role,
    isAdmin: (profile as Profile).platform_role === 'platform_admin',
    memberships,
  };
});

export async function requireSession() {
  const s = await getSession();
  if (!s) redirect('/login');
  return s;
}
export async function requireStaff() {
  const s = await requireSession();
  if (!s.isStaff) redirect('/app');
  return s;
}
export async function requireAdmin() {
  const s = await requireStaff();
  if (!s.isAdmin) redirect('/admin?denied=1');
  return s;
}
/** Client portal access: any membership (staff may preview via /admin instead). */
export async function requireClientUser() {
  const s = await requireSession();
  if (!s.memberships.length && s.isStaff) redirect('/admin');
  return s;
}
export function roleFor(s: SessionContext, clientId: string): MemberRole | null {
  return s.memberships.find((m) => m.client_id === clientId)?.role ?? null;
}
export function canOperate(s: SessionContext, clientId: string) {
  const r = roleFor(s, clientId);
  return s.isStaff || r === 'owner' || r === 'member';
}
