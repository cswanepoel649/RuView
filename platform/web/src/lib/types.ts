/** Row shapes for the tables the UI reads (subset of supabase/migrations). */
export type MemberRole = 'owner' | 'member' | 'viewer';
export type PlatformRole = 'platform_admin' | 'installer';
export type SecurityMode = 'disarmed' | 'armed_home' | 'armed_away';
export type DeviceStatus = 'inventory' | 'assigned' | 'provisioned' | 'online' | 'offline' | 'fault' | 'retired';
export type Severity = 'info' | 'warning' | 'critical';
export type MotionLevel = 'absent' | 'present_still' | 'present_moving' | 'active';

export interface Profile { id: string; email: string; full_name: string | null; phone: string | null; platform_role: PlatformRole | null }
export interface Client {
  id: string; display_name: string; legal_name: string | null; kind: 'individual' | 'business'; primary_email: string | null;
  primary_phone: string | null; account_ref: string | null; notes: string | null; status: 'active' | 'suspended' | 'archived';
  billing_address: Record<string, string>; created_at: string;
}
export interface ClientContact { id: string; client_id: string; name: string; relationship: string | null; email: string | null; phone: string | null; kind: string; notes: string | null }
export interface Property {
  id: string; client_id: string; name: string; address_line1: string | null; address_line2: string | null; city: string | null;
  region: string | null; postal_code: string | null; country: string | null; timezone: string; status: string;
  security_mode: SecurityMode; security_mode_changed_at: string; exit_delay_s: number; features: Record<string, unknown>;
  access_notes: string | null; notes: string | null; latitude: number | null; longitude: number | null;
}
export interface Floor { id: string; property_id: string; client_id: string; name: string; level: number; plan_path: string | null; plan_width: number | null; plan_height: number | null; sort_order: number }
export interface Room {
  id: string; property_id: string; client_id: string; floor_id: string | null; name: string; room_type: string;
  shape: [number, number][] | null; monitoring_enabled: boolean; sort_order: number; notes: string | null;
}
export interface Zone { id: string; property_id: string; client_id: string; name: string; description: string | null; active_modes: SecurityMode[]; entry_delay_s: number; enabled: boolean; auto_include_new_rooms: boolean }
export interface DeviceModel { id: string; kind: 'sensor_node' | 'gateway'; manufacturer: string; name: string; chip: string | null; flash_mb: number | null; firmware_family: string | null; capabilities: string[]; provisioning: string; supported: boolean; notes: string | null }
export interface Device {
  id: string; kind: 'sensor_node' | 'gateway'; model_id: string; name: string; serial_number: string | null; hw_id: string | null;
  client_id: string | null; property_id: string | null; room_id: string | null; gateway_id: string | null; node_id: number | null;
  status: DeviceStatus; firmware_version: string | null; firmware_release_id: string | null; desired_config: Record<string, unknown>;
  provisioned_config: Record<string, unknown> | null; provisioned_at: string | null; position: { x: number; y: number } | null;
  mount_notes: string | null; last_seen_at: string | null; last_ip: string | null; last_rssi: number | null; health: Record<string, unknown>;
  notes: string | null; created_at: string;
}
export interface RoomState {
  room_id: string; property_id: string; client_id: string; occupied: boolean; person_count: number; motion_level: MotionLevel;
  confidence: number | null; contributing_nodes: number; stale: boolean; last_presence_seen_at: string | null;
  last_motion_at: string | null; last_change_at: string | null; observed_at: string | null; updated_at: string;
}
export interface NodeState {
  device_id: string; room_id: string | null; property_id: string; presence: boolean; motion_level: MotionLevel; person_count: number;
  motion_energy: number | null; presence_score: number | null; confidence: number | null; rssi: number | null; frame_rate: number | null;
  source: string; vitals: { breathing_bpm: number | null; heart_bpm: number | null; source: string } | null; observed_at: string; received_at: string;
}
export interface EventRow {
  id: string; client_id: string; property_id: string | null; room_id: string | null; zone_id: string | null; device_id: string | null;
  event_type: string; severity: Severity; title: string; message: string | null; data: Record<string, unknown>; occurred_at: string;
  acknowledged_at: string | null; acknowledged_by: string | null; ack_note: string | null; resolved_at: string | null;
}
export interface FirmwareFile { path: string; size: number; sha256: string; offset: number }
export interface FirmwareRelease {
  id: string; family: string; version: string; flash_size_mb: number; model_ids: string[]; channel: string; status: string;
  files: Partial<Record<'app' | 'bootloader' | 'partition_table' | 'ota_data', FirmwareFile>>; app_size: number | null;
  notes: string | null; is_mock_build: boolean; created_at: string; published_at: string | null;
}
export interface Installation {
  id: string; property_id: string; client_id: string; status: 'draft' | 'in_progress' | 'completed' | 'cancelled';
  technician_id: string | null; scheduled_for: string | null; started_at: string | null; completed_at: string | null;
  current_step: string; steps: Record<string, { done?: boolean; at?: string; note?: string }>; notes: string | null; created_at: string;
}
export interface Ticket {
  id: string; reference: number; client_id: string; property_id: string | null; device_id: string | null; opened_by: string | null;
  assigned_to: string | null; category: string; priority: string; subject: string; description: string; status: string; created_at: string; updated_at: string;
}
export interface Notification { id: string; event_id: string | null; channel: string; status: string; severity: Severity; title: string; body: string | null; link: string | null; created_at: string; read_at: string | null }
export interface AlertRule { id: string; client_id: string; property_id: string | null; zone_id: string | null; room_id: string | null; event_type: string; channels: string[]; schedule: { start: string; end: string; days?: number[] } | null; enabled: boolean }
