import AsyncStorage from '@react-native-async-storage/async-storage';
import { Observable } from './observable';
import { PlacedSensor, SensorType, SiteImageConfig } from './configTypes';

const K_HISTORY = 'configHistoryV1';
const K_ACTIVE = 'configActiveIndexV1';

class ConfigurationStoreImpl extends Observable {
  history: SiteImageConfig[] = [];
  activeIndex = -1;

  get active(): SiteImageConfig | null {
    return this.activeIndex >= 0 && this.activeIndex < this.history.length
      ? this.history[this.activeIndex]
      : null;
  }

  async loadFromDisk() {
    const raw = await AsyncStorage.getItem(K_HISTORY);
    const idx = await AsyncStorage.getItem(K_ACTIVE);

    this.history = [];
    this.activeIndex = idx !== null && !isNaN(parseInt(idx, 10)) ? parseInt(idx, 10) : -1;

    if (raw) {
      try {
        const decoded = JSON.parse(raw) as any[];
        this.history = decoded.map((e) => this.configFromJson(e));
      } catch {
        this.history = [];
        this.activeIndex = -1;
      }
    }

    if (this.activeIndex < -1 || this.activeIndex >= this.history.length) {
      this.activeIndex = this.history.length === 0 ? -1 : this.history.length - 1;
    }
    this.notify();
  }

  private async persist() {
    const encoded = JSON.stringify(
      this.history.map((c) => ({ ...c, loadedAt: c.loadedAt.toISOString() })),
    );
    await Promise.all([
      AsyncStorage.setItem(K_HISTORY, encoded),
      AsyncStorage.setItem(K_ACTIVE, String(this.activeIndex)),
    ]);
  }

  private configFromJson(j: any): SiteImageConfig {
    const loaded = new Date(j.loadedAt);
    return {
      id: j.id?.toString() ?? String(Date.now() * 1000),
      imagePath: j.imagePath?.toString() ?? '',
      loadedAt: isNaN(loaded.getTime()) ? new Date() : loaded,
      floorLabel: j.floorLabel?.toString() ?? 'Floor',
      sensors: ((j.sensors as any[]) ?? []).map((s) => this.sensorFromJson(s)),
    };
  }

  private sensorFromJson(j: any): PlacedSensor {
    return {
      slaveId: Number(j.slaveId ?? 0),
      zoneAddress: Number(j.zoneAddress ?? 0),
      zoneLabel: j.zoneLabel?.toString() ?? '',
      type: (j.type === 'temperature' ? 'temperature' : 'fire') as SensorType,
      name: j.name?.toString() ?? 'Sensor',
      location: j.location?.toString() ?? '',
      notes: j.notes?.toString() ?? '',
      xFraction: Number(j.xFraction ?? 0),
      yFraction: Number(j.yFraction ?? 0),
    };
  }

  addImage(path: string) {
    this.history.push({
      id: String(Date.now() * 1000 + Math.floor(Math.random() * 1000)),
      imagePath: path,
      loadedAt: new Date(),
      floorLabel: `Floor ${this.history.length + 1}`,
      sensors: [],
    });
    this.activeIndex = this.history.length - 1;
    this.notify();
    this.persist();
  }

  setActive(id: string) {
    const i = this.history.findIndex((c) => c.id === id);
    if (i === -1) return;
    this.activeIndex = i;
    this.notify();
    this.persist();
  }

  renameFloor(id: string, label: string) {
    const t = label.trim();
    if (!t) return;
    const c = this.history.find((h) => h.id === id);
    if (!c) return;
    c.floorLabel = t;
    this.notify();
    this.persist();
  }

  /**
   * Removes an image from history together with every sensor pin placed on
   * it. The image file itself is NOT deleted. Keeps activeIndex sensible
   * afterwards; becomes -1 when the history is empty.
   */
  removeImage(id: string) {
    const index = this.history.findIndex((c) => c.id === id);
    if (index === -1) return;
    this.history.splice(index, 1);
    if (this.history.length === 0) this.activeIndex = -1;
    else if (index < this.activeIndex) this.activeIndex -= 1;
    else if (index === this.activeIndex) {
      this.activeIndex = index >= this.history.length ? this.history.length - 1 : index;
    }
    this.notify();
    this.persist();
  }

  sensorForZone(slaveId: number, zoneAddress: number): PlacedSensor | null {
    return this.active?.sensors.find((s) => s.slaveId === slaveId && s.zoneAddress === zoneAddress) ?? null;
  }

  sensorsForSlave(slaveId: number): PlacedSensor[] {
    return this.active?.sensors.filter((s) => s.slaveId === slaveId) ?? [];
  }

  addOrUpdateSensor(sensor: PlacedSensor) {
    const cfg = this.active;
    if (!cfg) return;
    const i = cfg.sensors.findIndex((s) => s.slaveId === sensor.slaveId && s.zoneAddress === sensor.zoneAddress);
    if (i >= 0) cfg.sensors[i] = sensor;
    else cfg.sensors.push(sensor);
    this.notify();
    this.persist();
  }

  removeSensor(slaveId: number, zoneAddress: number) {
    const cfg = this.active;
    if (!cfg) return;
    cfg.sensors = cfg.sensors.filter((s) => !(s.slaveId === slaveId && s.zoneAddress === zoneAddress));
    this.notify();
    this.persist();
  }
}

export const ConfigurationStore = new ConfigurationStoreImpl();
