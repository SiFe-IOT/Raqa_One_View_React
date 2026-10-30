import { decodeFSARegisterValue } from '../devices/fsa';
import { decodeMLPRegisterValue } from '../devices/mlp';
import { PlacedSensor, SiteImageConfig } from '../services/configTypes';
import { ModbusRtu } from '../services/modbusRtu';
import { Rs485Service } from '../services/rs485Service';
import { C } from '../theme/palette';

export type PinLiveStatus = 'healthy' | 'fault' | 'fire' | 'recovered' | 'disabled' | 'offline' | 'unknown';

export const pinKey = (s: PlacedSensor) => `${s.slaveId}_${s.zoneAddress}`;

export function statusFor(manager: Rs485Service, sensor: PlacedSensor): PinLiveStatus {
  if (manager.isSlaveOffline(sensor.slaveId)) return 'offline';

  const index = sensor.slaveId - 1;
  if (index < 0 || index >= manager.slaveRegistersNotifier.length) return 'unknown';

  const reg = manager.slaveRegistersNotifier[index].value.find((r) => r.address === sensor.zoneAddress);
  if (reg?.value === undefined) return 'unknown';

  const type = ModbusRtu.slaveTypeMap.get(sensor.slaveId) ?? 'fsa';
  const decoded =
    type === 'fsa'
      ? decodeFSARegisterValue(sensor.zoneAddress, reg.value)
      : decodeMLPRegisterValue(sensor.zoneAddress, reg.value);

  switch (decoded.toLowerCase()) {
    case 'healthy': return 'healthy';
    case 'fault': return 'fault';
    case 'fire': return 'fire';
    case 'recovered': return 'recovered';
    case 'disable': return 'disabled';
    default: return 'unknown';
  }
}

export function colorForStatus(s: PinLiveStatus): string {
  switch (s) {
    case 'healthy': return C.green;
    case 'fault': return C.orange;
    case 'fire': return C.red;
    case 'recovered': return C.blueGrey;
    case 'offline': return '#616161';
    default: return C.grey;
  }
}

/** Lower number = higher priority; no priority = lowest. */
export const priorityRank = (s: PlacedSensor) => ModbusRtu.priorityForSlave(s.slaveId) ?? 1 << 30;

export function bestPrioritySensorForFloor(
  manager: Rs485Service,
  floor: SiteImageConfig,
): PlacedSensor | null {
  let best: PlacedSensor | null = null;
  for (const s of floor.sensors) {
    if (statusFor(manager, s) !== 'fire') continue;
    if (!best || priorityRank(s) < priorityRank(best)) best = s;
  }
  return best;
}

/** Floors with an active fire, highest-priority first; stable by original index. */
export function fireFloors(manager: Rs485Service, history: SiteImageConfig[]): SiteImageConfig[] {
  const floors = history
    .map((f, i) => ({ f, i }))
    .filter(({ f }) => f.sensors.some((s) => statusFor(manager, s) === 'fire'));

  const rankOf = (f: SiteImageConfig) => {
    const b = bestPrioritySensorForFloor(manager, f);
    return b ? priorityRank(b) : 1 << 30;
  };

  floors.sort((a, b) => rankOf(a.f) - rankOf(b.f) || a.i - b.i);
  return floors.map((x) => x.f);
}

/** Firing sensors on a floor: priority first, then earliest start time. */
export function firingSensorsForFloor(
  manager: Rs485Service,
  floor: SiteImageConfig,
  startTimes: Map<string, number>,
): PlacedSensor[] {
  const firing = floor.sensors.filter((s) => statusFor(manager, s) === 'fire');
  firing.sort((a, b) => {
    const r = priorityRank(a) - priorityRank(b);
    if (r !== 0) return r;
    const sa = startTimes.get(pinKey(a));
    const sb = startTimes.get(pinKey(b));
    if (sa === undefined && sb === undefined) return 0;
    if (sa === undefined) return 1;
    if (sb === undefined) return -1;
    return sa - sb;
  });
  return firing;
}

export function formatElapsed(startMs: number | undefined, nowMs: number): string {
  if (startMs === undefined) return '-';
  const secs = Math.max(0, Math.floor((nowMs - startMs) / 1000));
  if (secs < 60) return `${secs}sec`;
  const mins = Math.floor(secs / 60);
  if (mins < 60) return `${mins}min`;
  return `${Math.floor(mins / 60)}hrs`;
}
