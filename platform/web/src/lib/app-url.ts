import 'server-only';
import { serverEnv } from './env';

/**
 * Absolute URL on the public origin. Route handlers must not derive redirects from
 * `req.url`: behind Docker or a reverse proxy it reflects the bind address
 * (e.g. http://0.0.0.0:3000), which sends browsers to the wrong origin and drops
 * the session cookie.
 */
export function appUrl(path: string): URL {
  return new URL(path, serverEnv().APP_URL);
}
