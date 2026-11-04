import { Card, CardBody, PageHeader } from '@/components/ui';
import { ActionForm, SubmitButton } from '@/components/ui/forms';
import { ClientFields } from '@/components/admin/ClientFields';
import { requireAdmin } from '@/lib/auth';
import { createClientAction } from '../actions';

export const metadata = { title: 'New client' };

export default async function NewClient() {
  await requireAdmin();
  return (
    <>
      <PageHeader title="New client" breadcrumbs={[{ href: '/admin/clients', label: 'Clients' }]} subtitle="Create the account first; add properties, users and devices next." />
      <Card><CardBody>
        <ActionForm action={createClientAction}>
          <ClientFields />
          <div className="mt-6 flex justify-end"><SubmitButton>Create client</SubmitButton></div>
        </ActionForm>
      </CardBody></Card>
    </>
  );
}
