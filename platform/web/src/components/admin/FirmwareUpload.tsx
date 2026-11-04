'use client';
import { useState } from 'react';
import { browserClient } from '@/lib/supabase/browser';
import { Button, Checkbox, Field, Input, Notice, Select, Textarea } from '../ui';

const ROLES = [
  { role: 'bootloader', label: 'bootloader.bin' },
  { role: 'partition_table', label: 'partition-table.bin (or -4mb)' },
  { role: 'ota_data', label: 'ota_data_initial.bin' },
  { role: 'app', label: 'esp32-csi-node.bin (or -4mb)' },
] as const;

export function FirmwareUpload({ models, create }: { models: { id: string; name: string }[]; create: (input: unknown) => Promise<{ ok: boolean; error?: string; warnings?: string[] }> }) {
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<{ tone: 'ok' | 'bad' | 'warn'; text: string } | null>(null);

  async function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const fd = new FormData(e.currentTarget);
    const version = String(fd.get('version'));
    const flash = Number(fd.get('flash_size_mb'));
    setBusy(true); setResult(null);
    try {
      const paths: Record<string, string> = {};
      for (const { role } of ROLES) {
        const f = fd.get(role) as File | null;
        if (!f || !f.size) throw new Error(`Select the ${role.replace('_', ' ')} file`);
        const path = `esp32-csi-node/${version}/${flash}MB/${role}.bin`;
        const { error } = await browserClient().storage.from('firmware').upload(path, f, { contentType: 'application/octet-stream', upsert: true });
        if (error) throw new Error(`${role}: ${error.message}`);
        paths[role] = path;
      }
      const r = await create({ version, flash_size_mb: flash, model_ids: fd.getAll('model_ids'), channel: fd.get('channel'), notes: fd.get('notes') || undefined, paths });
      setResult(r.ok ? { tone: r.warnings?.length ? 'warn' : 'ok', text: r.warnings?.join(' ') || 'Release verified and saved as draft. Publish it once tested on real hardware.' } : { tone: 'bad', text: r.error ?? 'Failed' });
      if (r.ok) e.currentTarget.reset();
    } catch (err) {
      setResult({ tone: 'bad', text: (err as Error).message });
    } finally {
      setBusy(false);
    }
  }
  return (
    <form onSubmit={onSubmit} className="space-y-3">
      {result && <Notice tone={result.tone}>{result.text}</Notice>}
      <div className="grid grid-cols-2 gap-3">
        <Field label="Version" hint="Must match the firmware's version.txt"><Input name="version" required placeholder="0.6.3" pattern="[0-9A-Za-z][0-9A-Za-z.+_\-]{0,63}" /></Field>
        <Field label="Flash size"><Select name="flash_size_mb" defaultValue="8"><option value="8">8 MB</option><option value="4">4 MB</option><option value="16">16 MB</option></Select></Field>
      </div>
      <Field label="Channel"><Select name="channel" defaultValue="stable"><option value="stable">Stable</option><option value="beta">Beta</option></Select></Field>
      <fieldset><legend className="mb-1 text-sm font-medium">Compatible models</legend>
        {models.map((m) => <Checkbox key={m.id} name="model_ids" value={m.id} label={m.name} defaultChecked={m.id === 'esp32s3-8mb'} />)}
      </fieldset>
      {ROLES.map(({ role, label }) => <Field key={role} label={label}><Input type="file" name={role} accept=".bin,application/octet-stream" required /></Field>)}
      <Field label="Release notes"><Textarea name="notes" /></Field>
      <div className="flex justify-end"><Button type="submit" disabled={busy}>{busy ? 'Uploading & verifying…' : 'Upload release'}</Button></div>
    </form>
  );
}
