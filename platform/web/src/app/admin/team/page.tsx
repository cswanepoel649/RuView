import { Button, Card, CardBody, CardHeader, Field, Input, PageHeader, Select, Table, Td, Th } from '@/components/ui';
import { ActionForm, SubmitButton } from '@/components/ui/forms';
import { requireAdmin } from '@/lib/auth';
import { createClient } from '@/lib/supabase/server';
import type { Profile } from '@/lib/types';
import { inviteStaffAction, setStaffRoleAction } from './actions';

export const metadata = { title: 'Team' };

export default async function TeamPage() {
  const s = await requireAdmin();
  const db = await createClient();
  const { data } = await db.from('profiles').select('*').not('platform_role', 'is', null).order('full_name');
  return (
    <>
      <PageHeader title="Team" subtitle="Administrators manage everything; installers manage properties, devices and installations but not clients, users or firmware." />
      <div className="grid gap-6 xl:grid-cols-[1fr_340px]">
        <Card>
          <Table>
            <thead><tr><Th>Member</Th><Th>Role</Th></tr></thead>
            <tbody>{((data ?? []) as Profile[]).map((u) => (
              <tr key={u.id}>
                <Td><p className="font-medium">{u.full_name ?? u.email}</p><p className="text-xs text-muted">{u.email}</p></Td>
                <Td>{u.id === s.userId ? <span className="text-sm text-muted">You (administrator)</span> : (
                  <form action={setStaffRoleAction} className="flex gap-1"><input type="hidden" name="id" value={u.id} />
                    <Select name="role" defaultValue={u.platform_role ?? 'none'} className="py-1"><option value="platform_admin">Administrator</option><option value="installer">Installer</option><option value="none">Remove staff access</option></Select>
                    <Button type="submit" variant="secondary" className="py-1">Apply</Button></form>
                )}</Td>
              </tr>
            ))}</tbody>
          </Table>
        </Card>
        <Card className="h-fit"><CardHeader title="Add team member" /><CardBody>
          <ActionForm action={inviteStaffAction} resetOnSuccess className="space-y-3">
            <Field label="Email"><Input name="email" type="email" required /></Field>
            <Field label="Full name"><Input name="full_name" /></Field>
            <Field label="Role"><Select name="role" defaultValue="installer"><option value="installer">Installer</option><option value="platform_admin">Administrator</option></Select></Field>
            <div className="flex justify-end"><SubmitButton>Invite</SubmitButton></div>
          </ActionForm>
        </CardBody></Card>
      </div>
    </>
  );
}
