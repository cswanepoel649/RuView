'use client';
import { useEffect, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { Button } from '../ui';

export function StepToggle({ done, onToggle, label = 'Mark step complete' }: { done: boolean; onToggle: (done: boolean) => Promise<void>; label?: string }) {
  const [pending, start] = useTransition();
  return (
    <Button variant={done ? 'secondary' : 'primary'} disabled={pending} onClick={() => start(() => onToggle(!done))}>
      {done ? 'Reopen step' : label}
    </Button>
  );
}

export function RoomVerify({ verified, onToggle }: { verified: boolean; onToggle: (v: boolean) => Promise<void> }) {
  const [pending, start] = useTransition();
  return (
    <Button variant={verified ? 'secondary' : 'primary'} className="py-1" disabled={pending} onClick={() => start(() => onToggle(!verified))}>
      {verified ? 'Verified ✓' : 'Mark verified'}
    </Button>
  );
}

/** Refreshes server data periodically while waiting for devices to come online. */
export function AutoRefresh({ seconds = 10 }: { seconds?: number }) {
  // A plain meta refresh would reset client components (e.g. an active flashing session), so use router.refresh.
  return <AutoRefreshInner seconds={seconds} />;
}
function AutoRefreshInner({ seconds }: { seconds: number }) {
  const router = useRouter();
  useEffect(() => {
    const t = setInterval(() => { if (document.visibilityState === 'visible') router.refresh(); }, seconds * 1000);
    return () => clearInterval(t);
  }, [router, seconds]);
  return null;
}
