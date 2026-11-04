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

/** Firmware OTA endpoint rejects images above this size (main/ota_update.c OTA_MAX_SIZE). */
export const FIRMWARE_OTA_MAX_BYTES = 900 * 1024;

/** Flash offsets shared by partitions_display.csv (8 MB) and partitions_4mb.csv. */
export const FLASH_LAYOUT = {
  bootloader: 0x0,
  partition_table: 0x8000,
  nvs: 0x9000,
  ota_data: 0xf000,
  app: 0x20000,
} as const;
export type FirmwareFileRole = keyof Omit<typeof FLASH_LAYOUT, 'nvs'>;
