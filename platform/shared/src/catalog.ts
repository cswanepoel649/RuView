/** Human-readable labels shared by UI surfaces. Event kinds live in the DB (event_types). */
import type { MotionLevel } from './protocol';

export const MOTION_LEVEL_LABEL: Record<MotionLevel, string> = {
  absent: 'No presence',
  present_still: 'Present, still',
  present_moving: 'Moving',
  active: 'Very active',
};

export const MOTION_RANK: Record<MotionLevel, number> = { absent: 0, present_still: 1, present_moving: 2, active: 3 };

export const CAPABILITY_LABEL: Record<string, string> = {
  csi: 'WiFi CSI sensing',
  presence: 'Presence',
  motion: 'Motion level',
  person_estimate: 'Person estimate',
  fall: 'Fall heuristic (experimental)',
  vitals: 'Breathing / heart rate (experimental)',
  mmwave_vitals: 'mmWave vitals',
  mmwave_distance: 'mmWave distance',
  ota: 'Over-the-air updates',
  wasm: 'WASM edge modules (alpha)',
  sensing_server: 'RuView sensing server',
  udp_relay: 'UDP relay',
  ota_proxy: 'OTA proxy',
};

/**
 * OTA size limits (firmware/esp32-csi-node/main/ota_update.c).
 * Current firmware accepts images up to the target OTA partition and reports it as
 * `max_size` in GET /ota/status; firmware ≤ v0.6.x used a fixed 900 KB gate (and
 * reported max_size = 921600). The device-reported value is authoritative.
 */
export const LEGACY_OTA_MAX_BYTES = 900 * 1024;

/** ota_0 size in partitions_display.csv (8/16 MB) and partitions_4mb.csv. */
export function otaSlotBytes(flashMb: number): number {
  return flashMb >= 8 ? 0x200000 : 0x1d0000;
}

/** Effective OTA limit: the node's reported max_size when known, otherwise the slot size. */
export function otaLimitBytes(flashMb: number, reportedMaxSize?: number | null): number {
  return reportedMaxSize && reportedMaxSize > 0 ? reportedMaxSize : otaSlotBytes(flashMb);
}

/** Flash offsets shared by partitions_display.csv (8 MB) and partitions_4mb.csv. */
export const FLASH_LAYOUT = {
  bootloader: 0x0,
  partition_table: 0x8000,
  nvs: 0x9000,
  ota_data: 0xf000,
  app: 0x20000,
} as const;
export type FirmwareFileRole = keyof Omit<typeof FLASH_LAYOUT, 'nvs'>;
