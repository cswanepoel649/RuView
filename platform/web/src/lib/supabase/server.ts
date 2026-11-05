import 'server-only';
import { createServerClient } from '@supabase/ssr';
import { cookies } from 'next/headers';
import { publicEnv, serverSupabaseUrl, SUPABASE_COOKIE_NAME } from '../public-env';

/** User-scoped client for Server Components / Actions / Route Handlers. RLS applies. */
export async function createClient() {
  const store = await cookies();
  return createServerClient(serverSupabaseUrl(), publicEnv.supabaseKey, {
    cookieOptions: { name: SUPABASE_COOKIE_NAME },
    cookies: {
      getAll: () => store.getAll(),
      setAll: (list) => {
        try {
          for (const { name, value, options } of list) store.set(name, value, options);
        } catch {
          // Called from a Server Component: cookies are read-only there; proxy.ts refreshes sessions.
        }
      },
    },
  });
}
