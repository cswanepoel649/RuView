import 'server-only';
import { createCipheriv, createDecipheriv, createHash, randomBytes, randomInt, timingSafeEqual } from 'node:crypto';
import { serverEnv } from './env';

export const sha256Hex = (s: string | Uint8Array) => createHash('sha256').update(s).digest('hex');

/** Opaque bearer token, e.g. gw_<43 chars base64url> (256 bits). Only its SHA-256 is stored. */
export function randomToken(prefix: string, bytes = 32) {
  return `${prefix}_${randomBytes(bytes).toString('base64url')}`;
}

// Unambiguous alphabet (no 0/O/1/I) — 32 symbols, 12 chars = 60 bits; single-use, 24 h, rate-limited.
const CODE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
export function enrollmentCode() {
  let s = '';
  for (let i = 0; i < 12; i++) s += CODE_ALPHABET[randomInt(CODE_ALPHABET.length)];
  return `${s.slice(0, 4)}-${s.slice(4, 8)}-${s.slice(8, 12)}`;
}

/** 256-bit OTA pre-shared key, lowercase hex (firmware compares the Bearer value verbatim). */
export const otaPsk = () => randomBytes(32).toString('hex');

function key() {
  return Buffer.from(serverEnv().DEVICE_SECRET_KEY, 'hex');
}

/** AES-256-GCM → "v1.<iv>.<tag>.<ciphertext>" (base64url parts). */
export function encryptSecret(plain: string): string {
  const iv = randomBytes(12);
  const c = createCipheriv('aes-256-gcm', key(), iv);
  const ct = Buffer.concat([c.update(plain, 'utf8'), c.final()]);
  return ['v1', iv.toString('base64url'), c.getAuthTag().toString('base64url'), ct.toString('base64url')].join('.');
}

export function decryptSecret(blob: string): string {
  const [v, iv, tag, ct] = blob.split('.');
  if (v !== 'v1' || !iv || !tag || !ct) throw new Error('unsupported secret format');
  const d = createDecipheriv('aes-256-gcm', key(), Buffer.from(iv, 'base64url'));
  d.setAuthTag(Buffer.from(tag, 'base64url'));
  return Buffer.concat([d.update(Buffer.from(ct, 'base64url')), d.final()]).toString('utf8');
}

export function safeEqual(a: string, b: string) {
  const x = Buffer.from(a), y = Buffer.from(b);
  return x.length === y.length && timingSafeEqual(x, y);
}
