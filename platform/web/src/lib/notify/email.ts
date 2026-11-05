import 'server-only';
import { serverEnv } from '../env';

export interface EmailMessage { to: string; subject: string; text: string; html: string }
export type SendResult = { ok: true; id?: string } | { ok: false; error: string; permanent: boolean };

/** Resend HTTP API. Returns {permanent:true} when email is not configured. */
export async function sendEmail(m: EmailMessage): Promise<SendResult> {
  const env = serverEnv();
  if (!env.RESEND_API_KEY || !env.EMAIL_FROM) return { ok: false, error: 'email provider not configured (RESEND_API_KEY / EMAIL_FROM)', permanent: true };
  try {
    const res = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: { authorization: `Bearer ${env.RESEND_API_KEY}`, 'content-type': 'application/json' },
      body: JSON.stringify({ from: env.EMAIL_FROM, to: [m.to], subject: m.subject, text: m.text, html: m.html }),
      signal: AbortSignal.timeout(10_000),
    });
    if (res.ok) return { ok: true, id: ((await res.json()) as { id?: string }).id };
    const permanent = res.status >= 400 && res.status < 500 && res.status !== 429;
    return { ok: false, error: `resend HTTP ${res.status}: ${(await res.text()).slice(0, 200)}`, permanent };
  } catch (e) {
    return { ok: false, error: (e as Error).message, permanent: false };
  }
}

const esc = (s: string) => s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);

export function renderAlertEmail(n: { title: string; body: string | null; severity: string; link: string | null }, appUrl: string): Omit<EmailMessage, 'to'> {
  const url = n.link ? `${appUrl}${n.link}` : appUrl;
  const color = n.severity === 'critical' ? '#dc2626' : n.severity === 'warning' ? '#b45309' : '#0f766e';
  const prefix = n.severity === 'critical' ? '[ALERT] ' : n.severity === 'warning' ? '[Warning] ' : '';
  return {
    subject: `${prefix}${n.title}`.slice(0, 180),
    text: `${n.title}\n\n${n.body ?? ''}\n\nOpen: ${url}\n\nYou receive this because of your alert settings in RuView Monitoring.`,
    html: `<div style="font-family:system-ui,-apple-system,Segoe UI,sans-serif;max-width:560px;margin:auto;padding:24px">
<div style="border-left:4px solid ${color};padding:4px 16px"><h2 style="margin:0 0 8px;font-size:18px">${esc(n.title)}</h2>
<p style="margin:0;color:#334155">${esc(n.body ?? '')}</p></div>
<p style="margin:24px 0"><a href="${esc(url)}" style="background:#0f766e;color:#fff;padding:10px 16px;border-radius:8px;text-decoration:none">Open in RuView Monitoring</a></p>
<p style="color:#64748b;font-size:12px">You receive this because of your alert settings. Manage notifications in Settings.</p></div>`,
  };
}
