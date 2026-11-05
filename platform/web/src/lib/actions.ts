import 'server-only';
import { z } from 'zod';
import type { ActionResult } from '@/components/ui/forms';

/** Parse FormData with a zod schema, returning a friendly ActionResult on failure. */
export function parseForm<S extends z.ZodType>(schema: S, fd: FormData): { ok: true; data: z.infer<S> } | { ok: false; result: ActionResult } {
  const raw: Record<string, unknown> = {};
  for (const [k, v] of fd.entries()) {
    if (k.startsWith('$ACTION')) continue;
    if (k.endsWith('[]')) ((raw[k.slice(0, -2)] ??= []) as unknown[]).push(v);
    else raw[k] = typeof v === 'string' ? v.trim() : v;
  }
  const r = schema.safeParse(raw);
  if (r.success) return { ok: true, data: r.data };
  const fieldErrors: Record<string, string> = {};
  for (const i of r.error.issues) fieldErrors[i.path.join('.')] ??= i.message;
  return { ok: false, result: { error: Object.entries(fieldErrors).map(([k, v]) => `${k}: ${v}`).join(' · '), fieldErrors } };
}

export const optStr = (max = 500) => z.string().max(max).optional().transform((v) => (v ? v : null));
export const reqStr = (max = 200) => z.string().min(1, 'required').max(max);
export const optEmail = z.union([z.literal(''), z.email()]).optional().transform((v) => (v ? v.toLowerCase() : null));

export function dbError(e: { message: string; code?: string } | null): ActionResult | null {
  if (!e) return null;
  if (e.code === '23505') return { error: 'That value is already in use (must be unique).' };
  if (e.code === '42501') return { error: 'You do not have permission to do that.' };
  if (e.code === '23514' || e.code === '22023') return { error: e.message };
  console.error('db error', e);
  return { error: 'Something went wrong saving your changes.' };
}
