'use client';
export default function Error({ reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return (
    <main className="flex min-h-[60dvh] flex-col items-center justify-center gap-3 px-4 text-center">
      <h1 className="text-xl font-semibold">Something went wrong</h1>
      <p className="max-w-sm text-sm text-muted">The error has been logged. Try again, or contact support if it persists.</p>
      <button onClick={reset} className="rounded-lg border border-border px-3 py-1.5 text-sm hover:bg-surface-2">Try again</button>
    </main>
  );
}
