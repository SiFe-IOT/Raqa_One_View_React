import AsyncStorage from '@react-native-async-storage/async-storage';
import { DeviceModel, DeviceSignature, DeviceType, DEVICE_TYPES } from '../devices/types';
import { DeviceModels, getModelByType } from '../devices/registry';

const K = {
  slaveIds: 'slaveIds',
  baudRate: 'baudRate',
  dataBits: 'dataBits',
  stopBits: 'stopBits',
  parity: 'parity',
  pollIntervalMs: 'pollIntervalMs',
  slaveNames: 'slaveNames',
  slaveModels: 'slaveModels',
  slaveTypes: 'slaveTypes',
  slavePriorities: 'slavePriorities',
};

/** Parses the Flutter-style "id|value" string list. */
function parsePairs(raw: string | null): [number, string][] {
  if (!raw) return [];
  try {
    const list = JSON.parse(raw) as string[];
    const out: [number, string][] = [];
    for (const entry of list) {
      const parts = entry.split('|');
      if (parts.length === 2) {
        const id = parseInt(parts[0], 10);
        if (!isNaN(id)) out.push([id, parts[1]]);
      }
    }
    return out;
  } catch {
    return [];
  }
}

const encodePairs = (m: Map<number, string | number>) =>
  JSON.stringify([...m.entries()].map(([k, v]) => `${k}|${v}`));

export class ModbusRtu {
  static baudRate = 9600;
  static dataBits = 8;
  static parity = 0;
  static stopBits = 1;
  static pollIntervalMs = 300;
  static readonly functionCode = 3;

  static slaveIds: number[] = [];
  static slaveNames = new Map<number, string>();
  static slaveModelMap = new Map<number, string>(); // display only
  static slaveTypeMap = new Map<number, DeviceType>(); // routing
  static slavePriorityMap = new Map<number, number>();

  static async loadSettings() {
    const get = (k: string) => AsyncStorage.getItem(k);
    const num = async (k: string, d: number) => {
      const v = await get(k);
      const n = v === null ? NaN : parseInt(v, 10);
      return isNaN(n) ? d : n;
    };

    this.baudRate = await num(K.baudRate, this.baudRate);
    this.dataBits = await num(K.dataBits, this.dataBits);
    this.stopBits = await num(K.stopBits, this.stopBits);
    this.parity = await num(K.parity, this.parity);
    this.pollIntervalMs = await num(K.pollIntervalMs, this.pollIntervalMs);

    const idsRaw = await get(K.slaveIds);
    try {
      const list: string[] = idsRaw ? JSON.parse(idsRaw) : [];
      this.slaveIds = list.map((e) => parseInt(e, 10)).filter((v) => !isNaN(v) && v >= 1 && v <= 247);
    } catch {
      this.slaveIds = [];
    }

    this.slaveNames = new Map(parsePairs(await get(K.slaveNames)));
    this.slaveModelMap = new Map(parsePairs(await get(K.slaveModels)));

    this.slaveTypeMap = new Map();
    for (const [id, name] of parsePairs(await get(K.slaveTypes))) {
      this.slaveTypeMap.set(id, (DEVICE_TYPES as string[]).includes(name) ? (name as DeviceType) : 'fsa');
    }

    this.slavePriorityMap = new Map();
    for (const [id, p] of parsePairs(await get(K.slavePriorities))) {
      const n = parseInt(p, 10);
      if (!isNaN(n)) this.slavePriorityMap.set(id, n);
    }

    this.prunePriorities();
  }

  static async saveSettings() {
    this.prunePriorities();
    const entries: [string, string][] = [
      [K.baudRate, String(this.baudRate)],
      [K.dataBits, String(this.dataBits)],
      [K.stopBits, String(this.stopBits)],
      [K.parity, String(this.parity)],
      [K.pollIntervalMs, String(this.pollIntervalMs)],
      [K.slaveIds, JSON.stringify(this.slaveIds.map(String))],
      [K.slaveNames, encodePairs(this.slaveNames)],
      [K.slaveModels, encodePairs(this.slaveModelMap)],
      [K.slaveTypes, encodePairs(this.slaveTypeMap)],
      [K.slavePriorities, encodePairs(this.slavePriorityMap)],
    ];
    await Promise.all(entries.map(([k, v]) => AsyncStorage.setItem(k, v)));
  }

  static getModelForSlave(slaveId: number): DeviceModel {
    const type = this.slaveTypeMap.get(slaveId);
    return type ? getModelByType(type) : DeviceModels.fsa;
  }

  static getDisplayName(slaveId: number) {
    return this.slaveNames.get(slaveId) ?? `Slave ${slaveId}`;
  }

  static getModelName(slaveId: number) {
    return this.slaveModelMap.get(slaveId) ?? 'Unknown';
  }

  static registerSlaveDevice(slaveId: number, signature: DeviceSignature) {
    this.slaveModelMap.set(slaveId, signature.modelName);
    this.slaveTypeMap.set(slaveId, signature.type);
    if (!this.slaveIds.includes(slaveId)) this.slaveIds.push(slaveId);
  }

  static async setPriorityForSlave(slaveId: number, priority: number) {
    this.slavePriorityMap.set(slaveId, priority);
    await this.savePriorities();
  }

  static async clearPriorityForSlave(slaveId: number) {
    this.slavePriorityMap.delete(slaveId);
    await this.savePriorities();
  }

  private static async savePriorities() {
    await AsyncStorage.setItem(K.slavePriorities, encodePairs(this.slavePriorityMap));
  }

  private static prunePriorities() {
    for (const id of [...this.slavePriorityMap.keys()]) {
      if (!this.slaveIds.includes(id)) this.slavePriorityMap.delete(id);
    }
  }

  static priorityForSlave(slaveId: number): number | undefined {
    return this.slavePriorityMap.get(slaveId);
  }
}
