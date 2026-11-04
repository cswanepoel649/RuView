import Link from 'next/link';

export default function NotFound() {
  return (
    <main className="flex min-h-[60dvh] flex-col items-center justify-center gap-2 px-4 text-center">
      <p className="text-sm font-medium text-muted">404</p>
      <h1 className="text-2xl font-semibold">Not found</h1>
      <p className="max-w-sm text-sm text-muted">This page does not exist, or you do not have access to it.</p>
      <Link href="/" className="mt-3 text-sm text-brand hover:underline">Go to your dashboard</Link>
    </main>
  );
}
