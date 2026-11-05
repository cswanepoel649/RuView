import 'server-only';
import { serverEnv } from './env';
import { safeEqual } from './crypto';

export function authorizeCron(req: Request): boolean {
  const h = req.headers.get('authorization') ?? '';
  return safeEqual(h, `Bearer ${serverEnv().CRON_SECRET}`);
}
