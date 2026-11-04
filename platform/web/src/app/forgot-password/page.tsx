import Link from 'next/link';
import { ActionForm, SubmitButton } from '@/components/ui/forms';
import { Field, Input } from '@/components/ui';
import { BrandMark } from '@/components/brand';
import { requestReset } from './actions';

export const metadata = { title: 'Reset password' };

export default function ForgotPassword() {
  return (
    <main className="flex min-h-dvh items-center justify-center px-4">
      <div className="w-full max-w-sm">
        <BrandMark className="mb-6 h-8 w-8" />
        <h1 className="text-2xl font-semibold">Reset your password</h1>
        <p className="mt-1 text-sm text-muted">We will email you a secure link.</p>
        <ActionForm action={requestReset} className="mt-6 space-y-4">
          <Field label="Email"><Input name="email" type="email" required autoComplete="email" /></Field>
          <div className="flex items-center justify-between">
            <Link href="/login" className="text-sm text-muted hover:text-fg">Back to sign in</Link>
            <SubmitButton pendingLabel="Sending…">Send link</SubmitButton>
          </div>
        </ActionForm>
      </div>
    </main>
  );
}
