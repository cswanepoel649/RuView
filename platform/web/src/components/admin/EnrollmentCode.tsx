'use client';
import { useState, useTransition } from 'react';
import { Copy, KeyRound } from 'lucide-react';
import { Button } from '../ui';

export function EnrollmentCode({ gatewayId, appUrl, create }: { gatewayId: string; appUrl: string; create: (id: string) => Promise<{ ok: boolean; code?: string; expiresAt?: string; error?: string }> }) {
  const [res, setRes] = useState<{ code?: string; expiresAt?: string; error?: string } | null>(null);
  const [pending, start] = useTransition();
  const cmd = res?.code ? `curl -fsSL ${appUrl}/install/gateway.sh | sudo RUVIEW_CLOUD_URL=${appUrl} RUVIEW_ENROLLMENT_CODE=${res.code} bash` : '';
  return (
    <div className="space-y-3">
      <Button variant="secondary" disabled={pending} onClick={() => start(async () => setRes(await create(gatewayId)))}>
        <KeyRound className="h-4 w-4" />{pending ? 'Generating…' : res?.code ? 'Generate a new code' : 'Generate enrollment code'}
      </Button>
      {res?.error && <p className="text-sm text-bad">{res.error}</p>}
      {res?.code && (
        <div className="rounded-lg border border-border bg-surface-2 p-4">
          <p className="text-xs text-muted">One-time code · expires {new Date(res.expiresAt!).toLocaleString()} · shown only once</p>
          <p className="mt-1 font-mono text-2xl font-semibold tracking-widest">{res.code}</p>
          <p className="mt-3 text-xs font-medium text-muted">Run on the gateway (Raspberry Pi / Linux, with internet access):</p>
          <div className="mt-1 flex items-start gap-2">
            <code className="block flex-1 overflow-x-auto whitespace-pre rounded bg-nav p-3 font-mono text-xs text-nav-fg">{cmd}</code>
            <button className="rounded p-2 hover:bg-surface" aria-label="Copy command" onClick={() => navigator.clipboard.writeText(cmd)}><Copy className="h-4 w-4" /></button>
          </div>
        </div>
      )}
    </div>
  );
}
