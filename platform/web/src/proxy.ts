import { NextResponse, type NextRequest } from 'next/server';
import { createServerClient } from '@supabase/ssr';
import { publicEnv, serverSupabaseUrl, SUPABASE_COOKIE_NAME } from './lib/public-env';

const PUBLIC_PREFIXES = ['/login', '/auth', '/forgot-password', '/api/gateway', '/api/cron', '/api/health', '/install', '/email-templates'];

/**
 * Refreshes the Supabase session cookie on every navigation and redirects
 * unauthenticated users to /login. Authorisation (staff vs client, tenant
 * scope) is enforced server-side in layouts/actions and by Postgres RLS —
 * this is only the first gate.
 */
export async function proxy(request: NextRequest) {
  const { pathname } = request.nextUrl;
  if (PUBLIC_PREFIXES.some((p) => pathname === p || pathname.startsWith(p + '/'))) {
    return NextResponse.next();
  }
  let response = NextResponse.next({ request });
  const supabase = createServerClient(
    serverSupabaseUrl(),
    publicEnv.supabaseKey,
    {
      cookieOptions: { name: SUPABASE_COOKIE_NAME },
      cookies: {
        getAll: () => request.cookies.getAll(),
        setAll: (list, headers) => {
          for (const { name, value } of list) request.cookies.set(name, value);
          response = NextResponse.next({ request });
          for (const { name, value, options } of list) response.cookies.set(name, value, options);
          for (const [k, v] of Object.entries(headers ?? {})) response.headers.set(k, String(v));
        },
      },
    },
  );
  const { data } = await supabase.auth.getClaims();
  if (!data?.claims?.sub) {
    // Redirect on the public origin (APP_URL): behind Docker/reverse proxies the request URL
    // carries the bind address (e.g. 0.0.0.0), which browsers cannot use and which drops cookies.
    const url = new URL('/login', process.env.APP_URL || request.nextUrl.origin);
    if (pathname !== '/') url.searchParams.set('next', pathname + request.nextUrl.search);
    return NextResponse.redirect(url);
  }
  return response;
}

export const config = {
  matcher: ['/((?!_next/static|_next/image|favicon.ico|icon.svg|.*\\.(?:png|jpg|jpeg|svg|webp)$).*)'],
};
