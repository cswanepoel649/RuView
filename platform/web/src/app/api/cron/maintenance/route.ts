import { NextResponse } from 'next/server';
import { adminClient } from '@/lib/supabase/admin';
import { authorizeCron } from '@/lib/cron';

export const dynamic = 'force-dynamic';

/**
 * Offline detection, entry-delay alarms, command expiry. pg_cron runs the same
 * function every minute on Supabase; this endpoint is the fallback scheduler.
 */
export async function GET(req: Request) {
  if (!authorizeCron(req)) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  const { data, error } = await adminClient().rpc('run_maintenance');
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json(data);
}
