import 'server-only';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { serverEnv } from '../env';
import { serverSupabaseUrl } from '../public-env';

// eslint-disable-next-line @typescript-eslint/no-explicit-any -- schema types are applied at call sites (lib/types.ts)
let client: SupabaseClient<any> | null = null;

/**
 * Service-role client. BYPASSES RLS — use only after the caller has been
 * authenticated/authorised by other means (gateway token, staff check, cron secret).
 */
export function adminClient(): SupabaseClient<any> { // eslint-disable-line @typescript-eslint/no-explicit-any
  if (client) return client;
  const env = serverEnv();
  client = createClient(serverSupabaseUrl() || env.NEXT_PUBLIC_SUPABASE_URL, env.SUPABASE_SECRET_KEY, {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
    global: { headers: { 'x-application-name': 'ruview-platform-server' } },
  });
  return client;
}
