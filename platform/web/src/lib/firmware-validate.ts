/**
 * Structural validation of ESP-IDF flash images before a release is accepted.
 * Pure (no I/O) so it runs in tests against firmware/esp32-csi-node/release_bins.
 */
export type FirmwareRole = 'bootloader' | 'partition_table' | 'ota_data' | 'app';
export const ESP32_S3_CHIP_ID = 9;
const MOCK_MARKERS = ['=== Scenario %u started ===', 'All %d scenarios complete'];

export interface ImageCheck { ok: boolean; errors: string[]; isMockBuild: boolean; chipId: number | null }

function contains(hay: Uint8Array, needle: string): boolean {
  const n = new TextEncoder().encode(needle);
  outer: for (let i = 0; i <= hay.length - n.length; i++) {
    for (let j = 0; j < n.length; j++) if (hay[i + j] !== n[j]) continue outer;
    return true;
  }
  return false;
}

export function validateFirmwareFile(role: FirmwareRole, data: Uint8Array, flashSizeMb: number): ImageCheck {
  const errors: string[] = [];
  let chipId: number | null = null;
  let isMockBuild = false;
  if (role === 'app' || role === 'bootloader') {
    if (data.length < 24 || data[0] !== 0xe9) errors.push(`${role}: not an ESP application image (missing 0xE9 magic)`);
    else {
      chipId = data[12]! | (data[13]! << 8);
      if (chipId !== ESP32_S3_CHIP_ID) errors.push(`${role}: built for chip id ${chipId}, expected ESP32-S3 (${ESP32_S3_CHIP_ID})`);
    }
  }
  if (role === 'app') {
    const slot = flashSizeMb >= 8 ? 0x200000 : 0x1d0000; // ota_0 size in partitions_display.csv / partitions_4mb.csv
    if (data.length > slot) errors.push(`app: ${data.length} bytes exceeds the ${slot}-byte OTA slot`);
    isMockBuild = MOCK_MARKERS.some((m) => contains(data, m));
  }
  if (role === 'partition_table') {
    if (data.length !== 3072 || data[0] !== 0xaa || data[1] !== 0x50) errors.push('partition_table: expected a 3072-byte ESP partition table (0xAA50 magic)');
  }
  if (role === 'ota_data') {
    if (data.length !== 8192) errors.push('ota_data: expected 8192 bytes (ota_data_initial.bin)');
  }
  if (role === 'bootloader' && data.length > 0x8000) errors.push('bootloader: larger than 32 KB (overlaps partition table)');
  return { ok: errors.length === 0, errors, isMockBuild, chipId };
}
