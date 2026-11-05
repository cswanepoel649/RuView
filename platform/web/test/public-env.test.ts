import { afterEach, describe, expect, it, vi } from 'vitest';

describe('Supabase URL handling for Docker (internal vs public origin)', () => {
  afterEach(() => { vi.unstubAllEnvs(); vi.resetModules(); });
  it('uses the internal URL server-side and rewrites signed links to the public origin', async () => {
    vi.stubEnv('NEXT_PUBLIC_SUPABASE_URL', 'http://localhost:8000');
    vi.stubEnv('SUPABASE_INTERNAL_URL', 'http://api-gw:8000');
    const m = await import('../src/lib/public-env');
    expect(m.serverSupabaseUrl()).toBe('http://api-gw:8000');
    expect(m.toPublicSupabaseUrl('http://api-gw:8000/storage/v1/object/sign/floor-plans/a.png?token=x'))
      .toBe('http://localhost:8000/storage/v1/object/sign/floor-plans/a.png?token=x');
    expect(m.toPublicSupabaseUrl('https://cdn.example.com/x')).toBe('https://cdn.example.com/x');
  });
  it('is a no-op without an internal URL (hosted Supabase)', async () => {
    vi.stubEnv('NEXT_PUBLIC_SUPABASE_URL', 'https://abc.supabase.co');
    vi.stubEnv('SUPABASE_INTERNAL_URL', '');
    const m = await import('../src/lib/public-env');
    expect(m.serverSupabaseUrl()).toBe('https://abc.supabase.co');
    expect(m.toPublicSupabaseUrl('https://abc.supabase.co/storage/v1/x')).toBe('https://abc.supabase.co/storage/v1/x');
  });
});
