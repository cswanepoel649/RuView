'use client';
/**
 * Browser flashing over Web Serial (Chrome/Edge desktop) using Espressif's
 * esptool-js. Loaded lazily so the library never runs during SSR.
 */
import { md5Hex } from './md5';

export interface DetectedBoard { chip: string; description: string; mac: string; flashSize: string | null }
export interface FlashImage { address: number; data: Uint8Array; label: string }

type EspModule = typeof import('esptool-js');
type Loader = InstanceType<EspModule['ESPLoader']>;
type TransportT = InstanceType<EspModule['Transport']>;

export const webSerialSupported = () => typeof navigator !== 'undefined' && 'serial' in navigator;

// Espressif native USB, Silicon Labs CP210x, WCH CH34x, FTDI
const USB_FILTERS = [{ usbVendorId: 0x303a }, { usbVendorId: 0x10c4 }, { usbVendorId: 0x1a86 }, { usbVendorId: 0x0403 }];

export class BoardSession {
  private esp!: EspModule;
  private transport!: TransportT;
  private loader!: Loader;
  private port!: SerialPort;
  private monitoring = false;

  constructor(private readonly log: (line: string) => void) {}

  async connect(): Promise<DetectedBoard> {
    this.esp = await import('esptool-js');
    this.port = await navigator.serial.requestPort({ filters: USB_FILTERS });
    this.transport = new this.esp.Transport(this.port, false);
    this.loader = new this.esp.ESPLoader({
      transport: this.transport, baudrate: 460800, romBaudrate: 115200,
      terminal: { clean: () => {}, writeLine: (d: string) => this.log(d), write: (d: string) => this.log(d) },
    });
    const description = await this.loader.main();
    const chip = this.loader.chip.CHIP_NAME;
    const mac = (await this.loader.chip.readMac(this.loader)).toLowerCase();
    let flashSize: string | null = null;
    try { flashSize = (await this.loader.detectFlashSize()) ?? null; } catch { /* some bridges fail flash id */ }
    return { chip, description, mac, flashSize };
  }

  async flash(images: FlashImage[], onProgress: (label: string, pct: number) => void) {
    await this.loader.writeFlash({
      fileArray: images.map((i) => ({ data: i.data, address: i.address })),
      flashMode: 'keep', flashFreq: 'keep', flashSize: 'keep', eraseAll: false, compress: true,
      reportProgress: (idx, written, total) => onProgress(images[idx]?.label ?? `image ${idx}`, Math.round((written / total) * 100)),
      calculateMD5Hash: (img) => md5Hex(img),
    });
  }

  /** Hard-reset into the new firmware and stream the boot log. */
  async resetAndMonitor(onChunk: (b: Uint8Array) => void) {
    await this.loader.after('hard_reset');
    await this.transport.disconnect();
    await this.transport.connect(115200);
    this.monitoring = true;
    void this.transport.rawRead(onChunk, () => !this.monitoring).catch(() => {});
  }

  async close() {
    this.monitoring = false;
    try { await this.transport?.disconnect(); } catch { /* already closed */ }
  }
}

export function downloadBlob(data: Uint8Array, filename: string) {
  const url = URL.createObjectURL(new Blob([data as BlobPart], { type: 'application/octet-stream' }));
  const a = Object.assign(document.createElement('a'), { href: url, download: filename });
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
