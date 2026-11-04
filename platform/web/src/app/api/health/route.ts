import { NextResponse } from 'next/server';

export const dynamic = 'force-dynamic';

/** Liveness probe (used by ruview-agent doctor and uptime monitors). No secrets, no DB. */
export function GET() {
  return NextResponse.json({ status: 'ok', service: 'ruview-platform', time: new Date().toISOString() });
}
