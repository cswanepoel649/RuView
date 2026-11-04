import { Field, Input, Select, Textarea } from '../ui';
import type { Client } from '@/lib/types';

export function ClientFields({ c }: { c?: Partial<Client> }) {
  const b = c?.billing_address ?? {};
  return (
    <div className="grid gap-4 md:grid-cols-2">
      <Field label="Display name" hint="Shown to the client and on alerts."><Input name="display_name" required defaultValue={c?.display_name} /></Field>
      <Field label="Legal / company name"><Input name="legal_name" defaultValue={c?.legal_name ?? ''} /></Field>
      <Field label="Type">
        <Select name="kind" defaultValue={c?.kind ?? 'individual'}><option value="individual">Household / individual</option><option value="business">Business</option></Select>
      </Field>
      <Field label="Account reference" hint="Your internal / billing reference (unique)."><Input name="account_ref" defaultValue={c?.account_ref ?? ''} /></Field>
      <Field label="Primary email"><Input name="primary_email" type="email" defaultValue={c?.primary_email ?? ''} /></Field>
      <Field label="Primary phone"><Input name="primary_phone" type="tel" defaultValue={c?.primary_phone ?? ''} /></Field>
      <Field label="Billing address"><Input name="billing_line1" defaultValue={b.line1 ?? ''} /></Field>
      <div className="grid grid-cols-3 gap-2">
        <Field label="City"><Input name="billing_city" defaultValue={b.city ?? ''} /></Field>
        <Field label="Postal code"><Input name="billing_postal" defaultValue={b.postal_code ?? ''} /></Field>
        <Field label="Country"><Input name="billing_country" defaultValue={b.country ?? ''} /></Field>
      </div>
      {c?.id && (
        <Field label="Status">
          <Select name="status" defaultValue={c.status}><option value="active">Active</option><option value="suspended">Suspended</option><option value="archived">Archived</option></Select>
        </Field>
      )}
      <Field label="Internal notes" className="md:col-span-2" hint="Staff only — never shown to the client."><Textarea name="notes" defaultValue={c?.notes ?? ''} /></Field>
    </div>
  );
}

export function TimezoneSelect({ name = 'timezone', value }: { name?: string; value?: string }) {
  const zones = Intl.supportedValuesOf('timeZone');
  return (
    <Select name={name} defaultValue={value ?? 'UTC'} required>
      <option value="UTC">UTC</option>
      {zones.map((z) => <option key={z} value={z}>{z}</option>)}
    </Select>
  );
}
