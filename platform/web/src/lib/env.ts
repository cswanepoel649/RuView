import 'server-only';
import { z } from 'zod';

const ServerEnv = z.object({
  NEXT_PUBLIC_SUPABASE_URL: z.url(),
  NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: z.string().min(20),
  SUPABASE_SECRET_KEY: z.string().min(20),
  APP_URL: z.url(),
  SUPABASE_INTERNAL_URL: z.union([z.literal(''), z.url()]).optional(),
  DEVICE_SECRET_KEY: z.string().regex(/^[0-9a-f]{64}$/, 'DEVICE_SECRET_KEY must be 32 bytes hex (openssl rand -hex 32)'),
  CRON_SECRET: z.string().min(32),
  RESEND_API_KEY: z.string().optional().transform((v) => v || undefined),
  EMAIL_FROM: z.string().optional().transform((v) => v || undefined),
});
export type ServerEnv = z.infer<typeof ServerEnv>;

let cached: ServerEnv | null = null;

/** Validated server environment. Throws a descriptive error on misconfiguration. */
export function serverEnv(): ServerEnv {
  if (cached) return cached;
  const parsed = ServerEnv.safeParse({
    ...process.env,
    NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY ?? process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY,
    SUPABASE_SECRET_KEY: process.env.SUPABASE_SECRET_KEY ?? process.env.SUPABASE_SERVICE_ROLE_KEY,
  });
  if (!parsed.success) {
    throw new Error('Invalid server environment: ' + parsed.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('; '));
  }
  cached = parsed.data;
  return cached;
}
