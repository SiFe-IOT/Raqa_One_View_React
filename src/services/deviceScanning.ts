import { DeviceSignature } from '../devices/types';
import { SupportedDevices } from '../devices/registry';
import { ModbusRtu } from './modbusRtu';
import { Rs485Service } from './rs485Service';

const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

export type ScanProgressCallback = (currentSlave: number, totalSlaves: number) => void;

export class DeviceScanning {
  /** Slaves that answered during the last scan but are not a supported model. */
  lastUnknownCount = 0;

  constructor(private manager: Rs485Service) {}

  async scanSlaves(opts: {
    startSlaveId?: number;
    endSlaveId?: number;
    retries?: number;
    retryDelayMs?: number;
    responseTimeoutMs?: number;
    startAddress?: number;
    quantity?: number;
    onProgress?: ScanProgressCallback;
  } = {}): Promise<Map<number, DeviceSignature>> {
    const {
      startSlaveId = 1,
      endSlaveId = 31,
      retries = 0,
      retryDelayMs = 250,
      responseTimeoutMs = 800,
      startAddress = 0,
      quantity = 3,
      onProgress,
    } = opts;

    const detected = new Map<number, DeviceSignature>();
    this.lastUnknownCount = 0;

    if (!this.manager.port) {
      console.log('RS485 not connected. Scan aborted.');
      return detected;
    }

    // Remember the current configuration; if nothing is found (bus unplugged,
    // wrong baud rate, ...) it is restored instead of being wiped and saved empty.
    const previousIds = [...ModbusRtu.slaveIds];
    const previousModels = new Map(ModbusRtu.slaveModelMap);
    const previousTypes = new Map(ModbusRtu.slaveTypeMap);

    ModbusRtu.slaveIds = [];
    ModbusRtu.slaveModelMap.clear();
    ModbusRtu.slaveTypeMap.clear();

    // Pause background polling for the whole scan, not per slave.
    await this.manager.beginManualScan();

    try {
      const total = endSlaveId - startSlaveId + 1;
      let progress = 0;

      for (let slaveId = startSlaveId; slaveId <= endSlaveId; slaveId++) {
        progress++;
        onProgress?.(progress, total);

        for (let attempt = 1; attempt <= retries + 1; attempt++) {
          try {
            const values = await this.manager.readRegistersForScan({
              slaveId, startAddress, quantity, attempts: 1, timeoutMs: responseTimeoutMs,
            });

            if (!values || values.length < 3) {
              await sleep(retryDelayMs);
              continue;
            }

            const match = SupportedDevices.find(values[1], values[2]);
            if (!match) { this.lastUnknownCount++; break; } // unknown device

            ModbusRtu.registerSlaveDevice(slaveId, match);
            detected.set(slaveId, match);
            break;
          } catch (e) {
            console.log(`Scan error Slave ${slaveId}:`, e);
            await sleep(retryDelayMs);
          }
        }
      }

      if (detected.size === 0) {
        ModbusRtu.slaveIds = previousIds;
        ModbusRtu.slaveModelMap = previousModels;
        ModbusRtu.slaveTypeMap = previousTypes;
      } else {
        await ModbusRtu.saveSettings();
      }
    } finally {
      this.manager.endManualScan();
    }

    return detected;
  }
}
