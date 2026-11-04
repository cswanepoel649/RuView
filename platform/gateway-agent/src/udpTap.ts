/**
 * Transparent UDP tap: ESP32 nodes send to <gateway>:5005; every datagram is
 * forwarded byte-for-byte to the RuView sensing-server (127.0.0.1:5006) and
 * decoded locally for liveness/identity/edge analytics. RuView is not modified.
 */
import dgram from 'node:dgram';
import { decodePacket } from '@ruview/shared/esp32';
import type { NodeRegistry } from './nodeRegistry';
import { log } from './log';

export interface UdpTapStats {
  received: number;
  forwarded: number;
  undecodable: number;
  forwardErrors: number;
}

export class UdpTap {
  private rx?: dgram.Socket;
  private tx?: dgram.Socket;
  readonly stats: UdpTapStats = { received: 0, forwarded: 0, undecodable: 0, forwardErrors: 0 };

  constructor(
    private readonly registry: NodeRegistry,
    private readonly listen: { host: string; port: number },
    private readonly forward: { host: string; port: number },
  ) {}

  async start(): Promise<void> {
    this.tx = dgram.createSocket('udp4');
    this.rx = dgram.createSocket({ type: 'udp4', reuseAddr: false });
    this.rx.on('message', (msg, rinfo) => this.handle(msg, rinfo.address));
    this.rx.on('error', (e) => log.error('udp tap socket error', { error: e.message }));
    await new Promise<void>((resolve, reject) => {
      this.rx!.once('error', reject);
      this.rx!.bind(this.listen.port, this.listen.host, () => {
        this.rx!.off('error', reject);
        resolve();
      });
    });
    log.info('udp tap listening', { listen: `${this.listen.host}:${this.listen.port}`, forward: `${this.forward.host}:${this.forward.port}` });
  }

  private handle(msg: Buffer, ip: string) {
    this.stats.received++;
    // 1) forward unchanged (sensing-server does its own parsing)
    this.tx!.send(msg, this.forward.port, this.forward.host, (err) => {
      if (err) {
        this.stats.forwardErrors++;
        if (this.stats.forwardErrors % 100 === 1) log.warn('udp forward failed', { error: err.message });
      } else this.stats.forwarded++;
    });
    // 2) decode for our own observations
    const pkt = decodePacket(new Uint8Array(msg.buffer, msg.byteOffset, msg.byteLength));
    if (!pkt) {
      this.stats.undecodable++;
      return;
    }
    this.registry.observe(pkt, ip);
  }

  address() {
    return this.rx?.address();
  }

  async stop() {
    await Promise.all([
      new Promise<void>((r) => (this.rx ? this.rx.close(() => r()) : r())),
      new Promise<void>((r) => (this.tx ? this.tx.close(() => r()) : r())),
    ]);
  }
}
