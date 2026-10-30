import { DeviceModel, DeviceSignature, DeviceType } from './types';
import { fsaRegisters, getFSARegisterColor } from './fsa';
import { mlpRegisters, getMLPRegisterColor } from './mlp';

export const DeviceModels: Record<DeviceType, DeviceModel> = {
  fsa: { type: 'fsa', modelName: 'FSA-212R', startAddress: 0, quantity: fsaRegisters.length, registers: fsaRegisters },
  mlp: { type: 'mlp', modelName: 'MLP-4052', startAddress: 0, quantity: mlpRegisters.length, registers: mlpRegisters },
};

export const getModelByType = (type: DeviceType): DeviceModel => DeviceModels[type] ?? DeviceModels.fsa;

////////////////////////////////////////////////////////////
// Supported device signatures
////////////////////////////////////////////////////////////

export const SupportedDevices = {
  list: [
    { modelName: 'RQ_A01', r1: 0x5251, r2: 0x4101, type: 'fsa' },
    { modelName: 'MLP', r1: 0x5251, r2: 0x4103, type: 'mlp' },
  ] as DeviceSignature[],

  swap(v: number) {
    return ((v & 0xff) << 8) | ((v >> 8) & 0xff);
  },

  /** Tries raw and byte-swapped combinations of the two signature registers. */
  find(r1: number, r2: number): DeviceSignature | null {
    const candidates: [number, number][] = [
      [r1, r2],
      [this.swap(r1), r2],
      [r1, this.swap(r2)],
      [this.swap(r1), this.swap(r2)],
    ];
    for (const [a, b] of candidates) {
      const m = this.list.find((d) => d.r1 === a && d.r2 === b);
      if (m) return m;
    }
    return null;
  },

  findByName(name: string) {
    return this.list.find((d) => d.modelName === name) ?? null;
  },

  getByType(type: DeviceType) {
    return this.list.filter((d) => d.type === type);
  },
};

////////////////////////////////////////////////////////////
// Colour mapping / preview
////////////////////////////////////////////////////////////

export const DeviceColorMapper = {
  getColor(type: DeviceType, label: string, value: string): string {
    return type === 'fsa' ? getFSARegisterColor(label, value) : getMLPRegisterColor(label, value);
  },
  getPreviewRegisterCount(type: DeviceType): number {
    return type === 'fsa' ? 11 : 15;
  },
};
