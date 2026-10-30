// Thin adapter over react-native-usb-serialport-for-android so the rest of
// the app never touches the native library directly. If you swap the USB
// library, this is the only file to change.
//
// That library exchanges data as HEX strings, so we convert at the edge.
import { UsbSerialManager, Parity, UsbSerialport } from 'react-native-usb-serialport-for-android';

export interface SerialTransport {
  write(bytes: number[]): Promise<void>;
  onData(cb: (bytes: number[]) => void): void;
  close(): Promise<void>;
  readonly deviceId: number;
}

const toHex = (bytes: number[]) => bytes.map((b) => b.toString(16).padStart(2, '0')).join('');

const fromHex = (hex: string): number[] => {
  const out: number[] = [];
  for (let i = 0; i + 1 < hex.length; i += 2) out.push(parseInt(hex.substr(i, 2), 16));
  return out;
};

const parityMap = [Parity.None, Parity.Odd, Parity.Even];

class UsbTransport implements SerialTransport {
  private sub?: { remove: () => void };
  constructor(private port: UsbSerialport, readonly deviceId: number) {}

  async write(bytes: number[]) {
    await this.port.send(toHex(bytes));
  }

  onData(cb: (bytes: number[]) => void) {
    this.sub = this.port.onReceived((e: { data: string }) => cb(fromHex(e.data)));
  }

  async close() {
    try { this.sub?.remove(); } catch {}
    try { await this.port.close(); } catch {}
  }
}

export interface PortParams {
  baudRate: number;
  dataBits: number;
  stopBits: number;
  parity: number; // 0 none, 1 odd, 2 even
}

export async function listUsbDeviceIds(): Promise<number[]> {
  const devices = await UsbSerialManager.list();
  return devices.map((d: { deviceId: number }) => d.deviceId);
}

/** Tries each attached USB device; returns the first one that opens. */
export async function openFirstAvailable(params: PortParams): Promise<SerialTransport | null> {
  const ids = await listUsbDeviceIds();
  for (const id of ids) {
    try {
      const granted = await UsbSerialManager.tryRequestPermission(id);
      if (!granted) continue;
      const port = await UsbSerialManager.open(id, {
        baudRate: params.baudRate,
        dataBits: params.dataBits,
        stopBits: params.stopBits,
        parity: parityMap[params.parity] ?? Parity.None,
      });
      return new UsbTransport(port, id);
    } catch {
      // try next device
    }
  }
  return null;
}
