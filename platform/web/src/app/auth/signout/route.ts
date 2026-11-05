import { NextResponse, type NextRequest } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { appUrl } from '@/lib/app-url';

export async function POST(_req: NextRequest) {
  const supabase = await createClient();
  await supabase.auth.signOut();
  return NextResponse.redirect(appUrl('/login'), { status: 303 });
}
