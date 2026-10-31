import React, { useCallback, useEffect, useRef, useState } from 'react';
import { BackHandler, FlatList, Image, Pressable, findNodeHandle, ScrollView, StyleSheet, Text, View, LayoutChangeEvent, StyleProp, ViewStyle } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useIsFocused, useNavigation } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import Sound from 'react-native-sound';
import { Icon } from '../components/Icon';
import { FireRipple } from '../components/FireRipple';
import { SvgFill, SvgSpinner, useSvg } from '../components/SvgFloorPlan';
import { FitBox } from '../components/FitBox';
import { useRs485 } from '../services/RsContext';
import { Rs485Service } from '../services/rs485Service';
import { ConfigurationStore } from '../services/configurationStore';
import { PlacedSensor, SensorTypeUi, SiteImageConfig, zonesForDeviceType } from '../services/configTypes';
import { ModbusRtu } from '../services/modbusRtu';
import { AppSettings, useAppSettings } from '../services/appSettings';
import { useObservable } from '../services/observable';
import { AppTheme } from '../theme/appTheme';
import { useRemoteKeys } from '../hooks/useRemoteKeys';
import { C } from '../theme/palette';
import type { RootStackParamList } from '../navigation';
import {
  colorForStatus, fireFloors as computeFireFloors, firingSensorsForFloor, formatElapsed, pinKey, statusFor,
} from './dashboardLogic';

const FIRE_BG = '#200404';
const FIRE_TEXT = '#FFFFFF';
const FIRE_TEXT2 = 'rgba(255,255,255,0.72)';
const PANEL_WIDTH = 160;       // width of the left side panel
const RIGHT_PANEL_WIDTH = 205; // width of the right side panel (change this to resize it)
const SCAN_MAX_SLAVES = 31;  // scan range is slave IDs 1..31 (see DeviceScanning)
const two = (n: number) => String(n).padStart(2, '0');
const overlay = (o: number) => (AppSettings.darkModeEnabled ? `rgba(255,255,255,${o})` : `rgba(0,0,0,${o})`);

type NavProps = {
  nextFocusUp?: number;
  nextFocusDown?: number;
  nextFocusLeft?: number;
  nextFocusRight?: number;
};

/** Returns [callbackRef, nativeHandle] so one control can point D-pad focus at another. */
function useNodeHandle(): [(n: any) => void, number | undefined] {
  const [h, setH] = useState<number | undefined>(undefined);
  const set = useCallback((n: any) => {
    const v = n ? findNodeHandle(n) : null;
    if (v) setH(v);
  }, []);
  return [set, h];
}

const handleOf = (n: any): number | undefined => (n ? findNodeHandle(n) ?? undefined : undefined);

/** Local TV-friendly pressable, avoiding a dependency on a missing component module. */
const FocusPressable = React.forwardRef<any, {
  children: React.ReactNode | ((focused: boolean) => React.ReactNode);
  style?: StyleProp<ViewStyle>;
  onPress?: () => void;
  onFocus?: () => void;
  onBlur?: () => void;
  focusable?: boolean;
  hasTVPreferredFocus?: boolean;
  radius?: number;
  scale?: number;
  accent?: string;
  focusFill?: string;
  /** Keep Left/Right on this control so focus can't wander off the panel it lives in. */
  trapHorizontal?: boolean;
} & NavProps>(function FocusPressable({
  children,
  style,
  onPress,
  onFocus,
  onBlur,
  focusable = true,
  hasTVPreferredFocus,
  radius = 8,
  scale = 1,
  accent = AppTheme.focusAccent,
  focusFill,
  trapHorizontal,
  nextFocusUp,
  nextFocusDown,
  nextFocusLeft,
  nextFocusRight,
}, ref) {
  const [focused, setFocused] = useState(false);
  const inner = useRef<any>(null);
  const [self, setSelf] = useState<number | undefined>(undefined);
  const setRefs = useCallback((n: any) => {
    inner.current = n;
    if (typeof ref === 'function') ref(n);
    else if (ref) (ref as React.MutableRefObject<any>).current = n;
  }, [ref]);
  useEffect(() => {
    if (!trapHorizontal) return;
    const h = findNodeHandle(inner.current);
    if (h) setSelf(h);
  }, [trapHorizontal]);
  return (
    <Pressable
      ref={setRefs}
      focusable={focusable}
      hasTVPreferredFocus={hasTVPreferredFocus}
      nextFocusUp={nextFocusUp}
      nextFocusDown={nextFocusDown}
      nextFocusLeft={trapHorizontal ? self : nextFocusLeft}
      nextFocusRight={trapHorizontal ? self : nextFocusRight}
      onPress={onPress}
      onFocus={() => { setFocused(true); onFocus?.(); }}
      onBlur={() => { setFocused(false); onBlur?.(); }}
      style={[
        style,
        focused && {
          borderRadius: radius,
          borderColor: accent,
          borderWidth: 2,
          backgroundColor: focusFill,
          transform: [{ scale }],
        },
      ]}
    >
      {typeof children === 'function' ? children(focused) : children}
    </Pressable>
  );
});

Sound.setCategory('Playback');

export function DashboardScreen() {
  useAppSettings();
  useObservable(ConfigurationStore);
  const manager = useRs485();
  useObservable(manager.changes);
  const navigation = useNavigation<NativeStackNavigationProp<RootStackParamList>>();
  const screenFocused = useIsFocused();
  const store = ConfigurationStore;
  const history = store.history;

  const [selectedFloorIndex, setSelectedFloorIndex] = useState(0);
  const [selectedAlertFloorIndex, setSelectedAlertFloorIndex] = useState(0);
  const [selectedKey, setSelectedKey] = useState<string | null>(null);
  const [now, setNow] = useState(Date.now());
  const [muted, setMuted] = useState(false);

  const fireStartTimes = useRef(new Map<string, number>()).current;

  // ---------- D-pad focus map ----------
  // Focus only ever lands on: siren, menu, floor tabs, floor-device rows (and the
  // alert footer during a fire). The pins on the floor image are NOT focusable.
  //   Siren <-> Menu (Left/Right)      Down  -> selected floor tab (footer in alert)
  //   first floor tab  Up -> Siren/Menu
  //   floor tab Down -> device list    first device Up -> selected floor tab
  const [sirenRef, sirenH] = useNodeHandle();
  const [menuRef, menuH] = useNodeHandle();
  const anyFireRef = useRef(false);
  const fireFloorRefs = useRef<Record<number, any>>({});
  const firstAlertRef = useRef<any>(null);
  const floorTabRefs = useRef<Record<number, any>>({});
  const firstDeviceRef = useRef<any>(null);
  const [, bumpNav] = useState(0);
  useEffect(() => { const t = setTimeout(() => bumpNav(1), 120); return () => clearTimeout(t); }, []);

  // ---------- remote access ----------
  // Dashboard is the launch screen, so Back would exit the app and the menu
  // button would be unreachable. Back / Menu on the remote opens the menu.
  useEffect(() => {
    const sub = BackHandler.addEventListener('hardwareBackPress', () => {
      if (!navigation.isFocused()) return false;
      if (anyFireRef.current) return true;   // fire alert: menu is locked, Back does nothing
      navigation.navigate('Home');
      return true;
    });
    return () => sub.remove();
  }, [navigation]);

  // ---------- derived ----------
  const floorIndex = Math.min(selectedFloorIndex, Math.max(0, history.length - 1));
  const currentFloor: SiteImageConfig | null = history[floorIndex] ?? null;

  const selectedTabH = handleOf(floorTabRefs.current[floorIndex]);
  const firstDeviceH = handleOf(firstDeviceRef.current);
  const topBarTarget = AppSettings.sirenEnabled ? sirenH : menuH;
  const alertTopTarget = AppSettings.sirenEnabled ? sirenH : undefined; // menu button is hidden during a fire

  // Fire latch: a pin that was in fire stays in fire if its device then goes offline.
  // Cleared only when the device is back online and no longer reports fire.
  const fireLatch = useRef(new Set<string>()).current;
  {
    const present = new Set<string>();
    for (const f of history)
      for (const sn of f.sensors) {
        const k = pinKey(sn);
        present.add(k);
        const raw = statusFor(manager, sn);       // raw (un-latched) status
        if (raw === 'fire') fireLatch.add(k);
        else if (raw !== 'offline' && raw !== 'unknown') fireLatch.delete(k);  // only a definite non-fire reading releases it
      }
    for (const k of [...fireLatch]) if (!present.has(k)) fireLatch.delete(k);
  }
  const latchSig = [...fireLatch].sort().join(',');
  const st = (sn: PlacedSensor) => statusFor(manager, sn, fireLatch);

  const anyFire = history.some((f) => f.sensors.some((sn) => st(sn) === 'fire'));
  anyFireRef.current = anyFire;

  // ---------- 1s tick: clock, buzzer, fire start times ----------
  // While another screen is on top there is nothing to repaint, so tick slowly
  // (the siren / fire timers still need `now` to notice slaves going offline).
  useEffect(() => {
    setNow(Date.now());
    const t = setInterval(() => setNow(Date.now()), screenFocused ? 1000 : 5000);
    return () => clearInterval(t);
  }, [screenFocused]);

  useEffect(() => {
    const live = new Set<string>();
    let newFire = false;
    for (const f of store.history)
      for (const s of f.sensors)
        if (statusFor(manager, s, fireLatch) === 'fire') {
          const k = pinKey(s);
          live.add(k);
          if (!fireStartTimes.has(k)) { fireStartTimes.set(k, Date.now()); newFire = true; }
        }
    for (const k of [...fireStartTimes.keys()]) if (!live.has(k)) fireStartTimes.delete(k);
    // A NEW fire (a sensor that was not already in alert) always un-mutes the siren,
    // even if the operator muted an earlier alarm that is still active.
    if (newFire) setMuted(false);
  }, [now, manager, store, fireStartTimes, fireLatch]);

  // ---------- buzzer ----------
  const soundRef = useRef<any>(null);
  const buzzing = useRef(false);

  useEffect(() => {
    const s = new Sound('fire_alarm.mp3', Sound.MAIN_BUNDLE, (err: unknown) => {
      if (err) console.warn('Could not load buzzer:', err);
    });
    s.setNumberOfLoops(-1);
    soundRef.current = s;
    return () => { s.stop(); s.release(); };
  }, []);

  useEffect(() => {
    const shouldBuzz = anyFire && !muted && AppSettings.sirenEnabled;
    const s = soundRef.current;
    if (!s) return;
    if (shouldBuzz && !buzzing.current) {
      buzzing.current = true;
      // The loop never ends on its own, so this callback only fires if playback stopped or failed
      // (audio focus lost, player error...). Clearing the flag lets the 1 s tick restart the siren.
      s.play(() => { buzzing.current = false; });
    }
    else if (!shouldBuzz && buzzing.current) { buzzing.current = false; s.stop(); }
  }, [anyFire, muted, now]);

  // A mute only applies to the alarm it was pressed for; the next fire must sound again.
  useEffect(() => { if (!anyFire) setMuted(false); }, [anyFire]);

  // ---------- counts ----------
  // Devices: scanned (found) devices out of the 31 possible slave IDs.
  const devicesScanned = ModbusRtu.slaveIds.length;
  // Sensors: configured (placed on a floor) out of every zone the scanned devices offer.
  const sensorsConfigured = history.reduce((n, f) => n + f.sensors.length, 0);
  const sensorsAvailable = ModbusRtu.slaveIds.reduce(
    (n, id) => n + zonesForDeviceType(ModbusRtu.slaveTypeMap.get(id) ?? 'fsa').length, 0);

  const floorDeviceIds = (f: SiteImageConfig) => [...new Set(f.sensors.map((s) => s.slaveId))].sort((a, b) => a - b);
  const floorDevicesOnline = (f: SiteImageConfig) => floorDeviceIds(f).filter((id) => !manager.isSlaveOffline(id)).length;
  const floorSensorsOnline = (f: SiteImageConfig) => f.sensors.filter((s) => !manager.isSlaveOffline(s.slaveId)).length;

  const selectSensor = useCallback((s: PlacedSensor) => setSelectedKey(pinKey(s)), []);
  const toggleSelect = useCallback((s: PlacedSensor) => setSelectedKey((k) => (k === pinKey(s) ? null : pinKey(s))), []);

  // ---------- fire-alert data ----------
  const fireFloorList = anyFire ? computeFireFloors(manager, history, fireLatch) : [];
  const alertIdx = Math.min(selectedAlertFloorIndex, Math.max(0, fireFloorList.length - 1));
  const alertFloor = fireFloorList[alertIdx] ?? null;
  // Offline is counted per DEVICE (slave), never per sensor: a device with 4 alerting
  // sensors that goes offline counts as 1.
  const offlineDevicesOn = (fl: SiteImageConfig) =>
    new Set(
      firingSensorsForFloor(manager, fl, fireStartTimes, fireLatch)
        .filter((sn) => manager.isSlaveOffline(sn.slaveId))
        .map((sn) => sn.slaveId),
    ).size;
  const offlineCounts = fireFloorList.map(offlineDevicesOn);
  const offlineDevicesNow = ModbusRtu.slaveIds.filter((id) => manager.isSlaveOffline(id)).length;
  const firingSensors = alertFloor ? firingSensorsForFloor(manager, alertFloor, fireStartTimes, fireLatch) : [];

  // Keep the highlighted pin and the footer in sync: if nothing (or a sensor
  // that is not alerting on this floor) is selected, select the first one.
  useEffect(() => {
    if (!anyFire || !alertFloor || firingSensors.length === 0) return;
    if (!selectedKey || !firingSensors.some((s) => pinKey(s) === selectedKey)) {
      setSelectedKey(pinKey(firingSensors[0]));
    }
  });

  /** Left/Right: walk through EVERY alert on EVERY fire floor, floor image switching with it. */
  const stepAlertGlobal = (delta: number) => {
    const entries: { f: number; s: PlacedSensor }[] = [];
    fireFloorList.forEach((fl, f) => firingSensorsForFloor(manager, fl, fireStartTimes, fireLatch).forEach((s) => entries.push({ f, s })));
    if (entries.length < 2) return;
    let cur = selectedKey ? entries.findIndex((e) => e.f === alertIdx && pinKey(e.s) === selectedKey) : -1;
    if (cur < 0) cur = entries.findIndex((e) => e.f === alertIdx);
    if (cur < 0) cur = 0;
    const next = (cur + delta + entries.length) % entries.length;
    setSelectedAlertFloorIndex(entries[next].f);
    setSelectedKey(pinKey(entries[next].s));
  };

  /** Down / OK / CH+ / PgDn = next fire floor, CH- / PgUp = previous. */
  const stepAlertFloor = (delta: number) => {
    if (fireFloorList.length < 2) return;
    setSelectedAlertFloorIndex((alertIdx + delta + fireFloorList.length) % fireFloorList.length);
    setSelectedKey(null); // footer re-selects that floor's first alert
  };

  // Slaves go offline after 60 s without data, so a 5 s bucket is plenty for
  // the pins; it keeps FloorBody (and the big SVG) from repainting every second.
  const statusTick = Math.floor(now / 5000);
  const dataVersion = manager.changes.getVersion();
  const floorProps = { manager, fireLatch, latchSig, selectedKey, selectSensor, toggleSelect, statusTick, dataVersion, dark: AppSettings.darkModeEnabled, pinSize: AppSettings.pinSize };

  // ---------- top bar ----------
  const renderTopBar = (alertMode = false) => {
    const isFire = alertMode || anyFire;
    const connected = manager.connectionStatus === 'Connected';
    const d = new Date(now);
    const fg = isFire ? FIRE_TEXT2 : AppTheme.textSecondary;
    const accent = isFire ? C.tealAccent : AppTheme.focusAccent;
    const downTarget = alertMode ? handleOf(fireFloorRefs.current[alertIdx]) : selectedTabH;
    return (
      <View style={[styles.topBar, { backgroundColor: isFire ? '#2A0606' : AppTheme.card, borderBottomColor: AppTheme.divider }]}>
        <Image
          source={(AppSettings.darkModeEnabled || isFire)
            ? require('../../assets/images/white logo.png')
            : require('../../assets/images/black logo.png')}
          style={styles.logo}
          resizeMode="contain"
        />
        <View pointerEvents="none" style={styles.topCenter}>
          <Text style={{ color: isFire ? C.redAccent : AppTheme.ok, fontSize: 16, fontWeight: 'bold' }}>
            {isFire ? 'Fire Alert' : 'Normal'}
          </Text>
        </View>
        <View style={{ flex: 1 }} />
        <Text style={[styles.clock, { color: fg }]}>
          {`${two(d.getHours())}:${two(d.getMinutes())}:${two(d.getSeconds())}\n${two(d.getDate())}/${two(d.getMonth() + 1)}/${d.getFullYear()}`}
        </Text>
        {alertMode && offlineDevicesNow > 0 && (
          <View style={[styles.conn, { borderColor: C.orange, flexDirection: 'row', alignItems: 'center' }]}>
            <OfflineBlink size={14} />
            <Text style={{ color: C.orange, fontSize: 12, fontWeight: '600', marginLeft: 6 }}>
              {`Offline devices: ${offlineDevicesNow}`}
            </Text>
          </View>
        )}
        <View style={[styles.conn, { borderColor: connected ? accent : C.orange }]}>
          <Text style={{ color: connected ? accent : C.orange, fontSize: 12, fontWeight: '600' }}>
            {manager.connectionStatus}
          </Text>
        </View>
        {AppSettings.sirenEnabled && (
          <IconBtn
            btnRef={sirenRef}
            accent={accent}
            onPress={() => setMuted((m) => !m)}
            nextFocusUp={sirenH}
            nextFocusLeft={sirenH}
            nextFocusRight={alertMode ? sirenH : menuH}
            nextFocusDown={downTarget}
          >
            <Icon name={muted ? 'volume-off' : 'volume-up'} size={18} color={fg} />
          </IconBtn>
        )}
        {/* Menu is locked while a fire alert is showing. */}
        {!alertMode && (
          <IconBtn
            btnRef={menuRef}
            accent={accent}
            onPress={() => navigation.navigate('Home')}
            nextFocusUp={menuH}
            nextFocusRight={menuH}
            nextFocusLeft={AppSettings.sirenEnabled ? sirenH : menuH}
            nextFocusDown={downTarget}
          >
            <Icon name="menu" size={18} color={fg} />
          </IconBtn>
        )}
      </View>
    );
  };

  // ---------- normal-mode panels ----------
  const renderFloorTabs = () => (
    <View style={[styles.floorTabs, { borderRightColor: AppTheme.divider, borderBottomColor: AppTheme.divider }]}>
      <View style={styles.floorHeader}>
        <Icon name="layers" size={16} color={AppTheme.textPrimary} />
        <Text style={{ color: AppTheme.textPrimary, fontSize: 13, fontWeight: 'bold', marginLeft: 7 }}>Floor</Text>
      </View>
      <ScrollView>
        {history.map((f, i) => {
          const sel = i === floorIndex;
          return (
            <FocusPressable
              key={f.id}
              ref={(n: any) => { floorTabRefs.current[i] = n; }}
              hasTVPreferredFocus={i === floorIndex}
              nextFocusUp={i === 0 ? topBarTarget : undefined}
              nextFocusRight={firstDeviceH}
              radius={8}
              scale={1.03}
              onPress={() => { setSelectedFloorIndex(i); setSelectedKey(null); }}
              onFocus={() => { setSelectedFloorIndex(i); setSelectedKey(null); }}
              style={[styles.floorTab, { backgroundColor: sel ? overlay(0.08) : 'transparent' }]}
            >
              {(foc: boolean) => (
                <>
                  <View style={[styles.selBar, { backgroundColor: sel || foc ? AppTheme.focusAccent : 'transparent' }]} />
                  <Text
                    style={{
                      flex: 1,
                      color: foc ? AppTheme.focusAccent : sel ? AppTheme.textPrimary : AppTheme.textSecondary,
                      fontWeight: sel || foc ? 'bold' : 'normal',
                      fontSize: 13,
                    }}
                  >
                    {f.floorLabel}
                  </Text>
                </>
              )}
            </FocusPressable>
          );
        })}
      </ScrollView>
    </View>
  );

  const renderDeviceList = (floor: SiteImageConfig) => {
    if (floor.sensors.length === 0) {
      return <Text style={{ color: AppTheme.textSecondary, fontSize: 12, padding: 12 }}>No sensors placed on this floor yet</Text>;
    }
    return (
      <FlatList
        data={floor.sensors}
        keyExtractor={pinKey}
        renderItem={({ item, index }) => {
          const status = statusFor(manager, item);
          const color = colorForStatus(status);
          const key = pinKey(item);
          const sel = selectedKey === key;
          return (
            <FocusPressable
              ref={index === 0 ? (n: any) => { firstDeviceRef.current = n; } : undefined}
              nextFocusUp={index === 0 ? selectedTabH : undefined}
              nextFocusLeft={selectedTabH}
              radius={8}
              scale={1.03}
              onPress={() => selectSensor(item)}
              onFocus={() => selectSensor(item)}
              style={[styles.deviceRow, { backgroundColor: sel ? overlay(0.06) : 'transparent' }]}
            >
              {(foc: boolean) => (
                <>
                  <View style={[styles.selBar, { backgroundColor: sel || foc ? AppTheme.focusAccent : 'transparent' }]} />
                  <Icon name={status === 'offline' ? 'wifi-off' : SensorTypeUi[item.type].icon} size={18} color={color} />
                  <View style={{ flex: 1, marginLeft: 8 }}>
                    <Text
                      numberOfLines={1}
                      style={{
                        color: foc ? AppTheme.focusAccent : sel ? AppTheme.textPrimary : AppTheme.textSecondary,
                        fontSize: 12,
                        fontWeight: foc || sel ? 'bold' : 'normal',
                      }}
                    >
                      {item.name}
                    </Text>
                    <Text style={{ color, fontSize: 10, marginTop: 2, opacity: 0.9 }}>{status}</Text>
                  </View>
                </>
              )}
            </FocusPressable>
          );
        }}
      />
    );
  };

  const renderLeftPanel = () => {
    const f = currentFloor;
    if (!f) return null;
    return (
      <View style={[styles.left, { backgroundColor: AppTheme.panel }]}>
        <View style={{ height: 200 }}>{renderFloorTabs()}</View>
        <View style={[styles.hr, { backgroundColor: AppTheme.divider }]} />
        <Text style={{ color: AppTheme.textPrimary, fontWeight: 'bold', fontSize: 13, padding: 10, paddingBottom: 4 }}>
          {f.floorLabel} device
        </Text>
        <View style={{ flex: 1 }}>{renderDeviceList(f)}</View>
        <View style={[styles.hr, { backgroundColor: AppTheme.divider }]} />
        <Text style={{ color: AppTheme.textSecondary, fontSize: 11, padding: 8 }}>
          Devices: {floorDevicesOnline(f)}/{floorDeviceIds(f).length} online
        </Text>
      </View>
    );
  };

  const renderRightPanel = () => {
    const offlineIds = ModbusRtu.slaveIds.filter((id) => manager.isSlaveOffline(id)).sort((a, b) => a - b);
    const affected = history.filter((f) => f.sensors.some((s) => manager.isSlaveOffline(s.slaveId)));
    return (
      <ScrollView
        style={[styles.right, { backgroundColor: AppTheme.panel }]}
        contentContainerStyle={{ paddingTop: 14, paddingLeft: 10, paddingRight: 8, paddingBottom: 10 }}
      >
        <Text style={{ color: AppTheme.textPrimary, fontSize: 13, fontWeight: 'bold' }}>Status</Text>
        <View style={{ height: 10 }} />
        <SideStat label="Devices" value={`${devicesScanned}/${SCAN_MAX_SLAVES}`} />
        <View style={{ height: 8 }} />
        <SideStat label="Sensors" value={`${sensorsConfigured}/${sensorsAvailable}`} />
        <View style={{ height: 16 }} />
        <Text numberOfLines={1} style={{ color: C.orange, fontSize: 12, fontWeight: 'bold' }}>Offline Devices</Text>
        <View style={{ height: 6 }} />
        {offlineIds.length === 0 ? (
          <Text style={{ color: AppTheme.textSecondary, fontSize: 11 }}>None</Text>
        ) : (
          <>
            <Text numberOfLines={1} style={{ color: AppTheme.textSecondary, fontSize: 11, paddingVertical: 2 }}>
              Device {offlineIds.length}
            </Text>
            {affected.length > 0 && (
              <>
                <Text numberOfLines={1} style={{ color: AppTheme.textSecondary, fontSize: 12, fontWeight: 'bold', marginTop: 14, marginBottom: 6 }}>
                  Floors affected
                </Text>
                {affected.map((f) => (
                  <Text key={f.id} numberOfLines={1} style={{ color: AppTheme.textSecondary, fontSize: 11, paddingVertical: 2 }}>{f.floorLabel}</Text>
                ))}
              </>
            )}
          </>
        )}
      </ScrollView>
    );
  };

  const renderBottomSummary = () => {
    const f = currentFloor;
    if (!f) return null;
    const sensorsTotal = f.sensors.length;
    const sensorsOnline = floorSensorsOnline(f);
    const devicesTotal = floorDeviceIds(f).length;
    const devicesOnline = floorDevicesOnline(f);
    const cell = { flex: 1, fontSize: 12 } as const;
    return (
      <View style={[styles.bottom, { backgroundColor: AppTheme.card, borderTopColor: AppTheme.divider }]}>
        <Text numberOfLines={1} style={{ width: 120, color: AppTheme.focusAccent, fontWeight: 'bold', fontSize: 13 }}>{f.floorLabel}</Text>
        <View style={{ width: 1, alignSelf: 'stretch', backgroundColor: AppTheme.divider }} />
        <Text style={[cell, { color: AppTheme.textSecondary, paddingLeft: 12 }]}>Devices: {devicesOnline}/{devicesTotal}</Text>
        <Text style={[cell, { color: AppTheme.textSecondary }]}>Sensors: {sensorsOnline}/{sensorsTotal}</Text>
        <Text style={[cell, { color: AppTheme.ok }]}>Online sensors: {sensorsOnline}</Text>
        <Text style={[cell, { color: AppTheme.warn }]}>Offline sensors: {sensorsTotal - sensorsOnline}</Text>
      </View>
    );
  };

  // ---------- fire-alert layout ----------
  /** Right side (slim): device name + sensor name for every alerting sensor on the selected fire floor. */
  const renderAlertSensors = () => {
    const floorH = handleOf(fireFloorRefs.current[alertIdx]);
    return (
      <View style={styles.alertPanel}>
        <View style={styles.alertPanelHeader}>
          <Text numberOfLines={1} style={{ flex: 1, color: C.redAccent, fontSize: 12, fontWeight: 'bold' }}>
            {`${alertFloor!.floorLabel} sensors`}
          </Text>
          <Text style={{ color: FIRE_TEXT2, fontSize: 10 }}>{firingSensors.length}</Text>
        </View>
        <FlatList
          style={{ flex: 1 }}
          contentContainerStyle={{ padding: 6 }}
          data={firingSensors}
          keyExtractor={pinKey}
          renderItem={({ item, index }) => {
            const key = pinKey(item);
            const sel = selectedKey === key;
            const off = manager.isSlaveOffline(item.slaveId);
            return (
              <FocusPressable
                ref={index === 0 ? (nd: any) => { firstAlertRef.current = nd; } : undefined}
                nextFocusUp={index === 0 ? floorH : undefined}
                nextFocusLeft={floorH}
                accent={C.redAccent}
                focusFill="rgba(244,67,54,0.25)"
                radius={8}
                scale={1.03}
                onPress={() => setSelectedKey(key)}
                onFocus={() => setSelectedKey(key)}
                style={[styles.sensorCard, { backgroundColor: sel ? 'rgba(244,67,54,0.14)' : 'transparent' }]}
              >
                <View style={{ flex: 1 }}>
                  <Text numberOfLines={1} style={{ color: sel ? FIRE_TEXT : FIRE_TEXT2, fontSize: 12, fontWeight: sel ? 'bold' : '600' }}>
                    {item.name}
                  </Text>
                  <Text numberOfLines={1} style={{ color: FIRE_TEXT2, fontSize: 10, marginTop: 2 }}>{item.zoneLabel}</Text>
                </View>
                {off && <OfflineBlink size={15} />}
              </FocusPressable>
            );
          }}
        />
      </View>
    );
  };

  const renderFireAlert = () => {
    if (!alertFloor) return null;
    return (
      <View style={{ flex: 1 }}>
        {renderTopBar(true)}
        <View style={{ flex: 1, flexDirection: 'row' }}>
          <View style={styles.fireList}>
            <Text style={{ color: C.redAccent, fontSize: 12, fontWeight: 'bold', padding: 10, paddingTop: 10, paddingBottom: 6 }}>
              Fire Floor
            </Text>
            <View style={{ flex: 1 }}>
              <FlatList
                data={fireFloorList}
                keyExtractor={(f) => f.id}
                renderItem={({ item, index }) => {
                  const sel = index === alertIdx;
                  const n = firingSensorsForFloor(manager, item, fireStartTimes, fireLatch).length;
                  return (
                    <FocusPressable
                      ref={(nd: any) => { fireFloorRefs.current[index] = nd; }}
                      hasTVPreferredFocus={sel}
                      nextFocusUp={index === 0 ? alertTopTarget : undefined}
                      nextFocusRight={handleOf(firstAlertRef.current)}
                      accent={C.redAccent}
                      focusFill="rgba(244,67,54,0.25)"
                      radius={8}
                      scale={1.03}
                      onPress={() => { setSelectedAlertFloorIndex(index); setSelectedKey(null); }}
                      onFocus={() => { if (index !== alertIdx) { setSelectedAlertFloorIndex(index); setSelectedKey(null); } }}
                      style={[styles.fireItem, { backgroundColor: sel ? 'rgba(244,67,54,0.12)' : 'transparent' }]}
                    >
                      <View style={[styles.selBar, { backgroundColor: sel ? C.redAccent : 'transparent' }]} />
                      <View style={{ flex: 1 }}>
                        <Text style={{ fontSize: 13, color: sel ? FIRE_TEXT : FIRE_TEXT2, fontWeight: sel ? 'bold' : 'normal' }}>
                          {item.floorLabel}
                        </Text>
                        <Text style={{ fontSize: 10, color: C.redAccent, marginTop: 1 }}>{`Alert - ${n}`}</Text>
                      </View>
                      {offlineCounts[index] > 0 && (
                        <View style={{ marginLeft: 6, alignSelf: 'center' }}>
                          <OfflineBlink size={16} />
                        </View>
                      )}
                    </FocusPressable>
                  );
                }}
              />
            </View>
          </View>
          <View style={{ flex: 1 }}>
            <View style={{ flex: 1 }}><FloorBody floor={alertFloor} onlyFiring {...floorProps} /></View>
          </View>
          {renderAlertSensors()}
        </View>

        <AlertFooter
          floor={alertFloor}
          floors={fireFloorList}
          floorIdx={alertIdx}
          counts={fireFloorList.map((f) => firingSensorsForFloor(manager, f, fireStartTimes, fireLatch).length)}
          offlineCounts={offlineCounts}
          sensors={firingSensors}
          selectedKey={selectedKey}
          now={now}
          startTimes={fireStartTimes}
          onGlobal={stepAlertGlobal}
          onFloor={stepAlertFloor}
          onPickFloor={(i) => { setSelectedAlertFloorIndex(i); setSelectedKey(null); }}
          onPickSensor={(i) => setSelectedKey(pinKey(firingSensors[i]))}
          isOffline={(sn) => manager.isSlaveOffline(sn.slaveId)}
        />
      </View>
    );
  };

  // ---------- render ----------
  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: AppTheme.background }}>
      {anyFire && alertFloor ? (
        renderFireAlert()
      ) : (
        <View style={{ flex: 1 }}>
          {renderTopBar()}
          {history.length > 0 ? (
            <>
              <View style={{ flex: 1, flexDirection: 'row' }}>
                {renderLeftPanel()}
                <View style={{ flex: 1 }}><FloorBody floor={currentFloor} {...floorProps} /></View>
                {renderRightPanel()}
              </View>
              {renderBottomSummary()}
            </>
          ) : (
            <EmptyState />
          )}
        </View>
      )}
    </SafeAreaView>
  );
}


////////////////////////////////////////////////////////////
// Floor image + live pins (module-level so its hooks/state survive the
// dashboard's 1-second re-render tick)
////////////////////////////////////////////////////////////
const FloorBody = React.memo(function FloorBody(props: {
  floor: SiteImageConfig | null;
  onlyFiring?: boolean;
  manager: Rs485Service;
  fireLatch: ReadonlySet<string>;
  latchSig: string;     // repaint the memoised view when the latch changes
  selectedKey: string | null;
  selectSensor: (s: PlacedSensor) => void;
  toggleSelect: (s: PlacedSensor) => void;
  statusTick: number;   // only used to re-render pins as time passes
  dataVersion: number;  // only used to re-render pins when new data arrives
  dark: boolean;        // theme change must repaint the memoised view
  pinSize: number;
}) {
  const { floor, onlyFiring, manager, fireLatch, selectedKey, selectSensor, toggleSelect } = props;
  const { info, error, isCurrent } = useSvg(floor?.imagePath ?? null);
  const [box, setBox] = useState({ w: 0, h: 0 });
  if (!floor) return <EmptyState />;
  if (error) {
    return (
      <View style={styles.center}>
        <Icon name="broken-image" size={48} color={C.grey} />
        <Text style={{ color: C.grey, fontSize: 13, textAlign: 'center', marginTop: 8 }}>
          {'Floor plan image cannot be opened.\nLoad it again from the Configuration screen.'}
        </Text>
      </View>
    );
  }
  if (!info) return <SvgSpinner />;

  const pins = onlyFiring ? floor.sensors.filter((s) => statusFor(manager, s, fireLatch) === 'fire') : floor.sensors;
  const pinSize = AppSettings.pinSize;
  const rippleBox = pinSize * 3;
  const onLayout = (e: LayoutChangeEvent) => setBox({ w: e.nativeEvent.layout.width, h: e.nativeEvent.layout.height });

  return (
    <FitBox aspect={info.width / info.height} padding={16}>
        <View onLayout={onLayout} style={[styles.floorCanvas, { backgroundColor: C.white }]}>
          <SvgFill xml={info.xml} uri={info.uri} />
          {isCurrent && pins.map((s) => {
            const status = statusFor(manager, s, fireLatch);
            const color = colorForStatus(status);
            const fire = status === 'fire';
            const deadFire = fire && manager.isSlaveOffline(s.slaveId); // fire latched, device now offline
            const key = pinKey(s);
            const selected = selectedKey === key;
            return (
              <View
                key={key}
                style={{
                  position: 'absolute',
                  left: s.xFraction * box.w - rippleBox / 2,
                  top: s.yFraction * box.h - rippleBox / 2,
                  width: rippleBox, height: rippleBox,
                  alignItems: 'center', justifyContent: 'center',
                }}
              >
                {fire && <FireRipple size={rippleBox} color={C.redAccent} />}
                {/* Pins are display-only for the D-pad: the device list drives selection.
                    Touch / mouse taps still select. */}
                <FocusPressable
                  focusable={false}
                  onPress={() => toggleSelect(s)}
                  style={{
                    width: pinSize + 8, height: pinSize + 8, borderRadius: (pinSize + 8) / 2, backgroundColor: color,
                    alignItems: 'center', justifyContent: 'center',
                    borderWidth: selected ? 3 : 2,
                    borderColor: selected ? C.black : 'transparent',
                    transform: [{ scale: selected ? 1.3 : 1 }],
                    ...(fire ? { shadowColor: C.red, shadowOpacity: 0.6, shadowRadius: 16, elevation: 10 } : null),
                  }}
                >
                  <Icon
                    name={status === 'offline' ? 'wifi-off' : SensorTypeUi[s.type].icon}
                    size={pinSize * 0.5}
                    color={C.white}
                  />
                </FocusPressable>
                {deadFire && (
                  <View pointerEvents="none" style={{ position: 'absolute', right: rippleBox / 2 - pinSize / 2 - 8, top: rippleBox / 2 - pinSize / 2 - 8 }}>
                    <OfflineBlink size={12} badge />
                  </View>
                )}
              </View>
            );
          })}
        </View>
    </FitBox>
  );
});

const BLINK_GRAY = '#9E9E9E';
const BLINK_YELLOW = '#FFD600';

/** Offline symbol that blinks gray <-> yellow (as a plain icon, or as a round badge on a pin). */
function OfflineBlink({ size, badge }: { size: number; badge?: boolean }) {
  const [on, setOn] = useState(true);
  useEffect(() => {
    const t = setInterval(() => setOn((v) => !v), 500);
    return () => clearInterval(t);
  }, []);
  const c = on ? BLINK_YELLOW : BLINK_GRAY;
  if (!badge) return <Icon name="wifi-off" size={size} color={c} />;
  return (
    <View style={{ backgroundColor: on ? BLINK_GRAY : BLINK_YELLOW, borderRadius: (size + 6) / 2, padding: 2 }}>
      <Icon name="wifi-off" size={size} color={on ? BLINK_YELLOW : '#212121'} />
    </View>
  );
}

/** Top-bar button that shows a clear ring when reached with the D-pad. */
function IconBtn({ onPress, children, accent, btnRef, ...nav }: {
  onPress: () => void;
  children: React.ReactNode;
  accent?: string;
  btnRef?: (n: any) => void;
} & NavProps) {
  return (
    <FocusPressable ref={btnRef} focusable accent={accent} radius={10} scale={1.12} onPress={onPress} style={styles.iconBtn} {...nav}>
      {children}
    </FocusPressable>
  );
}

function SideStat({ label, value }: { label: string; value: string }) {
  return (
    <View style={{ flexDirection: 'row', justifyContent: 'space-between' }}>
      <Text style={{ color: AppTheme.textSecondary, fontSize: 12 }}>{label}</Text>
      <Text style={{ color: AppTheme.textPrimary, fontSize: 12, fontWeight: 'bold' }}>{value}</Text>
    </View>
  );
}

/**
 * Fire-alert footer: shows ONE alerting sensor at a time across the full
 * width (so every field is readable) and lets the remote step through ALL
 * alerting sensors on all fire floors.
 *   Left/Right = previous/next alert (across floors)
 *   Down / OK / CH+ / PgDn = next fire floor,  CH- / PgUp = previous
 *   Up is not consumed, so focus can still travel to the top bar.
 */

function AlertFooter(props: {
  floor: SiteImageConfig;
  floors: SiteImageConfig[];
  floorIdx: number;
  counts: number[];
  /** Offline (latched-fire) alerts per fire floor. */
  offlineCounts: number[];
  sensors: PlacedSensor[];
  selectedKey: string | null;
  now: number;
  startTimes: Map<string, number>;
  onGlobal: (d: number) => void;
  onFloor: (d: number) => void;
  onPickFloor: (i: number) => void;
  onPickSensor: (i: number) => void;
  /** True when the sensor's device is offline (fire latched). */
  isOffline?: (s: PlacedSensor) => boolean;
}) {
  const {
    floor,
    floors,
    floorIdx,
    counts,
    offlineCounts,
    sensors,
    selectedKey,
    now,
    startTimes,
  } = props;

  // Display only: the D-pad lives in the left column (floors -> sensors).
  // CH+ / CH- still jump between fire floors from anywhere.
  useRemoteKeys((k) => {
    if (k === 'next') props.onFloor(1);
    else if (k === 'prev') props.onFloor(-1);
  });

  const wrap = (children: React.ReactNode) => (
    <View style={[styles.alertFooter, { borderTopColor: C.redAccent, borderTopWidth: 1 }]}>
      {children}
    </View>
  );

  if (sensors.length === 0) {
    return wrap(
      <View style={[styles.center, { height: 48 }]}>
        <Text style={{ color: FIRE_TEXT2, fontSize: 12 }}>
          Fire device information unavailable
        </Text>
      </View>,
    );
  }

  const foundIndex = sensors.findIndex(
    (s) => pinKey(s) === selectedKey,
  );

  const idx = Math.max(0, foundIndex);
  const cur = sensors[idx];

  const detail = (label: string, value: string, flex: number) => (
    <View style={[styles.alertDetail, { flex }]}>
      <Text style={{ color: FIRE_TEXT2, fontSize: 10 }}>{label}</Text>
      <Text numberOfLines={2} style={{ color: FIRE_TEXT, fontSize: 12, fontWeight: '600', marginTop: 1 }}>
        {value === '' ? '-' : value}
      </Text>
    </View>
  );

  return wrap(
    <>
      <View style={{ flexDirection: 'row', alignItems: 'center' }}>
        <Icon name="local-fire-department" size={22} color={C.redAccent} />
        <View style={{ width: 4 }} />
        {detail('Device', props.isOffline?.(cur) ? `${cur.name} (OFFLINE)` : cur.name, 3)}
        {detail('Sensor', cur.zoneLabel, 2)}
        {detail('Location', cur.location, 3)}
        {detail('Time', formatElapsed(startTimes.get(pinKey(cur)), now), 1)}
        {cur.notes.trim() !== '' && detail('Notes', cur.notes, 3)}
      </View>

    </>,
  );
}


function EmptyState() {
  return (
    <View style={styles.center}>
      <Icon name="image" size={64} color={C.grey} />
      <Text style={{ color: C.grey, fontSize: 14, marginTop: 12 }}>No floor plan configured yet</Text>
      <Text style={{ color: C.grey, fontSize: 12, marginTop: 4 }}>Load one from the Configuration screen</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  center: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  topBar: { height: 56, paddingHorizontal: 14, flexDirection: 'row', alignItems: 'center', borderBottomWidth: 1 },
  logo: { width: 80, height: 56 },
  topCenter: { position: 'absolute', left: 0, right: 0, top: 0, bottom: 0, alignItems: 'center', justifyContent: 'center' },
  clock: { width: 90, textAlign: 'right', fontSize: 12, lineHeight: 15, fontWeight: '600', marginRight: 10 },
  conn: { paddingHorizontal: 10, paddingVertical: 5, borderRadius: 6, borderWidth: 1, marginRight: 8 },
  iconBtn: { padding: 5, marginLeft: 2 },
  floorCanvas: { flex: 1, borderRadius: 8, overflow: 'hidden' },
  floorTabs: { flex: 1, borderRightWidth: 1, borderBottomWidth: 1 },
  floorHeader: { height: 34, flexDirection: 'row', alignItems: 'center', paddingHorizontal: 12 },
  floorTab: { minHeight: 34, paddingVertical: 4, paddingHorizontal: 8, marginHorizontal: 6, marginVertical: 1, flexDirection: 'row', alignItems: 'center' },
  selBar: { width: 3, height: 18, borderRadius: 2, marginRight: 8 },
  deviceRow: { paddingHorizontal: 6, paddingVertical: 4, marginHorizontal: 6, marginVertical: 1, flexDirection: 'row', alignItems: 'center' },
  left: { width: PANEL_WIDTH },
  right: { width: RIGHT_PANEL_WIDTH, flexGrow: 0, flexShrink: 0 },
  hr: { height: 1 },
  bottom: { height: 40, paddingHorizontal: 16, flexDirection: 'row', alignItems: 'center', borderTopWidth: 1 },
  fireList: { width: 150, backgroundColor: FIRE_BG },
  alertPanel: { width: 150, flexGrow: 0, flexShrink: 0, backgroundColor: FIRE_BG, borderLeftWidth: 1, borderLeftColor: 'rgba(244,67,54,0.35)' },
  alertPanelHeader: { height: 44, flexDirection: 'row', alignItems: 'center', paddingHorizontal: 10, borderBottomWidth: 1, borderBottomColor: 'rgba(244,67,54,0.35)' },
  sensorCard: { paddingHorizontal: 8, paddingVertical: 6, marginBottom: 2, flexDirection: 'row', alignItems: 'center' },
  fireItem: { minHeight: 40, paddingVertical: 4, paddingHorizontal: 8, marginHorizontal: 6, marginVertical: 1, flexDirection: 'row', alignItems: 'center' },
  alertHeader: { height: 44, paddingHorizontal: 16, justifyContent: 'center', borderBottomWidth: 1, borderBottomColor: C.redAccent },
  alertFooter: { paddingHorizontal: 6, paddingVertical: 4, backgroundColor: FIRE_BG },
  chipRow: { flexDirection: 'row', alignItems: 'center', flexWrap: 'wrap', marginBottom: 2 },
  chip: { paddingHorizontal: 8, paddingVertical: 2, borderRadius: 10, borderWidth: 1, borderColor: C.redAccent, marginRight: 6, marginBottom: 2 },
  footerInfo: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', flexWrap: 'wrap', marginTop: 6 },
  dots: { flexDirection: 'row', alignItems: 'center', marginLeft: 12 },
  dot: { height: 9, borderRadius: 5, marginHorizontal: 2 },
  alertDetail: { flex: 1, paddingHorizontal: 6, justifyContent: 'center' },
});