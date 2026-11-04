'use client';
import { useEffect, useState } from 'react';
import { browserClient } from '@/lib/supabase/browser';
import type { RoomState } from '@/lib/types';

const STALE_AFTER_MS = 60_000;

/**
 * Live room states for one property via Supabase Realtime (postgres_changes,
 * RLS-enforced per subscriber), with a periodic refetch as a safety net and
 * client-side staleness so a silent gateway never looks like an empty home.
 */
export function useLiveRooms(propertyId: string, initial: RoomState[]) {
  const [rooms, setRooms] = useState<Record<string, RoomState>>(() => Object.fromEntries(initial.map((r) => [r.room_id, r])));
  const [connected, setConnected] = useState(false);
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    const sb = browserClient();
    const apply = (r: RoomState) => setRooms((prev) => ({ ...prev, [r.room_id]: r }));
    const channel = sb
      .channel(`rooms:${propertyId}`)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'room_state', filter: `property_id=eq.${propertyId}` },
        (p) => { if (p.new && 'room_id' in p.new) apply(p.new as RoomState); })
      .subscribe((status) => setConnected(status === 'SUBSCRIBED'));
    const refetch = async () => {
      const { data } = await sb.from('room_state').select('*').eq('property_id', propertyId);
      if (data) setRooms(Object.fromEntries((data as RoomState[]).map((r) => [r.room_id, r])));
    };
    const poll = setInterval(refetch, 30_000);
    const tick = setInterval(() => setNow(Date.now()), 5_000);
    return () => { clearInterval(poll); clearInterval(tick); void sb.removeChannel(channel); };
  }, [propertyId]);

  const isStale = (r?: RoomState) => !r || r.stale || !r.updated_at || now - Date.parse(r.updated_at) > STALE_AFTER_MS;
  return { rooms, connected, isStale, now };
}
