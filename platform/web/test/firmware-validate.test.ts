import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { validateFirmwareFile } from '../src/lib/firmware-validate';

const bin = (f: string) => new Uint8Array(readFileSync(new URL(`../../../firmware/esp32-csi-node/release_bins/${f}`, import.meta.url)));

describe('firmware image validation (real RuView release binaries)', () => {
  it('accepts the published 8 MB release set', () => {
    expect(validateFirmwareFile('bootloader', bin('bootloader.bin'), 8)).toMatchObject({ ok: true, chipId: 9 });
    expect(validateFirmwareFile('partition_table', bin('partition-table.bin'), 8).ok).toBe(true);
    expect(validateFirmwareFile('ota_data', bin('ota_data_initial.bin'), 8).ok).toBe(true);
    expect(validateFirmwareFile('app', bin('esp32-csi-node.bin'), 8)).toMatchObject({ ok: true, isMockBuild: false });
  });
  it('accepts the 4 MB app', () => {
    expect(validateFirmwareFile('app', bin('esp32-csi-node-4mb.bin'), 4).ok).toBe(true);
  });
  it('rejects wrong roles, wrong chips and mock builds', () => {
    expect(validateFirmwareFile('app', bin('partition-table.bin'), 8).ok).toBe(false);
    const wrongChip = bin('esp32-csi-node-4mb.bin').slice(); wrongChip[12] = 0; // ESP32 classic
    expect(validateFirmwareFile('app', wrongChip, 4).errors[0]).toMatch(/chip id 0/);
    const mock = new Uint8Array([...bin('esp32-csi-node-4mb.bin').slice(0, 4096), ...new TextEncoder().encode('=== Scenario %u started ===')]);
    expect(validateFirmwareFile('app', mock, 4).isMockBuild).toBe(true);
  });
});
