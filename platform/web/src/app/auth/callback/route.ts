import { NextResponse, type NextRequest } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { appUrl } from '@/lib/app-url';

/** OAuth/PKCE code exchange (magic links & invites using the PKCE flow). */
export async function GET(req: NextRequest) {
  const code = req.nextUrl.searchParams.get('code');
  const next = req.nextUrl.searchParams.get('next') ?? '/';
  const dest = next.startsWith('/') && !next.startsWith('//') ? next : '/';
  if (code) {
    const supabase = await createClient();
    const { error } = await supabase.auth.exchangeCodeForSession(code);
    if (!error) return NextResponse.redirect(appUrl(dest));
  }
  return NextResponse.redirect(appUrl('/login?error=link'));
}
