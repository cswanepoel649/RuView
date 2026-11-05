#!/usr/bin/env node
// Creates (or promotes) a platform administrator. Runs inside the web container:
//   docker compose exec web node /app/docker/create-admin.mjs you@example.com 'YourPassw0rd!'
const [email, password] = process.argv.slice(2);
const url = (process.env.SUPABASE_INTERNAL_URL || process.env.NEXT_PUBLIC_SUPABASE_URL || '').replace(/\/+$/, '');
const key = process.env.SUPABASE_SECRET_KEY;
if (!email || !/^[^@\s]+@[^@\s]+$/.test(email)) { console.error('usage: create-admin.mjs <email> [password]'); process.exit(2); }
if (password && !(password.length >= 12 && /[a-z]/.test(password) && /[A-Z]/.test(password) && /\d/.test(password))) {
  console.error('password needs 12+ characters with upper- and lower-case letters and a digit'); process.exit(2);
}
if (!url || !key) { console.error('SUPABASE_INTERNAL_URL / SUPABASE_SECRET_KEY not set (run inside the web container)'); process.exit(2); }
const h = { apikey: key, authorization: `Bearer ${key}`, 'content-type': 'application/json' };
const lower = email.toLowerCase();

const created = await fetch(`${url}/auth/v1/admin/users`, {
  method: 'POST', headers: h,
  body: JSON.stringify(password ? { email: lower, password, email_confirm: true } : { email: lower, email_confirm: true }),
});
if (created.ok) console.log(`created user ${lower}`);
else if (created.status === 422) console.log(`user ${lower} already exists — promoting`);
else { console.error(`could not create user: HTTP ${created.status} ${await created.text()}`); process.exit(1); }

const res = await fetch(`${url}/rest/v1/profiles?email=eq.${encodeURIComponent(lower)}`, {
  method: 'PATCH', headers: { ...h, prefer: 'return=representation' }, body: JSON.stringify({ platform_role: 'platform_admin' }),
});
const rows = res.ok ? await res.json() : [];
if (!res.ok || !rows.length) { console.error(`could not set platform_admin: HTTP ${res.status}`); process.exit(1); }
console.log(`${lower} is now a platform administrator.${password ? '' : ' No password set — use "Forgot password?" on the sign-in page.'}`);
