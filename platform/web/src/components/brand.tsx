export function BrandMark({ className = 'h-8 w-8' }: { className?: string }) {
  return (
    <svg viewBox="0 0 32 32" className={className} aria-hidden>
      <rect width="32" height="32" rx="8" fill="var(--brand)" />
      <path d="M16 6l8 3v6c0 5-3.4 9.3-8 11-4.6-1.7-8-6-8-11V9z" fill="none" stroke="var(--brand-fg)" strokeWidth="2.2" strokeLinejoin="round" />
      <path d="M11.5 16a6.4 6.4 0 019 0M13.5 18.2a3.4 3.4 0 015 0" stroke="var(--brand-fg)" strokeWidth="2" strokeLinecap="round" fill="none" />
    </svg>
  );
}
