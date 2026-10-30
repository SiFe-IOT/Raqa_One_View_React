export type DeviceType = 'fsa' | 'mlp';
export const DEVICE_TYPES: DeviceType[] = ['fsa', 'mlp'];

export interface DeviceRegister {
  /** 0-based Modbus register address (0 == 40001). */
  address: number;
  name: string;
  valueMap?: Record<number, string>;
}

export const decodeRegister = (r: DeviceRegister, value: number): string =>
  r.valueMap?.[value] ?? String(value);

export interface DeviceSignature {
  modelName: string;
  r1: number;
  r2: number;
  type: DeviceType;
}

export interface DeviceModel {
  type: DeviceType;
  modelName: string;
  startAddress: number;
  quantity: number;
  registers: DeviceRegister[];
}

export interface RegisterData {
  address: number;
  value?: number;
}
