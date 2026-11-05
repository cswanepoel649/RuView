#!/usr/bin/env node
/**
 * Generates platform/docker/.env with fresh secrets for the full stack.
 *
 *   node generate-env.mjs                       # localhost URLs
 *   node generate-env.mjs --host 192.168.1.50   # reachable from other devices on the LAN
 *   node generate-env.mjs --out ./.env --force  # overwrite an existing file
 *
 * Without Node:  docker run --rm -v "$PWD:/w" -w /w node:22-alpine node generate-env.mjs
 *
 * Key scheme matches supabase/docker/utils/generate-keys.sh: HS256 anon / service_role
 * JWTs (iss "supabase", 5-year expiry) signed with a random JWT_SECRET.
 */
import { createHmac, randomBytes } from 'node:crypto';
import { existsSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const args = process.argv.slice(2);
const opt = (name, def) => { const i = args.indexOf(name); return i >= 0 && args[i + 1] ? args[i + 1] : def; };
const host = opt('--host', 'localhost');
const out = opt('--out', join(dirname(fileURLToPath(import.meta.url)), '.env'));
if (!/^[A-Za-z0-9.-]+$/.test(host)) { console.error('invalid --host'); process.exit(1); }
if (existsSync(out) && !args.includes('--force')) {
  console.error(`${out} already exists — pass --force to overwrite (this rotates every secret and invalidates existing sessions/keys).`);
  process.exit(1);
}

const hex = (n) => randomBytes(n).toString('hex');
const b64 = (n) => randomBytes(n).toString('base64');
const b64url = (s) => Buffer.from(s).toString('base64url');
const jwtSecret = b64(30);
const iat = Math.floor(Date.now() / 1000);
const exp = iat + 5 * 365 * 24 * 3600;
const sign = (payload) => {
  const body = `${b64url('{"alg":"HS256","typ":"JWT"}')}.${b64url(JSON.stringify(payload))}`;
  return `${body}.${createHmac('sha256', jwtSecret).update(body).digest('base64url')}`;
};

const web = `http://${host}:3000`;
const api = `http://${host}:8000`;
const env = [
  ['# ---------------------------------------------------------------------------', null],
  ['# RuView Monitoring Platform — generated ' + new Date().toISOString(), null],
  ['# Keep this file private. Regenerating it rotates every secret.', null],
  ['# ---------------------------------------------------------------------------', null],
  ['', null],
  ['# ---- Platform (web app) ----', null],
  ['APP_URL', web],
  ['WEB_PORT', '3000'],
  ['DEVICE_SECRET_KEY', hex(32)],          // encrypts per-device OTA PSKs — back it up
  ['CRON_SECRET', hex(32)],
  ['RESEND_API_KEY', ''],                  // optional: alert emails via Resend
  ['EMAIL_FROM', ''],                      // e.g. RuView Monitoring <alerts@your-domain>
  ['MAIL_UI_PORT', '9000'],                // local mail catcher inbox (invites, password resets)
  ['', null],
  ['# ---- Test gateway (docker compose --profile gateway) ----', null],
  ['GATEWAY_ENROLLMENT_CODE', ''],         // paste the code generated in the console, then start the profile
  ['GATEWAY_HW_ID', `docker-gw-${hex(8)}`],
  ['SENSING_IMAGE', 'ruvnet/wifi-densepose:latest'],
  ['', null],
  ['# ---- Supabase secrets ----', null],
  ['POSTGRES_PASSWORD', hex(24)],
  ['JWT_SECRET', jwtSecret],
  ['ANON_KEY', sign({ role: 'anon', iss: 'supabase', iat, exp })],
  ['SERVICE_ROLE_KEY', sign({ role: 'service_role', iss: 'supabase', iat, exp })],
  ['SUPABASE_PUBLISHABLE_KEY', ''],
  ['SUPABASE_SECRET_KEY', ''],
  ['JWT_KEYS', ''],
  ['JWT_JWKS', ''],
  ['ANON_KEY_ASYMMETRIC', ''],
  ['SERVICE_ROLE_KEY_ASYMMETRIC', ''],
  ['DASHBOARD_USERNAME', 'supabase'],
  ['DASHBOARD_PASSWORD', hex(16)],         // Studio login at SUPABASE_PUBLIC_URL
  ['SECRET_KEY_BASE', b64(48)],
  ['REALTIME_DB_ENC_KEY', hex(8)],
  ['VAULT_ENC_KEY', hex(16)],
  ['PG_META_CRYPTO_KEY', b64(24)],
  ['LOGFLARE_PUBLIC_ACCESS_TOKEN', b64(24)],
  ['LOGFLARE_PRIVATE_ACCESS_TOKEN', b64(24)],
  ['S3_PROTOCOL_ACCESS_KEY_ID', hex(16)],
  ['S3_PROTOCOL_ACCESS_KEY_SECRET', hex(32)],
  ['MINIO_ROOT_USER', 'supa-storage'],
  ['MINIO_ROOT_PASSWORD', hex(16)],
  ['', null],
  ['# ---- Supabase URLs & database ----', null],
  ['SUPABASE_PUBLIC_URL', api],
  ['API_EXTERNAL_URL', `${api}/auth/v1`],
  ['SITE_URL', web],
  ['ADDITIONAL_REDIRECT_URLS', `${web}/auth/confirm,${web}/auth/callback,${web}/update-password`],
  ['POSTGRES_HOST', 'db'],
  ['POSTGRES_DB', 'postgres'],
  ['POSTGRES_PORT', '5432'],
  ['POOLER_PROXY_PORT_TRANSACTION', '6543'],
  ['POOLER_DEFAULT_POOL_SIZE', '20'],
  ['POOLER_MAX_CLIENT_CONN', '100'],
  ['POOLER_TENANT_ID', `ruview-${hex(4)}`],
  ['POOLER_DB_POOL_SIZE', '5'],
  ['API_GW_HTTP_PORT', '8000'],
  ['KONG_HTTP_PORT', '8000'],
  ['KONG_HTTPS_PORT', '8443'],
  ['', null],
  ['# ---- Auth (invite-only) ----', null],
  ['JWT_EXPIRY', '3600'],
  ['DISABLE_SIGNUP', 'true'],
  ['ENABLE_EMAIL_SIGNUP', 'true'],         // email/password login stays on; public sign-up is off
  ['ENABLE_EMAIL_AUTOCONFIRM', 'false'],
  ['ENABLE_ANONYMOUS_USERS', 'false'],
  ['ENABLE_PHONE_SIGNUP', 'false'],
  ['ENABLE_PHONE_AUTOCONFIRM', 'false'],
  ['MAILER_URLPATHS_CONFIRMATION', '"/auth/v1/verify"'],
  ['MAILER_URLPATHS_INVITE', '"/auth/v1/verify"'],
  ['MAILER_URLPATHS_RECOVERY', '"/auth/v1/verify"'],
  ['MAILER_URLPATHS_EMAIL_CHANGE', '"/auth/v1/verify"'],
  ['SMTP_ADMIN_EMAIL', 'noreply@ruview.local'],
  ['SMTP_HOST', 'supabase-mail'],          // local mail catcher; set a real SMTP server for production
  ['SMTP_PORT', '2500'],
  ['SMTP_USER', ''],                     // empty: the local catcher needs no auth (GoTrue refuses auth over plain SMTP)
  ['SMTP_PASS', ''],
  ['SMTP_SENDER_NAME', '"RuView Monitoring"'],
  ['', null],
  ['# ---- Supabase services (defaults from supabase/docker/.env.example) ----', null],
  ['STUDIO_DEFAULT_ORGANIZATION', '"RuView"'],
  ['STUDIO_DEFAULT_PROJECT', '"RuView Monitoring"'],
  ['OPENAI_API_KEY', ''],
  ['PGRST_DB_SCHEMAS', 'public,graphql_public'],
  ['PGRST_DB_MAX_ROWS', '1000'],
  ['PGRST_DB_EXTRA_SEARCH_PATH', 'public'],
  ['GLOBAL_S3_BUCKET', 'stub'],
  ['REGION', 'stub'],
  ['STORAGE_TENANT_ID', 'stub'],
  ['IMGPROXY_AUTO_WEBP', 'true'],
  ['FUNCTIONS_VERIFY_JWT', 'false'],
  ['FUNCTIONS_MEMORY_LIMIT', '1g'],
  ['DOCKER_SOCKET_LOCATION', '/var/run/docker.sock'],
  ['GOOGLE_PROJECT_ID', 'GOOGLE_PROJECT_ID'],
  ['GOOGLE_PROJECT_NUMBER', 'GOOGLE_PROJECT_NUMBER'],
  ['PROXY_DOMAIN', 'your-domain.example.com'],
  ['CERTBOT_EMAIL', 'admin@example.com'],
];

const text = env.map(([k, v]) => (v === null ? k : `${k}=${v}`)).join('\n') + '\n';
writeFileSync(out, text, { mode: 0o600 });
console.log(`Wrote ${out}`);
console.log(`  Web app:          ${web}`);
console.log(`  Supabase Studio:  ${api}   (user: supabase, password: DASHBOARD_PASSWORD in the file)`);
