'use client';
/**
 * Guided provisioning of one ESP32-S3 board at a time:
 *   connect (Web Serial) → detect chip/MAC/flash → register + room + node id
 *   → build NVS in-browser (WiFi password never leaves the browser)
 *   → flash firmware + NVS (or NVS only) → reset → verify boot log → confirm.
 * Fallback for browsers without Web Serial: download the NVS image and run esptool.
 */
import { useRef, useState } from 'react';
import { CheckCircle2, CircleX, Download, Loader2, Usb } from 'lucide-react';
import { buildProvisioningNvs, NVS_PARTITION_OFFSET, type NodeProvisioningConfig } from '@ruview/shared/nvs';
import { FLASH_LAYOUT } from '@ruview/shared/catalog';
import { BoardSession, downloadBlob, webSerialSupported, type DetectedBoard, type FlashImage } from '@/lib/provisioning/webserial';
import { emptyBoot, LineBuffer, parseBootLine, type BootStatus } from '@/lib/provisioning/serialLog';
import type { PrepareResult } from '@/app/admin/installations/actions';
import { Badge, Button, Card, CardBody, CardHeader, Field, Input, Notice, Select, cn } from '../ui';

interface Release { id: string; version: string; flash_size_mb: number; model_ids: string[]; files: Record<string, { sha256: string; size: number }> }
interface Props {
  installationId: string;
  gateways: { id: string; name: string; lanIps: string[]; online: boolean }[];
  rooms: { id: string; name: string }[];
  releases: Release[];
  prepare: (i: { installationId: string; gatewayId: string; roomId: string; mac: string; chip: string; flashSize: string | null; name: string }) => Promise<PrepareResult>;
  complete: (i: { installationId: string; deviceId: string; otaPsk: string; releaseId: string | null; firmwareVersion: string | null; config: Record<string, unknown>; bootCheck?: Record<string, unknown> }) => Promise<{ ok: boolean; error?: string }>;
}
type Phase = 'idle' | 'connecting' | 'detected' | 'working' | 'monitor' | 'done' | 'error';

async function sha256(b: Uint8Array) {
  const d = await crypto.subtle.digest('SHA-256', b as BufferSource);
  return Array.from(new Uint8Array(d), (x) => x.toString(16).padStart(2, '0')).join('');
}

export function SensorProvisioner(props: Props) {
  const [phase, setPhase] = useState<Phase>('idle');
  const [board, setBoard] = useState<DetectedBoard | null>(null);
  const [log, setLog] = useState<string[]>([]);
  const [progress, setProgress] = useState<{ label: string; pct: number } | null>(null);
  const [boot, setBoot] = useState<BootStatus>(emptyBoot());
  const [error, setError] = useState<string | null>(null);
  const [wifi, setWifi] = useState({ ssid: '', password: '' });
  const [gatewayId, setGatewayId] = useState(props.gateways[0]?.id ?? '');
  const gw = props.gateways.find((g) => g.id === gatewayId);
  const [targetIp, setTargetIp] = useState(gw?.lanIps[0] ?? '');
  const [roomId, setRoomId] = useState(props.rooms[0]?.id ?? '');
  const [name, setName] = useState('');
  const [mode, setMode] = useState<'full' | 'nvs'>('full');
  const [releaseId, setReleaseId] = useState('');
  const [advanced, setAdvanced] = useState({ edgeTier: 2 as 0 | 1 | 2, channel: '' });
  const [manualMac, setManualMac] = useState('');
  const session = useRef<BoardSession | null>(null);
  const prepared = useRef<{ res: Extract<PrepareResult, { ok: true }>; cfg: NodeProvisioningConfig; release: Release | null } | null>(null);

  const addLog = (l: string) => setLog((x) => [...x.slice(-400), l]);
  const fail = (e: unknown) => { setError(e instanceof Error ? e.message : String(e)); setPhase('error'); };
  const flashMb = Number((board?.flashSize ?? '8MB').replace('MB', '')) || 8;
  const compatible = props.releases.filter((r) => r.flash_size_mb === (flashMb >= 8 ? 8 : 4));

  async function connect() {
    setError(null); setLog([]); setBoot(emptyBoot()); setPhase('connecting');
    try {
      await session.current?.close();
      session.current = new BoardSession(addLog);
      const b = await session.current.connect();
      setBoard(b);
      setName((n) => n || `Sensor ${b.mac.slice(-5).replace(':', '')}`);
      const rel = props.releases.filter((r) => r.flash_size_mb === ((Number((b.flashSize ?? '8MB').replace('MB', '')) || 8) >= 8 ? 8 : 4))[0];
      setReleaseId(rel?.id ?? '');
      if (!rel) setMode('nvs');
      setPhase('detected');
    } catch (e) { fail(e); }
  }

  function buildConfig(nodeId: number, psk: string): NodeProvisioningConfig {
    return {
      ssid: wifi.ssid, password: wifi.password, targetIp, targetPort: 5005, nodeId,
      edgeTier: advanced.edgeTier, wasmVerify: true, otaPsk: psk,
      ...(advanced.channel ? { channel: Number(advanced.channel) } : {}),
    };
  }

  async function prepareBoard(mac: string, chip: string, flashSize: string | null) {
    const res = await props.prepare({ installationId: props.installationId, gatewayId, roomId, mac, chip, flashSize, name: name || `Sensor ${mac.slice(-5)}` });
    if (!res.ok) throw new Error(res.error);
    const cfg = buildConfig(res.nodeId, res.otaPsk);
    const release = mode === 'full' ? props.releases.find((r) => r.id === releaseId) ?? null : null;
    prepared.current = { res, cfg, release };
    return { res, cfg, release, nvs: buildProvisioningNvs(cfg) };
  }

  async function provision() {
    if (!board || !session.current) return;
    setError(null); setPhase('working');
    try {
      const { res, release, nvs } = await prepareBoard(board.mac, board.chip, board.flashSize);
      addLog(`Registered as node ${res.nodeId}${res.reused ? ' (existing device)' : ''}`);
      const images: FlashImage[] = [];
      if (release) {
        for (const [role, label] of [['bootloader', 'Bootloader'], ['partition_table', 'Partition table'], ['ota_data', 'OTA data'], ['app', 'Application']] as const) {
          setProgress({ label: `Downloading ${label}`, pct: 0 });
          const r = await fetch(`/api/firmware/${release.id}/${role}`);
          if (!r.ok) throw new Error(`Download of ${label} failed (${r.status})`);
          const data = new Uint8Array(await r.arrayBuffer());
          if ((await sha256(data)) !== release.files[role]?.sha256) throw new Error(`${label} failed its SHA-256 check — aborting`);
          images.push({ address: FLASH_LAYOUT[role], data, label });
        }
      }
      images.push({ address: NVS_PARTITION_OFFSET, data: nvs, label: 'Configuration (NVS)' });
      images.sort((a, b) => a.address - b.address);
      await session.current.flash(images, (label, pct) => setProgress({ label: `Writing ${label}`, pct }));
      setProgress(null);
      setPhase('monitor');
      const lb = new LineBuffer();
      await session.current.resetAndMonitor((chunk) => {
        for (const l of lb.push(chunk)) { addLog(l); setBoot((s) => parseBootLine(l, s)); }
      });
    } catch (e) { setProgress(null); fail(e); }
  }

  async function confirm() {
    const p = prepared.current;
    if (!p) return;
    const r = await props.complete({
      installationId: props.installationId, deviceId: p.res.deviceId, otaPsk: p.res.otaPsk,
      releaseId: p.release?.id ?? null, firmwareVersion: boot.version ?? p.release?.version ?? null,
      config: p.cfg as unknown as Record<string, unknown>, bootCheck: { ...boot },
    });
    if (!r.ok) return fail(r.error);
    await session.current?.close();
    setPhase('done');
  }

  async function manualBundle() {
    try {
      const mac = manualMac.trim().toLowerCase();
      const { res, nvs } = await prepareBoard(mac, 'ESP32-S3', null);
      downloadBlob(nvs, `nvs-node${res.nodeId}.bin`);
      addLog(`NVS image for node ${res.nodeId} downloaded. Flash with: python -m esptool --chip esp32s3 --port <PORT> write_flash 0x9000 nvs-node${res.nodeId}.bin`);
      setPhase('monitor');
    } catch (e) { fail(e); }
  }

  const reset = () => { setPhase('idle'); setBoard(null); setBoot(emptyBoot()); setName(''); setProgress(null); prepared.current = null; };
  const ready = wifi.ssid && targetIp && roomId && gatewayId && (wifi.password === '' || wifi.password.length >= 8);
  const healthy = boot.ip && boot.streamingTo && !boot.panic;

  return (
    <Card>
      <CardHeader title="Provision sensor nodes" subtitle="Connect one ESP32-S3 board by USB at a time. Keep this tab open while flashing." />
      <CardBody className="space-y-5">
        <div className="grid gap-3 md:grid-cols-2">
          <Field label="Home WiFi (2.4 GHz) SSID" hint="ESP32-S3 has no 5 GHz radio."><Input value={wifi.ssid} onChange={(e) => setWifi({ ...wifi, ssid: e.target.value })} autoComplete="off" /></Field>
          <Field label="WiFi password" hint="Used only in this browser to build the device configuration. Never sent to or stored by the platform.">
            <Input type="password" value={wifi.password} onChange={(e) => setWifi({ ...wifi, password: e.target.value })} autoComplete="new-password" />
          </Field>
          <Field label="Gateway">
            <Select value={gatewayId} onChange={(e) => { setGatewayId(e.target.value); setTargetIp(props.gateways.find((g) => g.id === e.target.value)?.lanIps[0] ?? ''); }}>
              {props.gateways.map((g) => <option key={g.id} value={g.id}>{g.name}{g.online ? '' : ' (offline)'}</option>)}
            </Select>
          </Field>
          <Field label="Gateway LAN IP (sensor target)" hint={gw?.lanIps.length ? `Reported by the gateway: ${gw.lanIps.join(', ')}. Reserve it in the router (DHCP reservation).` : 'Gateway has not reported its LAN IP yet — enter it manually.'}>
            <Input value={targetIp} onChange={(e) => setTargetIp(e.target.value.trim())} placeholder="192.168.1.20" list="gw-ips" />
            <datalist id="gw-ips">{gw?.lanIps.map((ip) => <option key={ip} value={ip} />)}</datalist>
          </Field>
        </div>
        {props.gateways.length === 0 && <Notice tone="warn">Set up the gateway (previous step) before provisioning sensors.</Notice>}

        {!webSerialSupported() ? (
          <Notice tone="warn" title="This browser cannot access USB serial ports">
            Use Chrome or Edge on a desktop/laptop for one-click flashing. Alternatively, enter the board MAC (printed by <code>esptool read_mac</code>) to download its configuration image and flash it with esptool:
            <div className="mt-2 flex flex-wrap items-end gap-2">
              <Input value={manualMac} onChange={(e) => setManualMac(e.target.value)} placeholder="aa:bb:cc:dd:ee:ff" className="max-w-[200px]" />
              <Select value={roomId} onChange={(e) => setRoomId(e.target.value)} className="max-w-[180px]">{props.rooms.map((r) => <option key={r.id} value={r.id}>{r.name}</option>)}</Select>
              <Button variant="secondary" disabled={!ready || !/^[0-9a-fA-F]{2}(:[0-9a-fA-F]{2}){5}$/.test(manualMac)} onClick={manualBundle}><Download className="h-4 w-4" />Download NVS image</Button>
            </div>
          </Notice>
        ) : (
          <div className="rounded-xl border border-border p-4">
            {phase === 'idle' && (
              <div className="flex flex-wrap items-center justify-between gap-3">
                <p className="text-sm text-muted">Plug the board into this computer. If it is not detected, hold BOOT, tap RESET, release BOOT.</p>
                <Button onClick={connect} disabled={!ready}><Usb className="h-4 w-4" />Connect board</Button>
              </div>
            )}
            {phase === 'connecting' && <p className="flex items-center gap-2 text-sm"><Loader2 className="h-4 w-4 animate-spin" />Connecting to the bootloader…</p>}
            {board && phase !== 'idle' && phase !== 'connecting' && (
              <div className="mb-4 flex flex-wrap items-center gap-2 text-sm">
                <Badge tone={board.chip === 'ESP32-S3' ? 'ok' : 'bad'}>{board.chip}</Badge><Badge>{board.flashSize ?? 'flash ?'}</Badge>
                <span className="font-mono text-xs">{board.mac}</span>
              </div>
            )}
            {phase === 'detected' && board && (
              board.chip !== 'ESP32-S3' ? <Notice tone="bad" title="Unsupported board">{board.chip} cannot run the RuView CSI pipeline. Use an ESP32-S3 (4 MB+ flash).</Notice> : (
                <div className="space-y-4">
                  <div className="grid gap-3 md:grid-cols-3">
                    <Field label="Sensor name"><Input value={name} onChange={(e) => setName(e.target.value)} /></Field>
                    <Field label="Room"><Select value={roomId} onChange={(e) => setRoomId(e.target.value)}>{props.rooms.map((r) => <option key={r.id} value={r.id}>{r.name}</option>)}</Select></Field>
                    <Field label="Install">
                      <Select value={mode} onChange={(e) => setMode(e.target.value as 'full' | 'nvs')}>
                        <option value="full" disabled={!compatible.length}>Firmware + configuration</option>
                        <option value="nvs">Configuration only (keep firmware)</option>
                      </Select>
                    </Field>
                  </div>
                  {mode === 'full' && (
                    <Field label="Firmware release" hint={compatible.length ? undefined : `No published ${flashMb >= 8 ? 8 : 4} MB release — upload one under Firmware.`}>
                      <Select value={releaseId} onChange={(e) => setReleaseId(e.target.value)}>{compatible.map((r) => <option key={r.id} value={r.id}>{r.version}</option>)}</Select>
                    </Field>
                  )}
                  <details className="text-sm"><summary className="cursor-pointer text-muted">Advanced</summary>
                    <div className="mt-3 grid gap-3 md:grid-cols-2">
                      <Field label="Edge tier" hint="2 = on-device presence, vitals and fall flags (recommended)."><Select value={advanced.edgeTier} onChange={(e) => setAdvanced({ ...advanced, edgeTier: Number(e.target.value) as 0 | 1 | 2 })}><option value={2}>2 — full pipeline</option><option value={1}>1 — basic DSP</option><option value={0}>0 — raw CSI only</option></Select></Field>
                      <Field label="CSI channel override" hint="Leave empty to follow the access point."><Input value={advanced.channel} onChange={(e) => setAdvanced({ ...advanced, channel: e.target.value.replace(/\D/g, '') })} placeholder="auto" /></Field>
                    </div>
                  </details>
                  <div className="flex flex-wrap justify-end gap-2"><Button variant="ghost" onClick={reset}>Cancel</Button><Button onClick={provision} disabled={!ready || (mode === 'full' && !releaseId)}>Provision board</Button></div>
                </div>
              )
            )}
            {phase === 'working' && (
              <div className="space-y-2">
                <p className="flex items-center gap-2 text-sm"><Loader2 className="h-4 w-4 animate-spin" />{progress?.label ?? 'Preparing…'}</p>
                {progress && <div className="h-2 overflow-hidden rounded-full bg-surface-2"><div className="h-full bg-brand transition-all" style={{ width: `${progress.pct}%` }} /></div>}
                <p className="text-xs text-muted">Do not unplug the board.</p>
              </div>
            )}
            {(phase === 'monitor' || phase === 'done') && (
              <div className="space-y-3">
                <ul className="grid gap-1.5 text-sm sm:grid-cols-2">
                  {[
                    ['Firmware booted', boot.booted, boot.version ? `v${boot.version}, node ${boot.nodeId}` : null],
                    ['Joined WiFi', !!boot.ip, boot.ip ?? (boot.wifiFailed ? 'failed — check SSID/password' : boot.wifiRetries ? `retrying (${boot.wifiRetries})` : null)],
                    ['Streaming to gateway', !!boot.streamingTo, boot.streamingTo ? `${boot.streamingTo} · tier ${boot.edgeTier}` : null],
                    ['OTA authentication', boot.otaAuth === true, boot.otaAuth === false ? 'PSK missing!' : null],
                  ].map(([label, ok, detail]) => (
                    <li key={label as string} className="flex items-center gap-2">
                      {ok ? <CheckCircle2 className="h-4 w-4 text-ok" /> : boot.wifiFailed && label === 'Joined WiFi' ? <CircleX className="h-4 w-4 text-bad" /> : <Loader2 className="h-4 w-4 animate-spin text-muted" />}
                      <span>{label as string}</span>{detail && <span className="text-xs text-muted">· {detail as string}</span>}
                    </li>
                  ))}
                </ul>
                {boot.panic && <Notice tone="bad">The firmware crashed during boot. Check the log below and the board power supply.</Notice>}
                {boot.ip && boot.streamingTo && targetIp && !boot.streamingTo.startsWith(targetIp) && <Notice tone="warn">The node is streaming to {boot.streamingTo}, not the gateway IP {targetIp}.</Notice>}
                <p className="text-xs text-muted">After boot the node calibrates presence for ~60 s — keep the room empty and still during this time.</p>
                {phase === 'monitor' && (
                  <div className="flex flex-wrap justify-end gap-2">
                    <Button variant="ghost" onClick={reset}>Discard</Button>
                    <Button onClick={confirm} variant={healthy ? 'primary' : 'secondary'}>{healthy ? 'Confirm & save' : 'Save anyway'}</Button>
                  </div>
                )}
                {phase === 'done' && (
                  <div className="flex items-center justify-between rounded-lg bg-ok-soft px-3 py-2 text-sm text-ok">
                    <span>Saved. The gateway marks the node online when its first packets arrive.</span>
                    <Button variant="secondary" onClick={reset}>Provision next board</Button>
                  </div>
                )}
              </div>
            )}
            {phase === 'error' && (
              <div className="space-y-3">
                <Notice tone="bad" title="Provisioning stopped">{error}</Notice>
                <div className="flex justify-end"><Button variant="secondary" onClick={reset}>Start over</Button></div>
              </div>
            )}
          </div>
        )}
        {log.length > 0 && (
          <details open={phase === 'monitor' || phase === 'error'}>
            <summary className="cursor-pointer text-sm text-muted">Serial log</summary>
            <pre className={cn('mt-2 max-h-64 overflow-auto rounded-lg bg-nav p-3 font-mono text-[11px] leading-relaxed text-nav-fg')}>{log.join('\n')}</pre>
          </details>
        )}
      </CardBody>
    </Card>
  );
}
