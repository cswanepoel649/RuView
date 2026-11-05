import 'server-only';
import { NextResponse } from 'next/server';
import type { z } from 'zod';
import { adminClient } from './supabase/admin';
import { sha256Hex } from './crypto';
import { rateLimit } from './ratelimit';

const MAX_BODY = 1_048_576; // 1 MiB

export class ApiError extends Error {
  constructor(readonly status: number, message: string, readonly headers: Record<string, string> = {}) {
    super(message);
  }
}

export const json = (status: number, body: unknown, headers: Record<string, string> = {}) =>
  NextResponse.json(body, { status, headers: { 'cache-control': 'no-store', ...headers } });

export function clientIp(req: Request): string | null {
  const xf = req.headers.get('x-forwarded-for')?.split(',')[0]?.trim() || req.headers.get('x-real-ip')?.trim();
  return xf && /^[0-9a-fA-F:.]{3,45}$/.test(xf) ? xf : null;
}

export async function readJson<S extends z.ZodType>(req: Request, schema: S): Promise<z.infer<S>> {
  const len = Number(req.headers.get('content-length') ?? 0);
  if (len > MAX_BODY) throw new ApiError(413, 'payload too large');
  const text = await req.text();
  if (text.length > MAX_BODY) throw new ApiError(413, 'payload too large');
  let raw: unknown;
  try {
    raw = text ? JSON.parse(text) : {};
  } catch {
    throw new ApiError(400, 'invalid JSON');
  }
  const r = schema.safeParse(raw);
  if (!r.success) throw new ApiError(422, 'validation failed: ' + r.error.issues.slice(0, 5).map((i) => `${i.path.join('.')}: ${i.message}`).join('; '));
  return r.data;
}

/** Authenticates `Authorization: Bearer gw_…` and returns the gateway device id. */
export async function authenticateGateway(req: Request): Promise<string> {
  const auth = req.headers.get('authorization') ?? '';
  const m = /^Bearer (gw_[A-Za-z0-9_-]{40,64})$/.exec(auth);
  if (!m) throw new ApiError(401, 'missing or malformed gateway token');
  const tokenHash = sha256Hex(m[1]!);
  const rl = rateLimit(`gw:${tokenHash}`, 240, 60_000);
  if (!rl.ok) throw new ApiError(429, 'rate limited', { 'retry-after': String(rl.retryAfterS) });
  const { data, error } = await adminClient().rpc('gateway_authenticate', { p_token_hash: tokenHash });
  if (error) throw new ApiError(503, 'authentication backend unavailable');
  if (!data) throw new ApiError(401, 'invalid or revoked gateway token');
  return data as string;
}

/** Maps Postgres errors raised by the ingest functions to HTTP statuses. */
export function pgError(e: { code?: string; message: string }): ApiError {
  if (e.code === '28000') return new ApiError(403, e.message);
  if (e.code === 'P0002') return new ApiError(404, e.message);
  if (e.code === '22P02' || e.code === '22023' || e.code === '23514') return new ApiError(422, e.message);
  return new ApiError(500, 'internal error');
}

export function handle(fn: (req: Request, ctx: { params: Promise<Record<string, string>> }) => Promise<Response>) {
  return async (req: Request, ctx: { params: Promise<Record<string, string>> }) => {
    try {
      return await fn(req, ctx);
    } catch (e) {
      if (e instanceof ApiError) return json(e.status, { error: e.message }, e.headers);
      console.error('gateway api error', e);
      return json(500, { error: 'internal error' });
    }
  };
}
