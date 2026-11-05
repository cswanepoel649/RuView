/** Browser-safe configuration (inlined at build time). */
export const publicEnv = {
  supabaseUrl: process.env.NEXT_PUBLIC_SUPABASE_URL ?? '',
  supabaseKey: process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY ?? process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? '',
};

/**
 * Fixed auth cookie name. @supabase/ssr otherwise derives it from the URL host, which
 * differs between the browser (public URL) and the server when SUPABASE_INTERNAL_URL
 * is used (e.g. http://api-gw:8000 inside Docker) — the session would not be shared.
 */
export const SUPABASE_COOKIE_NAME = 'sb-ruview-auth-token';

/** URL server-side code uses to reach Supabase (internal network address when set). */
export function serverSupabaseUrl(): string {
  return process.env.SUPABASE_INTERNAL_URL || publicEnv.supabaseUrl;
}

/** Rewrites internal Supabase URLs (e.g. signed Storage links) to the public origin. */
export function toPublicSupabaseUrl(url: string): string {
  const internal = process.env.SUPABASE_INTERNAL_URL;
  if (!internal || !publicEnv.supabaseUrl) return url;
  const i = internal.replace(/\/+$/, '');
  return url.startsWith(i) ? publicEnv.supabaseUrl.replace(/\/+$/, '') + url.slice(i.length) : url;
}
