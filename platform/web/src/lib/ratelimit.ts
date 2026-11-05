/**
 * Fixed-window in-memory rate limiter. Per server instance only — when running
 * several instances, back this with a shared store (Redis/Upstash). Documented
 * in docs/DEPLOYMENT.md.
 */
const windows = new Map<string, { start: number; count: number }>();

export function rateLimit(key: string, limit: number, windowMs: number, now = Date.now()): { ok: boolean; retryAfterS: number } {
  const w = windows.get(key);
  if (!w || now - w.start >= windowMs) {
    windows.set(key, { start: now, count: 1 });
    if (windows.size > 50_000) {
      for (const [k, v] of windows) if (now - v.start >= windowMs) windows.delete(k);
    }
    return { ok: true, retryAfterS: 0 };
  }
  w.count++;
  return w.count <= limit ? { ok: true, retryAfterS: 0 } : { ok: false, retryAfterS: Math.ceil((w.start + windowMs - now) / 1000) };
}
