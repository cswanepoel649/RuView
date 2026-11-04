import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { generateNvsImage, type NvsEntry, NvsError, zlibCrc32 } from '../src/nvs/generator';
import { buildProvisioningNvs, provisioningEntries, redactProvisioningConfig, validateProvisioningConfig } from '../src/nvs/provisioning';

const fx = (name: string) => new Uint8Array(readFileSync(fileURLToPath(new URL(`./fixtures/${name}`, import.meta.url))));

function firstDiff(a: Uint8Array, b: Uint8Array) {
  for (let i = 0; i < Math.max(a.length, b.length); i++) if (a[i] !== b[i]) return i;
  return -1;
}

describe('zlibCrc32', () => {
  it('matches zlib.crc32(data, 0xFFFFFFFF) known values', () => {
    // python3 -c "import zlib;print(hex(zlib.crc32(b'',0xFFFFFFFF)), hex(zlib.crc32(b'123456789',0xFFFFFFFF)))"
    expect(zlibCrc32(new Uint8Array())).toBe(0xffffffff);
    expect(zlibCrc32(new TextEncoder().encode('123456789'))).toBe(0xd202d277);
    expect(zlibCrc32(new TextEncoder().encode('123456789'), 0)).toBe(0xcbf43926); // standard CRC-32 check value
  });
});

describe('NVS generator — byte-exact with ESP-IDF nvs_partition_gen', () => {
  it('matches provision.py --dry-run output', () => {
    const img = buildProvisioningNvs({
      ssid: 'HomeNet-2G', password: 'correct horse battery', targetIp: '192.168.1.20', targetPort: 5005,
      nodeId: 3, edgeTier: 2, fallThresh: 15000, vitalIntervalMs: 1000, channel: 6,
      filterMac: 'AA:BB:CC:DD:EE:01', hopChannels: [1, 6, 11], hopDwellMs: 200, zone: 'lobby',
    });
    const golden = fx('provision_py_golden.bin');
    expect(img.length).toBe(0x6000);
    expect(firstDiff(img, golden)).toBe(-1);
  });

  it('matches upstream provision.py (firmware v0.8.17) including security/ota_psk', () => {
    // python provision.py ... --ota-psk-file <64×'b'> --dry-run (same args as above)
    const img = buildProvisioningNvs({
      ssid: 'HomeNet-2G', password: 'correct horse battery', targetIp: '192.168.1.20', targetPort: 5005,
      nodeId: 3, edgeTier: 2, fallThresh: 15000, vitalIntervalMs: 1000, channel: 6,
      filterMac: 'AA:BB:CC:DD:EE:01', hopChannels: [1, 6, 11], hopDwellMs: 200, zone: 'lobby', otaPsk: 'b'.repeat(64),
    });
    expect(firstDiff(img, fx('provision_py_v0817_psk_golden.bin'))).toBe(-1);
  });

  it('matches reference for the full platform image (security namespace, blobs, unicode, open network)', () => {
    const img = buildProvisioningNvs({
      ssid: 'Café-Ω', password: '', targetIp: '10.0.0.2', targetPort: 5005, nodeId: 254,
      tdmSlot: 1, tdmTotal: 3, edgeTier: 1, presThresh: 0, channel: 11, filterMac: '00:11:22:33:44:FF',
      hopChannels: [1, 11], hopDwellMs: 4294967295, wasmVerify: true,
      otaPsk: '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef',
    });
    expect(firstDiff(img, fx('platform_golden.bin'))).toBe(-1);
  });

  it('matches reference under page overflow and multi-page blob chunking', () => {
    const csv = readFileSync(fileURLToPath(new URL('./fixtures/stress.csv', import.meta.url)), 'utf8').trim().split('\n').slice(1);
    const entries: NvsEntry[] = csv.map((line) => {
      const [key, type, encoding, value] = line.split(',') as [string, string, string, string];
      if (type === 'namespace') return { type: 'namespace', key };
      if (encoding === 'string') return { type: 'data', key, encoding, value };
      if (encoding === 'hex2bin') return { type: 'data', key, encoding: 'binary', value: Uint8Array.from(value.match(/../g)!.map((h) => parseInt(h, 16))) };
      return { type: 'data', key, encoding: encoding as 'u8', value: BigInt(value) };
    });
    const img = generateNvsImage(entries, 0x6000);
    expect(firstDiff(img, fx('stress_golden.bin'))).toBe(-1);
  });
});

describe('provisioning validation', () => {
  const base = { ssid: 'Net', password: 'longenough', targetIp: '192.168.1.2', nodeId: 1 };
  it('rejects bad inputs', () => {
    expect(() => validateProvisioningConfig({ ...base, targetIp: 'gateway.local' })).toThrow(NvsError);
    expect(() => validateProvisioningConfig({ ...base, password: 'short' })).toThrow(/8 characters/);
    expect(() => validateProvisioningConfig({ ...base, ssid: 'x'.repeat(33) })).toThrow(/32 bytes/);
    expect(() => validateProvisioningConfig({ ...base, nodeId: 300 })).toThrow();
    expect(() => validateProvisioningConfig({ ...base, tdmSlot: 3, tdmTotal: 3 })).toThrow();
    expect(() => validateProvisioningConfig({ ...base, otaPsk: 'NOT-HEX' })).toThrow();
    expect(() => validateProvisioningConfig({ ...base, otaPsk: 'a'.repeat(32) })).toThrow(/exactly 64/);
    expect(() => validateProvisioningConfig({ ...base, channel: 20 })).toThrow();
  });
  it('always writes WiFi trio + node id first (full-replace semantics)', () => {
    const keys = provisioningEntries(base).map((e) => e.key);
    expect(keys.slice(0, 5)).toEqual(['csi_cfg', 'ssid', 'password', 'target_ip', 'node_id']);
  });
  it('redacts secrets', () => {
    const r = redactProvisioningConfig({ ...base, otaPsk: 'a'.repeat(64) });
    expect(JSON.stringify(r)).not.toContain('longenough');
    expect(JSON.stringify(r)).not.toContain('a'.repeat(64));
    expect(r.passwordSet).toBe(true);
    expect(r.otaPskSet).toBe(true);
  });
  it('fails cleanly when data does not fit', () => {
    const entries: NvsEntry[] = [{ type: 'namespace', key: 'big' }];
    for (let i = 0; i < 8; i++) entries.push({ type: 'data', key: `s${i}`, encoding: 'string', value: 'y'.repeat(3900) });
    expect(() => generateNvsImage(entries, 0x6000)).toThrow(NvsError);
  });
});
