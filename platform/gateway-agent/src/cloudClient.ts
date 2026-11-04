import { readFileSync, writeFileSync, mkdirSync, renameSync } from 'node:fs';
import { join } from 'node:path';
import {
  GATEWAY_API_PREFIX, EnrollResponse, HeartbeatResponse, TelemetryResponse, normaliseEnrollmentCode,
  type EnrollRequest, type EventsRequest, type HeartbeatRequest, type TelemetryRequest, type CommandResult,
} from '@ruview/shared/protocol';
import type { z } from 'zod';

export class CloudError extends Error {
  constructor(message: string, readonly status: number | null, readonly retryable: boolean) {
    super(message);
  }
}

export interface Credentials {
  gatewayId: string;
  token: string;
  propertyId: string | null;
  enrolledAt: string;
}

export function loadCredentials(stateDir: string): Credentials | null {
  try {
    const c = JSON.parse(readFileSync(join(stateDir, 'credentials.json'), 'utf8')) as Credentials;
    return c.token?.startsWith('gw_') ? c : null;
  } catch {
    return null;
  }
}

export function saveCredentials(stateDir: string, c: Credentials) {
  mkdirSync(stateDir, { recursive: true, mode: 0o700 });
  const p = join(stateDir, 'credentials.json');
  writeFileSync(p + '.tmp', JSON.stringify(c, null, 2), { mode: 0o600 });
  renameSync(p + '.tmp', p);
}

export class CloudClient {
  token: string | null = null;
  constructor(private readonly baseUrl: string, private readonly userAgent: string) {}

  private async request<S extends z.ZodType>(path: string, body: unknown, schema: S | null, auth = true): Promise<z.infer<S>> {
    const headers: Record<string, string> = { 'content-type': 'application/json', 'user-agent': this.userAgent };
    if (auth) {
      if (!this.token) throw new CloudError('not enrolled', null, false);
      headers.authorization = `Bearer ${this.token}`;
    }
    let res: Response;
    try {
      res = await fetch(`${this.baseUrl}${GATEWAY_API_PREFIX}${path}`, {
        method: 'POST', headers, body: JSON.stringify(body), signal: AbortSignal.timeout(15_000),
      });
    } catch (e) {
      throw new CloudError(`network error: ${e instanceof Error ? e.message : String(e)}`, null, true);
    }
    const text = await res.text();
    if (!res.ok) {
      let msg = text.slice(0, 300);
      try { msg = (JSON.parse(text) as { error?: string }).error ?? msg; } catch { /* keep text */ }
      throw new CloudError(`HTTP ${res.status}: ${msg}`, res.status, res.status >= 500 || res.status === 429);
    }
    if (!schema) return undefined as z.infer<S>;
    const parsed = schema.safeParse(JSON.parse(text));
    if (!parsed.success) throw new CloudError(`invalid response for ${path}: ${parsed.error.message.slice(0, 300)}`, res.status, false);
    return parsed.data;
  }

  enroll(req: EnrollRequest) {
    return this.request('/enroll', { ...req, enrollment_code: normaliseEnrollmentCode(req.enrollment_code) }, EnrollResponse, false);
  }
  heartbeat(req: HeartbeatRequest) {
    return this.request('/heartbeat', req, HeartbeatResponse);
  }
  telemetry(req: TelemetryRequest) {
    return this.request('/telemetry', req, TelemetryResponse);
  }
  events(req: EventsRequest) {
    return this.request('/events', req, null);
  }
  commandResult(id: string, r: CommandResult) {
    return this.request(`/commands/${encodeURIComponent(id)}/result`, r, null);
  }
}
