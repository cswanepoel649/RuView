'use client';
/**
 * Occupancy charts. Every chart here is single-series magnitude data, so it uses
 * one sequential hue (the occupancy token) — no categorical palette, no legend.
 * Each chart has a hover tooltip and an accessible table view.
 */
import { useState } from 'react';
import { Bar, BarChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';

export interface SeriesPoint { t: string; label: string; value: number | null; detail?: string }

function TableView({ rows, valueLabel }: { rows: { label: string; value: string }[]; valueLabel: string }) {
  return (
    <details className="mt-2 text-xs">
      <summary className="cursor-pointer text-muted">Show as table</summary>
      <div className="mt-2 max-h-56 overflow-auto">
        <table className="w-full text-left"><thead><tr><th className="py-1 font-medium text-muted">Time</th><th className="py-1 font-medium text-muted">{valueLabel}</th></tr></thead>
          <tbody>{rows.map((r) => <tr key={r.label} className="border-t border-border"><td className="py-1">{r.label}</td><td className="py-1 tabular">{r.value}</td></tr>)}</tbody></table>
      </div>
    </details>
  );
}

/** Occupancy % per time bucket (bars; gaps = no data, never zero). */
export function OccupancyBars({ data, height = 180, valueLabel = 'Occupied' }: { data: SeriesPoint[]; height?: number; valueLabel?: string }) {
  const hasData = data.some((d) => d.value != null);
  return (
    <div>
      {!hasData ? <p className="py-10 text-center text-sm text-muted">No sensor data for this period.</p> : (
        <div style={{ height }} role="img" aria-label={`${valueLabel} by time`}>
          <ResponsiveContainer width="100%" height="100%">
            <BarChart data={data} margin={{ top: 8, right: 4, bottom: 0, left: -18 }} barCategoryGap={2}>
              <CartesianGrid vertical={false} stroke="var(--border)" strokeDasharray="0" />
              <XAxis dataKey="label" tickLine={false} axisLine={false} interval="preserveStartEnd" minTickGap={28} tick={{ fontSize: 11, fill: 'var(--muted)' }} />
              <YAxis domain={[0, 100]} ticks={[0, 50, 100]} tickFormatter={(v) => `${v}%`} tickLine={false} axisLine={false} tick={{ fontSize: 11, fill: 'var(--muted)' }} />
              <Tooltip cursor={{ fill: 'var(--surface-2)' }} content={({ active, payload }) => {
                const p = active && payload?.[0]?.payload as SeriesPoint | undefined;
                if (!p) return null;
                return (
                  <div className="rounded-lg border border-border bg-surface px-3 py-2 text-xs shadow-lg">
                    <p className="font-medium">{p.detail ?? p.label}</p>
                    <p className="text-muted">{p.value == null ? 'No data' : `${valueLabel}: ${Math.round(p.value)}%`}</p>
                  </div>
                );
              }} />
              <Bar dataKey="value" fill="var(--occupied)" radius={[4, 4, 0, 0]} maxBarSize={18} isAnimationActive={false} />
            </BarChart>
          </ResponsiveContainer>
        </div>
      )}
      <TableView valueLabel={`${valueLabel} %`} rows={data.map((d) => ({ label: d.detail ?? d.label, value: d.value == null ? 'no data' : `${Math.round(d.value)}%` }))} />
    </div>
  );
}

/** Day × hour heatmap of occupancy (sequential: transparent → occupied hue). */
export function ActivityHeatmap({ cells, days }: { cells: { day: number; hour: number; value: number | null }[]; days: string[] }) {
  const [hover, setHover] = useState<{ day: number; hour: number; value: number | null } | null>(null);
  const get = (d: number, h: number) => cells.find((c) => c.day === d && c.hour === h)?.value ?? null;
  return (
    <div>
      <div className="overflow-x-auto">
        <div className="min-w-[560px]">
          <div className="grid grid-cols-[44px_repeat(24,minmax(0,1fr))] gap-[2px]" onMouseLeave={() => setHover(null)}>
            <span />
            {Array.from({ length: 24 }, (_, h) => <span key={h} className="text-center text-[10px] text-muted">{h % 3 === 0 ? String(h).padStart(2, '0') : ''}</span>)}
            {days.map((dname, d) => (
              <div key={dname} className="contents">
                <span className="pr-1 text-right text-[11px] leading-5 text-muted">{dname}</span>
                {Array.from({ length: 24 }, (_, h) => {
                  const v = get(d, h);
                  return (
                    <button key={h} type="button" aria-label={`${dname} ${h}:00 — ${v == null ? 'no data' : `${Math.round(v)}% occupied`}`}
                      onMouseEnter={() => setHover({ day: d, hour: h, value: v })} onFocus={() => setHover({ day: d, hour: h, value: v })}
                      className="h-5 rounded-[3px] outline-offset-1 hover:outline hover:outline-2 hover:outline-[var(--fg)]"
                      style={{ background: v == null ? 'var(--surface-2)' : `color-mix(in srgb, var(--occupied) ${Math.max(8, Math.round(v))}%, var(--surface))` }} />
                  );
                })}
              </div>
            ))}
          </div>
        </div>
      </div>
      <div className="mt-2 flex flex-wrap items-center justify-between gap-2 text-xs text-muted">
        <span aria-live="polite">{hover ? `${days[hover.day]} ${String(hover.hour).padStart(2, '0')}:00 — ${hover.value == null ? 'no data' : `${Math.round(hover.value)}% occupied on average`}` : 'Hover a cell for details'}</span>
        <span className="flex items-center gap-1">0%<span className="h-2 w-24 rounded" style={{ background: 'linear-gradient(90deg, color-mix(in srgb, var(--occupied) 8%, var(--surface)), var(--occupied))' }} />100% · grey = no data</span>
      </div>
      <TableView valueLabel="Avg occupied %" rows={cells.filter((c) => c.value != null).map((c) => ({ label: `${days[c.day]} ${String(c.hour).padStart(2, '0')}:00`, value: `${Math.round(c.value!)}%` }))} />
    </div>
  );
}

/** Horizontal bars: share of time each room was occupied (direct-labeled, one hue). */
export function RoomShareBars({ rows }: { rows: { name: string; value: number | null; href?: string }[] }) {
  const max = 100;
  return (
    <ul className="space-y-2.5">
      {rows.map((r) => (
        <li key={r.name} className="grid grid-cols-[120px_1fr_48px] items-center gap-3 text-sm" title={r.value == null ? `${r.name}: no data` : `${r.name}: ${r.value.toFixed(1)}% of the time`}>
          <span className="truncate">{r.href ? <a href={r.href} className="hover:underline">{r.name}</a> : r.name}</span>
          <span className="h-2.5 rounded-full bg-surface-2"><span className="block h-full rounded-full bg-occupied" style={{ width: `${r.value == null ? 0 : Math.max(1, (r.value / max) * 100)}%` }} /></span>
          <span className="text-right text-xs text-muted tabular">{r.value == null ? '—' : `${Math.round(r.value)}%`}</span>
        </li>
      ))}
    </ul>
  );
}
