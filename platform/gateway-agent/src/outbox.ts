/**
 * Durable, bounded queue for history buckets and edge events so data survives
 * internet outages and agent restarts. Stored as JSON in the state directory
 * (atomic write via rename). Oldest entries are dropped beyond the cap.
 */
import { mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import type { EdgeEvent, MinuteBucket } from '@ruview/shared/protocol';
import { errMsg, log } from './log';

interface OutboxFile {
  v: 1;
  minutes: MinuteBucket[];
  events: EdgeEvent[];
}

export class Outbox {
  minutes: MinuteBucket[] = [];
  events: EdgeEvent[] = [];
  dropped = 0;
  private dirty = false;
  private readonly path: string;

  constructor(dir: string, private readonly maxMinutes: number, private readonly maxEvents = 2000) {
    mkdirSync(dir, { recursive: true, mode: 0o700 });
    this.path = join(dir, 'outbox.json');
    try {
      const f = JSON.parse(readFileSync(this.path, 'utf8')) as OutboxFile;
      if (f.v === 1) {
        this.minutes = f.minutes ?? [];
        this.events = f.events ?? [];
        if (this.minutes.length || this.events.length) {
          log.info('restored outbox', { minutes: this.minutes.length, events: this.events.length });
        }
      }
    } catch {
      /* first run or unreadable: start empty */
    }
  }

  pushMinutes(b: MinuteBucket[]) {
    if (!b.length) return;
    this.minutes.push(...b);
    const over = this.minutes.length - this.maxMinutes;
    if (over > 0) {
      this.minutes.splice(0, over);
      this.dropped += over;
    }
    this.dirty = true;
  }

  pushEvent(e: EdgeEvent) {
    this.events.push(e);
    if (this.events.length > this.maxEvents) this.events.shift();
    this.dirty = true;
  }

  takeMinutes(n: number) {
    return this.minutes.slice(0, n);
  }
  ackMinutes(n: number) {
    this.minutes.splice(0, n);
    this.dirty = true;
  }
  takeEvents(n: number) {
    return this.events.slice(0, n);
  }
  ackEvents(n: number) {
    this.events.splice(0, n);
    this.dirty = true;
  }

  persist() {
    if (!this.dirty) return;
    try {
      const tmp = this.path + '.tmp';
      writeFileSync(tmp, JSON.stringify({ v: 1, minutes: this.minutes, events: this.events } satisfies OutboxFile), { mode: 0o600 });
      renameSync(tmp, this.path);
      this.dirty = false;
    } catch (e) {
      log.warn('outbox persist failed', { error: errMsg(e) });
    }
  }
}
