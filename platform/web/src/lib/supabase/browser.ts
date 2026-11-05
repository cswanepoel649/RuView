'use client';
import { createBrowserClient } from '@supabase/ssr';
import { publicEnv, SUPABASE_COOKIE_NAME } from '../public-env';

import type { SupabaseClient } from '@supabase/supabase-js';
// eslint-disable-next-line @typescript-eslint/no-explicit-any
let client: SupabaseClient<any> | null = null;

export function browserClient() {
  client ??= createBrowserClient(publicEnv.supabaseUrl, publicEnv.supabaseKey, { cookieOptions: { name: SUPABASE_COOKIE_NAME } });
  return client;
}
