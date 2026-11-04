import type { Metadata } from 'next';
import Link from 'next/link';
import { BrandMark } from '@/components/brand';
import { ActionForm, SubmitButton } from '@/components/ui/forms';
import { Field, Input } from '@/components/ui';
import { signIn } from './actions';

export const metadata: Metadata = { title: 'Sign in' };

export default async function LoginPage({ searchParams }: { searchParams: Promise<{ next?: string; reset?: string }> }) {
  const sp = await searchParams;
  return (
    <main className="grid min-h-dvh lg:grid-cols-2">
      <div className="flex items-center justify-center px-4 py-12">
        <div className="w-full max-w-sm">
          <div className="mb-8 flex items-center gap-3">
            <BrandMark />
            <span className="text-lg font-semibold">RuView Monitoring</span>
          </div>
          <h1 className="text-2xl font-semibold tracking-tight">Sign in</h1>
          <p className="mt-1 text-sm text-muted">Use the email address your installer registered.</p>
          {sp.reset && <p className="mt-4 rounded-lg bg-ok-soft px-3 py-2 text-sm text-ok">Password updated — sign in with your new password.</p>}
          <ActionForm action={signIn} className="mt-6 space-y-4">
            <input type="hidden" name="next" value={sp.next ?? ''} />
            <Field label="Email"><Input name="email" type="email" autoComplete="email" required /></Field>
            <Field label="Password"><Input name="password" type="password" autoComplete="current-password" required /></Field>
            <div className="flex items-center justify-between">
              <Link href="/forgot-password" className="text-sm text-brand hover:underline">Forgot password?</Link>
              <SubmitButton pendingLabel="Signing in…">Sign in</SubmitButton>
            </div>
          </ActionForm>
        </div>
      </div>
      <aside className="relative hidden overflow-hidden bg-nav lg:block">
        <div className="absolute inset-0 opacity-30" style={{ background: 'radial-gradient(60% 50% at 70% 30%, var(--brand) 0%, transparent 60%), radial-gradient(40% 40% at 20% 80%, var(--occupied) 0%, transparent 60%)' }} />
        <div className="relative flex h-full flex-col justify-end p-12 text-nav-fg">
          <p className="max-w-md text-2xl font-semibold leading-snug text-white">Private, camera-free monitoring for every room.</p>
          <p className="mt-3 max-w-md text-sm">Presence, motion and safety alerts from WiFi sensing — no cameras, no microphones, no wearables.</p>
        </div>
      </aside>
    </main>
  );
}
