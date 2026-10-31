import { decodeFSARegisterValue } from '../devices/fsa';
import { decodeMLPRegisterValue } from '../devices/mlp';
import { PlacedSensor, SiteImageConfig } from '../services/configTypes';
import { ModbusRtu } from '../services/modbusRtu';
import { Rs485Service } from '../services/rs485Service';
import { C } from '../theme/palette';

export type PinLiveStatus = 'healthy' | 'fault' | 'fire' | 'recovered' | 'disabled' | 'offline' | 'unknown';

export const pinKey = (s: PlacedSensor) => `${s.slaveId}_${s.zoneAddress}`;

/**
 * `latched` = pins that were in FIRE when their device dropped off the bus.
 * Such a pin stays 'fire' while offline (a burnt-out / dead device must not
 * silence the alarm); it clears once the device is back and reports no fire.
 */
export function statusFor(manager: Rs485Service, sensor: PlacedSensor, latched?: ReadonlySet<string>): PinLiveStatus {
  if (manager.isSlaveOffline(sensor.slaveId)) return latched?.has(pinKey(sensor)) ? 'fire' : 'offline';

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
  latched?: ReadonlySet<string>,
): PlacedSensor | null {
  let best: PlacedSensor | null = null;
  for (const s of floor.sensors) {
    if (statusFor(manager, s, latched) !== 'fire') continue;
    if (!best || priorityRank(s) < priorityRank(best)) best = s;
  }
  return best;
}

/** Start time of a firing sensor; a sensor whose time is not recorded yet is the newest. */
const startOf = (startTimes: Map<string, number>, s: PlacedSensor) => startTimes.get(pinKey(s)) ?? Number.MAX_SAFE_INTEGER;

/**
 * Floors with an active fire.
 *  - Priority OFF: the floor whose alert came most recently is first (latest first).
 *  - Priority ON : highest-priority floor first, floors with no priority last;
 *                  ties are broken by the most recent alert.
 */
export function fireFloors(
  manager: Rs485Service,
  history: SiteImageConfig[],
  latched?: ReadonlySet<string>,
  startTimes: Map<string, number> = new Map(),
  usePriority = true,
): SiteImageConfig[] {
  const floors = history
    .map((f, i) => ({ f, i }))
    .filter(({ f }) => f.sensors.some((s) => statusFor(manager, s, latched) === 'fire'));

  const rankOf = (f: SiteImageConfig) => {
    const b = bestPrioritySensorForFloor(manager, f, latched);
    return b ? priorityRank(b) : 1 << 30;
  };
  const latestOf = (f: SiteImageConfig) => {
    let m = -1;
    for (const s of f.sensors) if (statusFor(manager, s, latched) === 'fire') m = Math.max(m, startOf(startTimes, s));
    return m;
  };

  floors.sort((a, b) => {
    if (usePriority) {
      const r = rankOf(a.f) - rankOf(b.f);
      if (r !== 0) return r;
    }
    const l = latestOf(b.f) - latestOf(a.f);   // newest alert first
    return l || a.i - b.i;
  });
  return floors.map((x) => x.f);
}

/**
 * Firing sensors on a floor.
 *  - Priority OFF: latest alert first.
 *  - Priority ON : priority first (no priority last), then latest alert first.
 */
export function firingSensorsForFloor(
  manager: Rs485Service,
  floor: SiteImageConfig,
  startTimes: Map<string, number>,
  latched?: ReadonlySet<string>,
  usePriority = true,
): PlacedSensor[] {
  const firing = floor.sensors.filter((s) => statusFor(manager, s, latched) === 'fire');
  firing.sort((a, b) => {
    if (usePriority) {
      const r = priorityRank(a) - priorityRank(b);
      if (r !== 0) return r;
    }
    return startOf(startTimes, b) - startOf(startTimes, a);
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