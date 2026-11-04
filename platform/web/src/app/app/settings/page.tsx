import { Badge, Button, Card, CardBody, CardHeader, Checkbox, Field, Input, Notice, PageHeader, Select } from '@/components/ui';
import { ActionForm, SubmitButton } from '@/components/ui/forms';
import { canOperate, requireClientUser } from '@/lib/auth';
import { createClient } from '@/lib/supabase/server';
import type { AlertRule, Property, Room, Zone } from '@/lib/types';
import { addRuleAction, savePreferencesAction, toggleRuleAction } from './actions';

export const metadata = { title: 'Notifications' };

export default async function SettingsPage() {
  const s = await requireClientUser();
  const db = await createClient();
  const [{ data: prefs }, { data: types }, { data: rules }, { data: props }, { data: rooms }, { data: zones }] = await Promise.all([
    db.from('notification_preferences').select('*').eq('user_id', s.userId),
    db.from('event_types').select('code, label, category, default_severity, notifiable').eq('notifiable', true).order('category').order('label'),
    db.from('alert_rules').select('*').order('created_at'),
    db.from('properties').select('id, name, client_id').order('name'),
    db.from('rooms').select('id, name, property_id').order('name'),
    db.from('security_zones').select('id, name, property_id').order('name'),
  ]);
  const T = (types ?? []) as { code: string; label: string; category: string; default_severity: string }[];
  const label = new Map(T.map((t) => [t.code, t.label]));
  const P = (props ?? []) as Pick<Property, 'id' | 'name' | 'client_id'>[];
  const R = (rooms ?? []) as Pick<Room, 'id' | 'name' | 'property_id'>[];
  const Z = (zones ?? []) as Pick<Zone, 'id' | 'name' | 'property_id'>[];
  return (
    <>
      <PageHeader title="Notifications" subtitle="Choose how you are alerted. Alert rules decide which events notify your household; preferences are personal." />
      <div className="space-y-6">
        {s.memberships.map((m) => {
          const pref = ((prefs ?? []) as Record<string, unknown>[]).find((p) => p.client_id === m.client_id) as { email_enabled?: boolean; min_severity?: string; quiet_hours?: { start: string; end: string } | null; muted_event_types?: string[] } | undefined;
          const myProps = P.filter((p) => p.client_id === m.client_id);
          const myRules = ((rules ?? []) as AlertRule[]).filter((r) => r.client_id === m.client_id);
          const editable = canOperate(s, m.client_id);
          return (
            <div key={m.client_id} className="grid gap-6 xl:grid-cols-[1fr_1.2fr]">
              <Card><CardHeader title="My preferences" subtitle={s.memberships.length > 1 ? m.client_name : `Delivered to ${s.email}`} /><CardBody>
                <ActionForm action={savePreferencesAction} className="space-y-4">
                  <input type="hidden" name="client_id" value={m.client_id} />
                  <Checkbox name="email_enabled" defaultChecked={pref?.email_enabled ?? true} label="Email me alerts" />
                  <Field label="Email only for" hint="In-app notifications are always kept."><Select name="min_severity" defaultValue={pref?.min_severity ?? 'info'}><option value="info">All matching alerts</option><option value="warning">Warnings and critical</option><option value="critical">Critical only</option></Select></Field>
                  <div className="grid grid-cols-2 gap-3">
                    <Field label="Quiet hours from"><Input type="time" name="quiet_start" defaultValue={pref?.quiet_hours?.start ?? ''} /></Field>
                    <Field label="until"><Input type="time" name="quiet_end" defaultValue={pref?.quiet_hours?.end ?? ''} /></Field>
                  </div>
                  <p className="text-xs text-muted">Critical alarms (intrusion, possible fall, gateway offline) are always emailed, even in quiet hours.</p>
                  <fieldset><legend className="mb-1 text-sm font-medium">Mute (non-critical)</legend>
                    <div className="grid gap-1.5 sm:grid-cols-2">{T.filter((t) => t.default_severity !== 'critical').map((t) => <Checkbox key={t.code} name="muted[]" value={t.code} label={t.label} defaultChecked={pref?.muted_event_types?.includes(t.code)} />)}</div>
                  </fieldset>
                  <div className="flex justify-end"><SubmitButton>Save preferences</SubmitButton></div>
                </ActionForm>
              </CardBody></Card>
              <Card><CardHeader title="Household alert rules" subtitle="Events that create notifications for everyone in the household" />
                <ul className="divide-y divide-border">{myRules.map((r) => (
                  <li key={r.id} className="flex flex-wrap items-center justify-between gap-2 px-5 py-2.5">
                    <span className="text-sm"><span className="font-medium">{label.get(r.event_type) ?? r.event_type}</span>
                      <span className="block text-xs text-muted">{[P.find((p) => p.id === r.property_id)?.name ?? 'All properties', r.room_id && `room ${R.find((x) => x.id === r.room_id)?.name}`, r.zone_id && `zone ${Z.find((x) => x.id === r.zone_id)?.name}`, r.schedule && `${r.schedule.start}–${r.schedule.end}`, r.channels.includes('email') ? 'app + email' : 'app only'].filter(Boolean).join(' · ')}</span></span>
                    <span className="flex items-center gap-1">{!r.enabled && <Badge>Off</Badge>}
                      {editable && <form action={toggleRuleAction} className="flex gap-1"><input type="hidden" name="id" value={r.id} />
                        <Button variant="ghost" type="submit" name="op" value={r.enabled ? 'disable' : 'enable'} className="py-1">{r.enabled ? 'Turn off' : 'Turn on'}</Button>
                        <Button variant="ghost" type="submit" name="op" value="delete" className="py-1">Delete</Button></form>}
                    </span>
                  </li>
                ))}</ul>
                {editable ? (
                  <CardBody className="border-t border-border">
                    <ActionForm action={addRuleAction} resetOnSuccess className="grid gap-3 sm:grid-cols-2">
                      <input type="hidden" name="client_id" value={m.client_id} />
                      <Field label="Event"><Select name="event_type">{T.map((t) => <option key={t.code} value={t.code}>{t.label}</option>)}</Select></Field>
                      <Field label="Property"><Select name="property_id">{myProps.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}</Select></Field>
                      <Field label="Where" className="sm:col-span-2"><Select name="target" defaultValue="all"><option value="all">Anywhere at the property</option>
                        {R.filter((r) => myProps.some((p) => p.id === r.property_id)).map((r) => <option key={r.id} value={`room:${r.id}`}>Room: {r.name}</option>)}
                        {Z.filter((z) => myProps.some((p) => p.id === z.property_id)).map((z) => <option key={z.id} value={`zone:${z.id}`}>Zone: {z.name}</option>)}</Select></Field>
                      <Field label="Only between (optional)"><Input type="time" name="start" /></Field>
                      <Field label="and"><Input type="time" name="end" /></Field>
                      <Checkbox name="email" label="Also send email" />
                      <div className="flex justify-end sm:col-span-2"><SubmitButton>Add rule</SubmitButton></div>
                    </ActionForm>
                    <p className="mt-3 text-xs text-muted">Example: “Presence detected · Room: Office · 22:00–06:00” notifies you of night-time activity without arming the system.</p>
                  </CardBody>
                ) : <CardBody><Notice>Viewers cannot change household rules.</Notice></CardBody>}
              </Card>
            </div>
          );
        })}
      </div>
    </>
  );
}
