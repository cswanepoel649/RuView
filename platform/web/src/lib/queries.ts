import 'server-only';
import type { EventRow } from './types';

/** Flattens PostgREST embeds used across event lists. */
export type EventWithNames = EventRow & { property_name?: string; client_name?: string; room_name?: string };
export const EVENT_SELECT = '*, properties(name), clients(display_name), rooms(name)';
export function flattenEvents(rows: unknown[] | null): EventWithNames[] {
  return ((rows ?? []) as (EventRow & { properties?: { name: string } | null; clients?: { display_name: string } | null; rooms?: { name: string } | null })[])
    .map(({ properties, clients, rooms, ...e }) => ({ ...e, property_name: properties?.name, client_name: clients?.display_name, room_name: rooms?.name }));
}

/** Escape user input for PostgREST ilike filters. */
export const likeEscape = (s: string) => s.replace(/[%_\\,()]/g, (c) => `\\${c}`).slice(0, 100);
