import { C } from '../theme/palette';
import { DeviceRegister, decodeRegister } from './types';

export const MLPAddresses = {
  reserved: 0, deviceId: 1, version: 2, pwrStatus: 3, devStatus: 4,
  z1Input: 5, z2Input: 6, z3Input: 7, z4Input: 8,
  z1Config: 9, z2Config: 10, z3Config: 11, z4Config: 12,
  z1Status: 13, z2Status: 14, z3Status: 15, z4Status: 16,
  rel1Status: 17, rel2Status: 18, rel3Status: 19, rel4Status: 20,
  htr1Status: 21, htr2Status: 22,
} as const;

const input = { 0: 'Off', 1: 'Fault', 2: 'Fire' };
const config = { 0: 'NC', 1: 'NO' };
const zone = { 0: 'Healthy', 1: 'Fault', 2: 'Fire', 3: 'Recovered', 255: 'Disable' };
const onOff = { 0: 'Off', 1: 'On' };

export const mlpRegisters: DeviceRegister[] = [
  { address: MLPAddresses.reserved, name: 'Reserved' },
  { address: MLPAddresses.deviceId, name: 'Device ID', valueMap: { 21073: 'MLP' } },
  { address: MLPAddresses.version, name: 'Version', valueMap: { 16641: 'A3' } },
  { address: MLPAddresses.pwrStatus, name: 'Power Status', valueMap: { 0: 'Main', 1: 'Battery' } },
  { address: MLPAddresses.devStatus, name: 'Device Status', valueMap: { 0: 'Healthy', 1: 'Fault', 2: 'Fire', 3: 'Recovered' } },
  { address: MLPAddresses.z1Input, name: 'Z1 Input', valueMap: input },
  { address: MLPAddresses.z2Input, name: 'Z2 Input', valueMap: input },
  { address: MLPAddresses.z3Input, name: 'Z3 Input', valueMap: input },
  { address: MLPAddresses.z4Input, name: 'Z4 Input', valueMap: input },
  { address: MLPAddresses.z1Config, name: 'Z1 Config', valueMap: config },
  { address: MLPAddresses.z2Config, name: 'Z2 Config', valueMap: config },
  { address: MLPAddresses.z3Config, name: 'Z3 Config', valueMap: config },
  { address: MLPAddresses.z4Config, name: 'Z4 Config', valueMap: config },
  { address: MLPAddresses.z1Status, name: 'Z1 Status', valueMap: zone },
  { address: MLPAddresses.z2Status, name: 'Z2 Status', valueMap: zone },
  { address: MLPAddresses.z3Status, name: 'Z3 Status', valueMap: zone },
  { address: MLPAddresses.z4Status, name: 'Z4 Status', valueMap: zone },
  { address: MLPAddresses.rel1Status, name: 'Relay1 Status', valueMap: onOff },
  { address: MLPAddresses.rel2Status, name: 'Relay2 Status', valueMap: onOff },
  { address: MLPAddresses.rel3Status, name: 'Relay3 Status', valueMap: onOff },
  { address: MLPAddresses.rel4Status, name: 'Relay4 Status', valueMap: onOff },
  { address: MLPAddresses.htr1Status, name: 'Siren Status', valueMap: onOff },
  { address: MLPAddresses.htr2Status, name: 'Hooter Status', valueMap: onOff },
];

export const visibleMlpRegisters = mlpRegisters.filter((r) => r.address > MLPAddresses.version);

/** Single-slave layout: hides raw zone Input/Config registers. */
export const compactMlpRegisters = mlpRegisters.filter((r) => {
  const isHeader = r.address <= MLPAddresses.version;
  const isRawZoneDetail = r.address >= MLPAddresses.z1Input && r.address <= MLPAddresses.z4Config;
  return !isHeader && !isRawZoneDetail;
});

export const getMLPRegister = (address: number) => mlpRegisters.find((r) => r.address === address);

export const decodeMLPRegisterValue = (address: number, value: number) => {
  const r = getMLPRegister(address);
  return r ? decodeRegister(r, value) : String(value);
};

export function getMLPRegisterColor(name: string, value: string): string {
  const v = value.toLowerCase();

  if (name.includes('Config')) {
    return v === 'nc' ? C.blue : v === 'no' ? C.cyan : C.grey;
  }
  if (name.includes('Input')) {
    return v === 'fault' ? C.orange : v === 'fire' ? C.red : C.grey;
  }
  if (name.includes('Status') && name.startsWith('Z')) {
    switch (v) {
      case 'healthy': return C.green;
      case 'fault': return C.orange;
      case 'fire': return C.red;
      case 'recovered': return C.blueGrey;
      default: return C.grey;
    }
  }
  if (name === 'Device Status') {
    switch (v) {
      case 'healthy': return C.green;
      case 'fault': return C.orange;
      case 'fire': return C.red;
      case 'recovered': return C.blueGrey;
      default: return C.grey;
    }
  }
  if (name === 'Power Status') {
    return v === 'main' ? C.green : v === 'battery' ? C.orange : C.grey;
  }
  if (name.includes('Relay')) return v === 'on' ? C.red : C.grey;
  if (name.includes('Hooter') || name.includes('Siren')) return v === 'on' ? C.red : C.grey;
  return C.grey;
}
