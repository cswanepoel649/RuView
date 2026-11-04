'use client';
import { useState, useTransition } from 'react';
import { Lock, Moon, Unlock } from 'lucide-react';
import { setSecurityMode } from '@/app/actions/security';
import type { SecurityMode } from '@/lib/types';
import { cn } from '../ui';

const MODES: { mode: SecurityMode; label: string; icon: typeof Lock; hint: string }[] = [
  { mode: 'disarmed', label: 'Disarmed', icon: Unlock, hint: 'No intrusion alarms' },
  { mode: 'armed_home', label: 'Home', icon: Moon, hint: 'Zones set for "home" are armed' },
  { mode: 'armed_away', label: 'Away', icon: Lock, hint: 'All away zones armed' },
];

export function SecurityModeControl({ propertyId, mode, changedAt, exitDelayS, canOperate }: { propertyId: string; mode: SecurityMode; changedAt: string; exitDelayS: number; canOperate: boolean }) {
  const [current, setCurrent] = useState(mode);
  const [since, setSince] = useState(changedAt);
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const [now] = useState(() => Date.now());
  const exitRemaining = current !== 'disarmed' ? Math.max(0, Math.round((Date.parse(since) + exitDelayS * 1000 - now) / 1000)) : 0;

  const choose = (m: SecurityMode) => {
    if (m === current || !canOperate) return;
    if (m === 'disarmed' || confirm(`Arm the property in "${MODES.find((x) => x.mode === m)!.label}" mode?${exitDelayS ? ` Alarms activate after ${exitDelayS} seconds.` : ''}`)) {
      start(async () => {
        setError(null);
        const r = await setSecurityMode(propertyId, m);
        if (r.ok && r.mode) { setCurrent(r.mode as SecurityMode); setSince(r.changedAt!); } else setError(r.error ?? 'Failed');
      });
    }
  };

  return (
    <div>
      <div role="radiogroup" aria-label="Security mode" className="grid grid-cols-3 gap-2">
        {MODES.map(({ mode: m, label, icon: Icon, hint }) => {
          const active = m === current;
          return (
            <button key={m} role="radio" aria-checked={active} disabled={pending || !canOperate} onClick={() => choose(m)} title={hint}
              className={cn('flex flex-col items-center gap-1 rounded-xl border px-3 py-3 text-sm font-medium transition disabled:cursor-not-allowed',
                active ? (m === 'disarmed' ? 'border-fg/30 bg-surface-2' : 'border-brand bg-brand text-brand-fg shadow') : 'border-border bg-surface hover:bg-surface-2',
                pending && 'opacity-60')}>
              <Icon className="h-5 w-5" aria-hidden />{label}
            </button>
          );
        })}
      </div>
      {exitRemaining > 0 && <p className="mt-2 text-xs text-warn">Exit delay: alarms activate in about {exitRemaining}s.</p>}
      {!canOperate && <p className="mt-2 text-xs text-muted">Viewer access — ask an account owner to change the security mode.</p>}
      {error && <p className="mt-2 text-xs text-bad" role="alert">{error}</p>}
    </div>
  );
}
