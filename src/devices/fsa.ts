import { C } from '../theme/palette';
import { DeviceRegister, decodeRegister } from './types';

export const FSAAddresses = {
  reserved: 0,
  deviceId: 1,
  version: 2,
  z1Config: 3,
  z2Config: 4,
  z1Status: 5,
  z2Status: 6,
  deviceStatus: 7,
  powerStatus: 8,
  sirenStatus: 9,
  relayStatus: 10,
} as const;

export const fsaRegisters: DeviceRegister[] = [
  { address: FSAAddresses.reserved, name: 'Reserved' },
  { address: FSAAddresses.deviceId, name: 'Device ID', valueMap: { 21073: 'FSA-212R' } },
  { address: FSAAddresses.version, name: 'Version', valueMap: { 16641: 'A01' } },
  { address: FSAAddresses.z1Config, name: 'Z1 Config', valueMap: { 0: 'Close', 1: 'Open' } },
  { address: FSAAddresses.z2Config, name: 'Z2 Config', valueMap: { 0: 'Close', 1: 'Open' } },
  { address: FSAAddresses.z1Status, name: 'Z1 Status', valueMap: { 0: 'Healthy', 1: 'Fire' } },
  { address: FSAAddresses.z2Status, name: 'Z2 Status', valueMap: { 0: 'Healthy', 1: 'Fire' } },
  { address: FSAAddresses.deviceStatus, name: 'Device Status', valueMap: { 0: 'Healthy', 1: 'Fire', 2: 'Silent' } },
  { address: FSAAddresses.powerStatus, name: 'Power Status', valueMap: { 0: 'Main', 1: 'Battery' } },
  { address: FSAAddresses.sirenStatus, name: 'Siren Status', valueMap: { 0: 'Off', 1: 'On' } },
  { address: FSAAddresses.relayStatus, name: 'Relay Status', valueMap: { 0: 'Off', 1: 'On' } },
];

/** Everything after Reserved / Device ID / Version. */
export const visibleFsaRegisters = fsaRegisters.filter((r) => r.address > FSAAddresses.version);

export const getFSARegister = (address: number) => fsaRegisters.find((r) => r.address === address);

export const decodeFSARegisterValue = (address: number, value: number) => {
  const r = getFSARegister(address);
  return r ? decodeRegister(r, value) : String(value);
};

export function getFSARegisterColor(name: string, value: string): string {
  const v = value.toLowerCase();
  switch (name) {
    case 'Device ID':
    case 'Version':
      return C.grey;
    case 'Z1 Config':
    case 'Z2 Config':
      return v === 'open' ? C.lightBlue : C.blueAccent;
    case 'Z1 Status':
    case 'Z2 Status':
      return v === 'fire' ? C.red : C.green;
    case 'Device Status':
      switch (v) {
        case 'fire': return C.red;
        case 'silent': return C.purple;
        case 'healthy': return C.green;
        default: return C.grey;
      }
    case 'Power Status':
      return v === 'main' ? C.green : C.orange;
    case 'Siren Status':
    case 'Relay Status':
      return v === 'on' ? C.green : C.grey;
    default:
      return C.grey;
  }
}
