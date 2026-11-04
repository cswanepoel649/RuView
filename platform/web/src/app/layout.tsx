import type { Metadata, Viewport } from 'next';
import './globals.css';

export const metadata: Metadata = {
  title: { default: 'RuView Monitoring', template: '%s · RuView Monitoring' },
  description: 'Camera-free home security and monitoring powered by WiFi sensing.',
  robots: { index: false, follow: false },
};
export const viewport: Viewport = { themeColor: [{ media: '(prefers-color-scheme: dark)', color: '#0a0f1a' }, { color: '#f5f7fa' }] };

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body className="min-h-dvh">{children}</body>
    </html>
  );
}
