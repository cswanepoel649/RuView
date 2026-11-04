import { NextResponse } from 'next/server';
import { z } from 'zod';
import { getSession } from '@/lib/auth';
import { createClient } from '@/lib/supabase/server';

export const dynamic = 'force-dynamic';

/** Staff-only streaming of a firmware image for the Web Serial flasher (same-origin, no CORS). */
export async function GET(_: Request, ctx: { params: Promise<{ releaseId: string; role: string }> }) {
  const s = await getSession();
  if (!s?.isStaff) return NextResponse.json({ error: 'forbidden' }, { status: 403 });
  const { releaseId, role } = await ctx.params;
  if (!z.guid().safeParse(releaseId).success || !['bootloader', 'partition_table', 'ota_data', 'app'].includes(role)) {
    return NextResponse.json({ error: 'bad request' }, { status: 400 });
  }
  const db = await createClient();
  const { data: rel } = await db.from('firmware_releases').select('files, status, is_mock_build').eq('id', releaseId).single();
  const f = (rel?.files as Record<string, { path: string; sha256: string }> | undefined)?.[role];
  if (!rel || !f || rel.is_mock_build) return NextResponse.json({ error: 'not found' }, { status: 404 });
  const { data, error } = await db.storage.from('firmware').download(f.path);
  if (error || !data) return NextResponse.json({ error: 'storage error' }, { status: 502 });
  return new NextResponse(data, { headers: { 'content-type': 'application/octet-stream', 'cache-control': 'private, no-store', 'x-content-sha256': f.sha256 } });
}
