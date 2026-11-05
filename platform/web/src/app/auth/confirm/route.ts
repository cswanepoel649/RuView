import { NextResponse, type NextRequest } from 'next/server';
import type { EmailOtpType } from '@supabase/supabase-js';
import { createClient } from '@/lib/supabase/server';
import { appUrl } from '@/lib/app-url';

/**
 * Email link verification (invite, recovery, magic link). Configure the Supabase
 * email templates to link to: {{ .SiteURL }}/auth/confirm?token_hash={{ .TokenHash }}&type=<type>
 */
export async function GET(req: NextRequest) {
  const token_hash = req.nextUrl.searchParams.get('token_hash');
  const type = req.nextUrl.searchParams.get('type') as EmailOtpType | null;
  const allowed: EmailOtpType[] = ['invite', 'recovery', 'magiclink', 'email', 'signup', 'email_change'];
  if (token_hash && type && allowed.includes(type)) {
    const supabase = await createClient();
    const { error } = await supabase.auth.verifyOtp({ token_hash, type });
    if (!error) {
      const dest = type === 'invite' || type === 'recovery' ? '/update-password' : '/';
      return NextResponse.redirect(appUrl(dest));
    }
  }
  return NextResponse.redirect(appUrl('/login?error=link'));
}
