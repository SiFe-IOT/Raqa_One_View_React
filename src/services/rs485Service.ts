import { RegisterData } from '../devices/types';
import { ModbusRtu } from './modbusRtu';
import { AppSettings } from './appSettings';
import { Signal, ValueNotifier } from './observable';
import { SerialTransport, listUsbDeviceIds, openFirstAvailable } from './serialTransport';

const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

export function crc16(bytes: number[]): number {
  let crc = 0xffff;
  for (const b of bytes) {
    crc ^= b;
    for (let i = 0; i < 8; i++) crc = crc & 1 ? (crc >> 1) ^ 0xa001 : crc >> 1;
  }
  return crc;
}

export class Rs485Service {
  port: SerialTransport | null = null;
  private buffer: number[] = [];
  private pollTimer: ReturnType<typeof setInterval> | null = null;
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private requestTimeoutTimer: ReturnType<typeof setTimeout> | null = null;
  private presenceTimer: ReturnType<typeof setInterval> | null = null;
  private disposed = false;

  /** One notifier per slave ID 1..31 (index = slaveId - 1). */
  readonly slaveRegistersNotifier: ValueNotifier<RegisterData[]>[] = Array.from(
    { length: 31 },
    () => new ValueNotifier<RegisterData[]>([]),
  );

  slavePollingIndex = 0;
  isManualScanRunning = false;
  private requestRunning = false;

  private pendingScan: { slaveId: number; resolve: (v: number[] | null) => void } | null = null;

  connectionStatus = 'Disconnected';
  reconnectAttempts = 0;

  readonly slaveLastSeen = new Map<number, number>();
  static readonly offlineThresholdMs = 60_000;

  /** Subscribe with useObservable(manager.changes) to re-render on any state change. */
  readonly changes = new Signal();
  private onStateChanged: () => void;

  constructor(onStateChanged: () => void = () => {}) {
    this.onStateChanged = () => {
      onStateChanged();
      this.scheduleBump();
    };
  }

  private bumpTimer: ReturnType<typeof setTimeout> | null = null;
  /** Coalesce bursts of poll responses into at most ~4 UI refreshes per second. */
  private scheduleBump() {
    if (this.bumpTimer) return;
    this.bumpTimer = setTimeout(() => {
      this.bumpTimer = null;
      this.changes.bump();
    }, 250);
  }

  isSlaveOffline(slaveId: number): boolean {
    const seen = this.slaveLastSeen.get(slaveId);
    return seen === undefined || Date.now() - seen > Rs485Service.offlineThresholdMs;
  }

  ////////////////////////////////////////////////////////////
  // INIT
  ////////////////////////////////////////////////////////////

  async init() {
    await ModbusRtu.loadSettings();
    await AppSettings.loadSettings();
    await this.scanAndConnectUSB();
  }

  refreshSlaves() {
    this.clearPollTimer();
    this.slavePollingIndex = 0;
    this.requestRunning = false;
    this.buffer = [];
    this.restartPolling();
    this.onStateChanged();
  }

  async applyNewSlaveConfiguration() {
    this.refreshSlaves();
  }

  ////////////////////////////////////////////////////////////
  // CONNECT
  ////////////////////////////////////////////////////////////

  async scanAndConnectUSB() {
    if (this.disposed) return;
    try {
      const transport = await openFirstAvailable({
        baudRate: ModbusRtu.baudRate,
        dataBits: ModbusRtu.dataBits,
        stopBits: ModbusRtu.stopBits,
        parity: ModbusRtu.parity,
      });

      if (!transport) {
        this.scheduleReconnect();
        return;
      }

      // Many USB<->RS485 adapters drop the first writes right after open().
      await sleep(300);

      this.port = transport;
      transport.onData((bytes) => this.onDataReceived(bytes));

      this.reconnectAttempts = 0;
      this.connectionStatus = 'Connected';
      this.onStateChanged();
      this.restartPolling();
      this.startPresenceWatch(transport.deviceId);
    } catch {
      this.scheduleReconnect();
    }
  }

  /**
   * The native lib has no reliable detach event across versions, so while
   * connected we check every 2s that the adapter is still attached.
   * (Replaces Flutter's UsbSerial.usbEventStream ATTACHED/DETACHED events.)
   */
  private startPresenceWatch(deviceId: number) {
    if (this.presenceTimer) clearInterval(this.presenceTimer);
    this.presenceTimer = setInterval(async () => {
      try {
        const ids = await listUsbDeviceIds();
        if (!ids.includes(deviceId)) await this.handleDisconnect();
      } catch {}
    }, 2000);
  }

  private async handleDisconnect() {
    await this.closePort();
    this.scheduleReconnect();
  }

  private scheduleReconnect() {
    if (this.disposed) return;
    if (this.reconnectTimer) clearTimeout(this.reconnectTimer);
    this.reconnectAttempts++;
    const secs = Math.min(10, Math.max(1, this.reconnectAttempts));
    this.reconnectTimer = setTimeout(() => this.scanAndConnectUSB(), secs * 1000);
  }

  private async closePort() {
    if (this.presenceTimer) { clearInterval(this.presenceTimer); this.presenceTimer = null; }
    const p = this.port;
    this.port = null;
    await p?.close();

    this.clearPollTimer();
    if (this.requestTimeoutTimer) clearTimeout(this.requestTimeoutTimer);

    this.buffer = [];
    this.requestRunning = false;
    this.pendingScan = null;

    this.connectionStatus = 'Disconnected';
    this.onStateChanged();
  }

  ////////////////////////////////////////////////////////////
  // POLLING
  ////////////////////////////////////////////////////////////

  private clearPollTimer() {
    if (this.pollTimer) { clearInterval(this.pollTimer); this.pollTimer = null; }
  }

  private restartPolling() {
    this.clearPollTimer();
    if (!this.port || ModbusRtu.slaveIds.length === 0 || this.isManualScanRunning) return;

    this.pollTimer = setInterval(async () => {
      if (this.requestRunning || !this.port) return;
      if (ModbusRtu.slaveIds.length === 0) return;

      if (this.slavePollingIndex >= ModbusRtu.slaveIds.length) this.slavePollingIndex = 0;

      const slaveId = ModbusRtu.slaveIds[this.slavePollingIndex];
      const model = ModbusRtu.getModelForSlave(slaveId);

      await this.sendReadRequest(slaveId, model.startAddress, model.quantity);

      if (ModbusRtu.slaveIds.length === 0) return;
      this.slavePollingIndex = (this.slavePollingIndex + 1) % ModbusRtu.slaveIds.length;
    }, ModbusRtu.pollIntervalMs);
  }

  ////////////////////////////////////////////////////////////
  // SCAN MODE
  ////////////////////////////////////////////////////////////

  async readRegistersForScan(opts: {
    slaveId: number;
    startAddress: number;
    quantity: number;
    attempts?: number;
    timeoutMs?: number;
  }): Promise<number[] | null> {
    const { slaveId, startAddress, quantity, attempts = 2, timeoutMs = 1200 } = opts;
    if (!this.port) return null;

    this.requestRunning = false;
    this.buffer = [];
    this.pendingScan = null;
    if (this.requestTimeoutTimer) clearTimeout(this.requestTimeoutTimer);

    let result: number[] | null = null;

    for (let i = 0; i < attempts; i++) {
      const wait = new Promise<number[] | null>((resolve) => {
        this.pendingScan = { slaveId, resolve };
        setTimeout(() => resolve(null), timeoutMs);
      });

      await sleep(100);
      await this.sendReadRequest(slaveId, startAddress, quantity);

      result = await wait;
      this.pendingScan = null;
      if (result) break;
    }
    return result;
  }

  async beginManualScan() {
    this.isManualScanRunning = true;
    this.clearPollTimer();

    // Wait for any in-flight poll request to resolve/time out first.
    const maxWait = 1600;
    let waited = 0;
    while (this.requestRunning && waited < maxWait) {
      await sleep(50);
      waited += 50;
    }

    if (this.requestTimeoutTimer) clearTimeout(this.requestTimeoutTimer);
    this.requestRunning = false;
    this.buffer = [];
    this.pendingScan = null;

    await sleep(200);
    this.buffer = [];
    this.requestRunning = false;
  }

  endManualScan() {
    this.isManualScanRunning = false;
    this.restartPolling();
  }

  ////////////////////////////////////////////////////////////
  // SEND
  ////////////////////////////////////////////////////////////

  private async sendReadRequest(slaveId: number, startAddress: number, quantity: number) {
    if (!this.port || this.requestRunning) return;
    this.requestRunning = true;

    if (this.requestTimeoutTimer) clearTimeout(this.requestTimeoutTimer);
    this.requestTimeoutTimer = setTimeout(() => {
      this.requestRunning = false;
      this.buffer = []; // drop stale partial bytes so next response isn't misaligned
    }, 1500);

    const frame = [
      slaveId,
      ModbusRtu.functionCode,
      (startAddress >> 8) & 0xff,
      startAddress & 0xff,
      (quantity >> 8) & 0xff,
      quantity & 0xff,
    ];
    const crc = crc16(frame);
    frame.push(crc & 0xff, (crc >> 8) & 0xff);

    try {
      await this.port.write(frame);
    } catch {
      this.requestRunning = false;
      this.handleDisconnect();
    }
  }

  ////////////////////////////////////////////////////////////
  // RECEIVE
  ////////////////////////////////////////////////////////////

  private onDataReceived(data: number[]) {
    if (data.length === 0) return;
    this.buffer.push(...data);

    for (;;) {
      const bytes = this.buffer;
      if (bytes.length < 5) return;

      const byteCount = bytes[2];
      const frameLength = 3 + byteCount + 2;
      if (bytes.length < frameLength) return;

      const frame = bytes.slice(0, frameLength);
      const body = frame.slice(0, frameLength - 2);

      const crcRx = frame[frameLength - 2] | (frame[frameLength - 1] << 8);
      if (crc16(body) !== crcRx) {
        // Misaligned: drop one byte and re-sync rather than wiping everything.
        this.buffer = bytes.slice(1);
        continue;
      }

      const slaveId = frame[0];
      const payload = frame.slice(3, 3 + byteCount);
      const values: number[] = [];
      for (let i = 0; i + 1 < payload.length; i += 2) values.push((payload[i] << 8) | payload[i + 1]);

      this.buffer = bytes.slice(frameLength);
      this.requestRunning = false;
      if (this.requestTimeoutTimer) clearTimeout(this.requestTimeoutTimer);

      if (this.pendingScan) {
        if (slaveId === this.pendingScan.slaveId) this.pendingScan.resolve(values);
        return;
      }

      const model = ModbusRtu.getModelForSlave(slaveId);
      const registers: RegisterData[] = values.map((v, i) => ({ address: model.startAddress + i, value: v }));

      const wasOffline = this.isSlaveOffline(slaveId);
      let changed = wasOffline;
      const idx = slaveId - 1;
      if (idx >= 0 && idx < this.slaveRegistersNotifier.length) {
        const prev = this.slaveRegistersNotifier[idx].value;
        const same = prev.length === registers.length && prev.every((r, i) => r.value === registers[i].value && r.address === registers[i].address);
        if (!same) { this.slaveRegistersNotifier[idx].value = registers; changed = true; }
      }
      this.slaveLastSeen.set(slaveId, Date.now());
      // Identical data from an already-online slave needs no UI refresh.
      if (changed) this.onStateChanged();
    }
  }

  async dispose() {
    this.disposed = true;
    if (this.bumpTimer) clearTimeout(this.bumpTimer);
    if (this.reconnectTimer) clearTimeout(this.reconnectTimer);
    await this.closePort();
  }
}
