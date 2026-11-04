import { Card, CardBody, CardHeader, Field, Input, LinkButton, PageHeader } from '@/components/ui';
import { ActionForm, SubmitButton } from '@/components/ui/forms';
import { requireSession } from '@/lib/auth';
import { changePasswordAction, updateProfileAction } from './actions';

export const metadata = { title: 'Account' };

export default async function Account() {
  const s = await requireSession();
  return (
    <main className="mx-auto max-w-3xl px-4 py-10">
      <PageHeader title="Account" subtitle={s.email} actions={<LinkButton href={s.isStaff ? '/admin' : '/app'}>Back</LinkButton>} />
      <div className="space-y-6">
        <Card><CardHeader title="Profile" /><CardBody>
          <ActionForm action={updateProfileAction} className="grid gap-4 sm:grid-cols-2">
            <Field label="Full name"><Input name="full_name" defaultValue={s.profile.full_name ?? ''} /></Field>
            <Field label="Phone"><Input name="phone" type="tel" defaultValue={s.profile.phone ?? ''} /></Field>
            <div className="sm:col-span-2 flex justify-end"><SubmitButton>Save</SubmitButton></div>
          </ActionForm>
        </CardBody></Card>
        <Card><CardHeader title="Change password" /><CardBody>
          <ActionForm action={changePasswordAction} resetOnSuccess className="grid gap-4 sm:grid-cols-2">
            <Field label="New password"><Input name="password" type="password" minLength={12} required autoComplete="new-password" /></Field>
            <Field label="Confirm"><Input name="confirm" type="password" minLength={12} required autoComplete="new-password" /></Field>
            <div className="sm:col-span-2 flex justify-end"><SubmitButton>Change password</SubmitButton></div>
          </ActionForm>
        </CardBody></Card>
        <Card><CardHeader title="Access" /><CardBody className="text-sm">
          {s.isStaff && <p>Platform role: <strong>{s.isAdmin ? 'Administrator' : 'Installer'}</strong></p>}
          {s.memberships.map((m) => <p key={m.client_id}>{m.client_name}: <strong>{m.role}</strong></p>)}
        </CardBody></Card>
      </div>
    </main>
  );
}
