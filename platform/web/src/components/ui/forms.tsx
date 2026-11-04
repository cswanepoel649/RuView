'use client';
import { useActionState, type ReactNode } from 'react';
import { useFormStatus } from 'react-dom';
import { Button, Notice } from './index';

export interface ActionResult { ok?: boolean; error?: string; message?: string; fieldErrors?: Record<string, string>; nonce?: number }
export type FormAction = (prev: ActionResult, data: FormData) => Promise<ActionResult>;

export function SubmitButton({ children, variant = 'primary', pendingLabel }: { children: ReactNode; variant?: 'primary' | 'secondary' | 'danger' | 'ghost'; pendingLabel?: string }) {
  const { pending } = useFormStatus();
  return <Button type="submit" variant={variant} disabled={pending}>{pending ? (pendingLabel ?? 'Saving…') : children}</Button>;
}

/** Form bound to a server action with inline success/error feedback. */
export function ActionForm({ action, children, className, resetOnSuccess = false }: { action: FormAction; children: ReactNode; className?: string; resetOnSuccess?: boolean }) {
  const [state, formAction] = useActionState(action, {});
  return (
    <form action={formAction} className={className} key={resetOnSuccess && state.ok ? state.nonce : undefined}>
      {state.error && <div className="mb-4"><Notice tone="bad">{state.error}</Notice></div>}
      {state.ok && state.message && <div className="mb-4"><Notice tone="ok">{state.message}</Notice></div>}
      {children}
    </form>
  );
}

export function ConfirmSubmit({ children, message, variant = 'danger' }: { children: ReactNode; message: string; variant?: 'danger' | 'secondary' | 'primary' | 'ghost' }) {
  const { pending } = useFormStatus();
  return (
    <Button type="submit" variant={variant} disabled={pending}
      onClick={(e) => { if (!confirm(message)) e.preventDefault(); }}>
      {pending ? 'Working…' : children}
    </Button>
  );
}
