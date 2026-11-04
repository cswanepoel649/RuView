'use client';
import { useState, useTransition } from 'react';
import type { Room } from '@/lib/types';
import { Button, cn } from '../ui';

/**
 * Draw room outlines on the floor plan: pick a room, click to add corners,
 * "Save outline" stores normalised [0..1] coordinates on the room.
 */
export function RoomShapeEditor({ rooms, planUrl, aspect, onSave }: { rooms: Room[]; planUrl: string | null; aspect: number; onSave: (roomId: string, shape: [number, number][] | null) => Promise<{ ok: boolean; error?: string }> }) {
  const [shapes, setShapes] = useState<Record<string, [number, number][]>>(() => Object.fromEntries(rooms.filter((r) => r.shape).map((r) => [r.id, r.shape!])));
  const [active, setActive] = useState<string | null>(rooms[0]?.id ?? null);
  const [draft, setDraft] = useState<[number, number][]>([]);
  const [msg, setMsg] = useState<string | null>(null);
  const [pending, start] = useTransition();

  function click(e: React.MouseEvent<SVGSVGElement>) {
    if (!active) return;
    const r = e.currentTarget.getBoundingClientRect();
    const x = Math.min(1, Math.max(0, (e.clientX - r.left) / r.width));
    const y = Math.min(1, Math.max(0, (e.clientY - r.top) / r.height));
    setDraft((d) => [...d, [Math.round(x * 1000) / 1000, Math.round(y * 1000) / 1000]]);
  }
  function save(shape: [number, number][] | null) {
    if (!active) return;
    start(async () => {
      const res = await onSave(active, shape);
      if (res.ok) {
        setShapes((s) => { const n = { ...s }; if (shape) n[active] = shape; else delete n[active]; return n; });
        setDraft([]);
        setMsg('Saved.');
      } else setMsg(res.error ?? 'Failed');
    });
  }
  return (
    <div className="grid gap-4 lg:grid-cols-[220px_1fr]">
      <div className="space-y-1">
        {rooms.map((r) => (
          <button key={r.id} onClick={() => { setActive(r.id); setDraft([]); setMsg(null); }}
            className={cn('flex w-full items-center justify-between rounded-lg px-3 py-2 text-left text-sm', active === r.id ? 'bg-brand-soft text-brand' : 'hover:bg-surface-2')}>
            {r.name}<span className="text-xs text-muted">{shapes[r.id] ? 'mapped' : '—'}</span>
          </button>
        ))}
        {rooms.length === 0 && <p className="text-sm text-muted">Add rooms first.</p>}
      </div>
      <div>
        <div className="relative w-full overflow-hidden rounded-lg border border-border bg-surface-2" style={{ paddingTop: `${aspect * 100}%` }}>
          {/* eslint-disable-next-line @next/next/no-img-element -- signed Storage URL */}
          {planUrl && <img src={planUrl} alt="" className="absolute inset-0 h-full w-full object-contain" />}
          {!planUrl && <div className="absolute inset-0 bg-[linear-gradient(var(--border)_1px,transparent_1px),linear-gradient(90deg,var(--border)_1px,transparent_1px)] bg-[size:5%_8%]" />}
          <svg viewBox="0 0 1000 1000" preserveAspectRatio="none" className="absolute inset-0 h-full w-full cursor-crosshair" onClick={click}>
            {Object.entries(shapes).map(([id, s]) => (
              <polygon key={id} points={s.map(([x, y]) => `${x * 1000},${y * 1000}`).join(' ')} vectorEffect="non-scaling-stroke"
                fill={id === active ? 'color-mix(in srgb, var(--brand) 25%, transparent)' : 'color-mix(in srgb, var(--muted) 15%, transparent)'} stroke={id === active ? 'var(--brand)' : 'var(--muted)'} strokeWidth={2} />
            ))}
            {draft.length > 0 && <polyline points={draft.map(([x, y]) => `${x * 1000},${y * 1000}`).join(' ')} fill="none" stroke="var(--info)" strokeWidth={3} vectorEffect="non-scaling-stroke" />}
            {draft.map(([x, y], i) => <circle key={i} cx={x * 1000} cy={y * 1000} r={8} fill="var(--info)" />)}
          </svg>
        </div>
        <div className="mt-3 flex flex-wrap items-center gap-2">
          <Button variant="primary" disabled={pending || draft.length < 3} onClick={() => save(draft)}>Save outline ({draft.length} pts)</Button>
          <Button variant="secondary" disabled={!draft.length} onClick={() => setDraft((d) => d.slice(0, -1))}>Undo point</Button>
          <Button variant="ghost" disabled={pending || !active || !shapes[active]} onClick={() => save(null)}>Clear outline</Button>
          <span className="text-xs text-muted">{msg ?? 'Click on the plan to place the room’s corners (min. 3).'}</span>
        </div>
      </div>
    </div>
  );
}
