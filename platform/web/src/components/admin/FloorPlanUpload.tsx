'use client';
import { useState } from 'react';
import { browserClient } from '@/lib/supabase/browser';

/** Uploads a floor-plan image straight to Storage (staff-only policy), then records it. */
export function FloorPlanUpload({ clientId, propertyId, floorId, onSaved }: { clientId: string; propertyId: string; floorId: string; onSaved: (path: string, w: number, h: number) => Promise<{ ok: boolean; error?: string }> }) {
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  async function onFile(f: File) {
    if (!/^image\/(png|jpeg|webp|svg\+xml)$/.test(f.type)) return setMsg('Use PNG, JPEG, WebP or SVG.');
    if (f.size > 10 * 1024 * 1024) return setMsg('Maximum file size is 10 MB.');
    setBusy(true); setMsg(null);
    try {
      const dims = await new Promise<{ w: number; h: number }>((res, rej) => {
        const img = new Image();
        img.onload = () => res({ w: img.naturalWidth || 1000, h: img.naturalHeight || 620 });
        img.onerror = () => rej(new Error('Could not read image'));
        img.src = URL.createObjectURL(f);
      });
      const ext = f.type === 'image/svg+xml' ? 'svg' : f.type.split('/')[1];
      const path = `${clientId}/${propertyId}/${floorId}-${Date.now()}.${ext}`;
      const { error } = await browserClient().storage.from('floor-plans').upload(path, f, { contentType: f.type, upsert: false });
      if (error) throw error;
      const r = await onSaved(path, dims.w, dims.h);
      setMsg(r.ok ? 'Floor plan saved.' : r.error ?? 'Save failed');
    } catch (e) {
      setMsg((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <div className="flex flex-wrap items-center gap-2">
      <label className="inline-flex">
        <input type="file" accept="image/png,image/jpeg,image/webp,image/svg+xml" className="sr-only" disabled={busy} onChange={(e) => e.target.files?.[0] && onFile(e.target.files[0])} />
        <span className="cursor-pointer rounded-lg border border-border px-3 py-1.5 text-sm hover:bg-surface-2">{busy ? 'Uploading…' : 'Upload floor plan'}</span>
      </label>
      {msg && <span className="text-xs text-muted">{msg}</span>}
    </div>
  );
}

