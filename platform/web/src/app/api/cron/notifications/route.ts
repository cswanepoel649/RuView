import { NextResponse } from 'next/server';
import { adminClient } from '@/lib/supabase/admin';
import { authorizeCron } from '@/lib/cron';
import { serverEnv } from '@/lib/env';
import { renderAlertEmail, sendEmail } from '@/lib/notify/email';

export const dynamic = 'force-dynamic';
export const maxDuration = 60;

interface Claimed { id: string; user_id: string; channel: string; title: string; body: string | null; severity: string; link: string | null; attempts: number }

/** Delivers queued email notifications (claimed with SKIP LOCKED, safe to run concurrently). */
export async function GET(req: Request) {
  if (!authorizeCron(req)) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  const db = adminClient();
  const { data, error } = await db.rpc('claim_pending_notifications', { p_limit: 50 });
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  const batch = (data ?? []) as Claimed[];
  if (!batch.length) return NextResponse.json({ sent: 0 });
  const { data: profiles } = await db.from('profiles').select('id, email').in('id', [...new Set(batch.map((b) => b.user_id))]);
  const emails = new Map((profiles ?? []).map((p) => [p.id as string, p.email as string]));
  const tally = { sent: 0, failed: 0, skipped: 0 };
  for (const n of batch) {
    const to = emails.get(n.user_id);
    if (n.channel !== 'email' || !to) {
      await db.from('notifications').update({ status: 'skipped', error: n.channel !== 'email' ? `channel ${n.channel} not implemented` : 'no email address' }).eq('id', n.id);
      tally.skipped++;
      continue;
    }
    const r = await sendEmail({ to, ...renderAlertEmail(n, serverEnv().APP_URL) });
    if (r.ok) {
      await db.from('notifications').update({ status: 'sent', sent_at: new Date().toISOString(), error: null }).eq('id', n.id);
      tally.sent++;
    } else {
      const retry = !r.permanent && n.attempts < 5;
      await db.from('notifications').update({ status: retry ? 'pending' : r.permanent && r.error.includes('not configured') ? 'skipped' : 'failed', error: r.error }).eq('id', n.id);
      if (retry) tally.failed++; else tally.skipped++;
    }
  }
  return NextResponse.json(tally);
}
