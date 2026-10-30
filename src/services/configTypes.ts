import { DeviceType } from '../devices/types';
import { C } from '../theme/palette';
import { FSAAddresses } from '../devices/fsa';
import { MLPAddresses } from '../devices/mlp';

export type SensorType = 'fire' | 'temperature';

export const SensorTypeUi: Record<SensorType, { icon: string; label: string; color: string }> = {
  fire: { icon: 'local-fire-department', label: 'Fire', color: C.redAccent },
  temperature: { icon: 'thermostat', label: 'Temperature', color: C.tealAccent },
};

export interface PlacedSensor {
  slaveId: number;
  zoneAddress: number;
  zoneLabel: string;
  type: SensorType;
  name: string;
  location: string;
  notes: string;
  /** 0..1 fraction of image width/height. */
  xFraction: number;
  yFraction: number;
}

export interface SiteImageConfig {
  id: string;
  imagePath: string;
  loadedAt: Date;
  floorLabel: string;
  sensors: PlacedSensor[];
}

export interface SensorZone {
  address: number;
  label: string;
}

export const deviceSensorZones: Record<DeviceType, SensorZone[]> = {
  fsa: [
    { address: FSAAddresses.z1Status, label: 'Zone 1' },
    { address: FSAAddresses.z2Status, label: 'Zone 2' },
  ],
  mlp: [
    { address: MLPAddresses.z1Status, label: 'Zone 1' },
    { address: MLPAddresses.z2Status, label: 'Zone 2' },
    { address: MLPAddresses.z3Status, label: 'Zone 3' },
    { address: MLPAddresses.z4Status, label: 'Zone 4' },
  ],
};

export const zonesForDeviceType = (t: DeviceType): SensorZone[] => deviceSensorZones[t] ?? [];
