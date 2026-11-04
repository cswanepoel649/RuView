import { redirect } from 'next/navigation';
import { ActionForm, SubmitButton } from '@/components/ui/forms';
import { Field, Input } from '@/components/ui';
import { BrandMark } from '@/components/brand';
import { getSession } from '@/lib/auth';
import { updatePassword } from './actions';

export const metadata = { title: 'Set password' };

export default async function UpdatePassword() {
  const s = await getSession();
  if (!s) redirect('/login?error=link');
  return (
    <main className="flex min-h-dvh items-center justify-center px-4">
      <div className="w-full max-w-sm">
        <BrandMark className="mb-6 h-8 w-8" />
        <h1 className="text-2xl font-semibold">Choose a password</h1>
        <p className="mt-1 text-sm text-muted">Signed in as {s.email}. At least 12 characters.</p>
        <ActionForm action={updatePassword} className="mt-6 space-y-4">
          <Field label="New password"><Input name="password" type="password" minLength={12} required autoComplete="new-password" /></Field>
          <Field label="Confirm password"><Input name="confirm" type="password" minLength={12} required autoComplete="new-password" /></Field>
          <div className="flex justify-end"><SubmitButton>Save password</SubmitButton></div>
        </ActionForm>
      </div>
    </main>
  );
}
