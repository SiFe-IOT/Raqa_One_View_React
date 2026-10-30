import React, { useCallback, useEffect, useRef, useState } from 'react';
import { BackHandler, FlatList, Image, Pressable, findNodeHandle, ScrollView, StyleSheet, Text, View, LayoutChangeEvent } from 'react-native';
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
import { PlacedSensor, SensorTypeUi, SiteImageConfig } from '../services/configTypes';
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
const PANEL_WIDTH = 205;       // width of the left side panel
const RIGHT_PANEL_WIDTH = 205; // width of the right side panel (change this to resize it)
const two = (n: number) => String(n).padStart(2, '0');
const overlay = (o: number) => (AppSettings.darkModeEnabled ? `rgba(255,255,255,${o})` : `rgba(0,0,0,${o})`);

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
  const [focusedFloor, setFocusedFloor] = useState<number | null>(null);
  const [focusedDevice, setFocusedDevice] = useState<string | null>(null);
  const [selectedKey, setSelectedKey] = useState<string | null>(null);
  const [now, setNow] = useState(Date.now());
  const [muted, setMuted] = useState(false);

  const fireStartTimes = useRef(new Map<string, number>()).current;

  // ---------- remote access ----------
  // Dashboard is the launch screen, so Back would exit the app and the menu
  // button would be unreachable. Back / Menu on the remote opens the menu.
  useEffect(() => {
    const sub = BackHandler.addEventListener('hardwareBackPress', () => {
      if (!navigation.isFocused()) return false;
      navigation.navigate('Home');
      return true;
    });
    return () => sub.remove();
  }, [navigation]);

  // ---------- derived ----------
  const floorIndex = Math.min(selectedFloorIndex, Math.max(0, history.length - 1));
  const currentFloor: SiteImageConfig | null = history[floorIndex] ?? null;

  const anyFire = history.some((f) => f.sensors.some((s) => statusFor(manager, s) === 'fire'));

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
    for (const f of store.history)
      for (const s of f.sensors)
        if (statusFor(manager, s) === 'fire') {
          const k = pinKey(s);
          live.add(k);
          if (!fireStartTimes.has(k)) fireStartTimes.set(k, Date.now());
        }
    for (const k of [...fireStartTimes.keys()]) if (!live.has(k)) fireStartTimes.delete(k);
  }, [now, manager, store, fireStartTimes]);

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
    if (shouldBuzz && !buzzing.current) { buzzing.current = true; s.play(); }
    else if (!shouldBuzz && buzzing.current) { buzzing.current = false; s.stop(); }
  }, [anyFire, muted, now]);

  // A mute only applies to the alarm it was pressed for; the next fire must sound again.
  useEffect(() => { if (!anyFire) setMuted(false); }, [anyFire]);

  // ---------- counts ----------
  const devicesTotalGlobal = ModbusRtu.slaveIds.length;
  const devicesOnlineGlobal = ModbusRtu.slaveIds.filter((id) => !manager.isSlaveOffline(id)).length;
  const sensorsTotalGlobal = history.reduce((n, f) => n + f.sensors.length, 0);
  const sensorsOnlineGlobal = history.reduce(
    (n, f) => n + f.sensors.filter((s) => !manager.isSlaveOffline(s.slaveId)).length, 0);

  const floorDeviceIds = (f: SiteImageConfig) => [...new Set(f.sensors.map((s) => s.slaveId))].sort((a, b) => a - b);
  const floorDevicesOnline = (f: SiteImageConfig) => floorDeviceIds(f).filter((id) => !manager.isSlaveOffline(id)).length;
  const floorSensorsOnline = (f: SiteImageConfig) => f.sensors.filter((s) => !manager.isSlaveOffline(s.slaveId)).length;

  const toggleSelect = useCallback((s: PlacedSensor) => setSelectedKey((k) => (k === pinKey(s) ? null : pinKey(s))), []);

  // ---------- fire-alert data ----------
  const fireFloorList = anyFire ? computeFireFloors(manager, history) : [];
  const alertIdx = Math.min(selectedAlertFloorIndex, Math.max(0, fireFloorList.length - 1));
  const alertFloor = fireFloorList[alertIdx] ?? null;
  const firingSensors = alertFloor ? firingSensorsForFloor(manager, alertFloor, fireStartTimes) : [];

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
    fireFloorList.forEach((fl, f) => firingSensorsForFloor(manager, fl, fireStartTimes).forEach((s) => entries.push({ f, s })));
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
  const floorProps = { manager, selectedKey, focusedDevice, setFocusedDevice, toggleSelect, statusTick, dataVersion, dark: AppSettings.darkModeEnabled, pinSize: AppSettings.pinSize };

  // ---------- top bar ----------
  const renderTopBar = (alertMode = false) => {
    const isFire = alertMode || anyFire;
    const connected = manager.connectionStatus === 'Connected';
    const d = new Date(now);
    const fg = isFire ? FIRE_TEXT2 : AppTheme.textSecondary;
    const accent = isFire ? C.tealAccent : AppTheme.focusAccent;
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
          <Text style={{ color: isFire ? C.redAccent : AppTheme.ok, fontSize: 18, fontWeight: 'bold' }}>
            {isFire ? 'Fire Alert' : 'Normal'}
          </Text>
        </View>
        <View style={{ flex: 1 }} />
        <Text style={[styles.clock, { color: fg }]}>
          {`${two(d.getHours())}:${two(d.getMinutes())}:${two(d.getSeconds())}\n${two(d.getDate())}/${two(d.getMonth() + 1)}/${d.getFullYear()}`}
        </Text>
        <View style={[styles.conn, { borderColor: connected ? accent : C.orange }]}>
          <Text style={{ color: connected ? accent : C.orange, fontSize: 14, fontWeight: '600' }}>
            {manager.connectionStatus}
          </Text>
        </View>
        {AppSettings.sirenEnabled && (
          <IconBtn onPress={() => setMuted((m) => !m)}>
            <Icon name={muted ? 'volume-off' : 'volume-up'} color={fg} />
          </IconBtn>
        )}
        <IconBtn onPress={() => navigation.navigate('Home')}>
          <Icon name="menu" color={fg} />
        </IconBtn>
      </View>
    );
  };

  // ---------- normal-mode panels ----------
  const renderFloorTabs = () => (
    <View style={[styles.floorTabs, { borderRightColor: AppTheme.divider, borderBottomColor: AppTheme.divider }]}>
      <View style={styles.floorHeader}>
        <Icon name="layers" size={16} color={AppTheme.textPrimary} />
        <Text style={{ color: AppTheme.textPrimary, fontSize: 15, fontWeight: 'bold', marginLeft: 7 }}>Floor</Text>
      </View>
      <ScrollView>
        {history.map((f, i) => {
          const sel = i === floorIndex;
          const foc = focusedFloor === i;
          return (
            <Pressable
              key={f.id}
              hasTVPreferredFocus={i === 0}
              onPress={() => { setSelectedFloorIndex(i); setSelectedKey(null); }}
              onFocus={() => { setFocusedFloor(i); setSelectedFloorIndex(i); setSelectedKey(null); }}
              onBlur={() => setFocusedFloor((x) => (x === i ? null : x))}
              style={[
                styles.floorTab,
                {
                  backgroundColor: sel ? overlay(0.08) : foc ? AppTheme.focusFill : 'transparent',
                  borderLeftColor: foc || sel ? AppTheme.focusAccent : 'transparent',
                },
              ]}
            >
              <Text
                style={{
                  color: foc ? AppTheme.focusAccent : sel ? AppTheme.textPrimary : AppTheme.textSecondary,
                  fontWeight: sel || foc ? 'bold' : 'normal',
                  fontSize: 15,
                }}
              >
                {f.floorLabel}
              </Text>
            </Pressable>
          );
        })}
      </ScrollView>
    </View>
  );

  const renderDeviceList = (floor: SiteImageConfig) => {
    if (floor.sensors.length === 0) {
      return <Text style={{ color: AppTheme.textSecondary, fontSize: 14, padding: 12 }}>No sensors placed on this floor yet</Text>;
    }
    return (
      <FlatList
        data={floor.sensors}
        keyExtractor={pinKey}
        renderItem={({ item }) => {
          const status = statusFor(manager, item);
          const color = colorForStatus(status);
          const key = pinKey(item);
          const sel = selectedKey === key;
          const foc = focusedDevice === `dev_${key}`;
          return (
            <Pressable
              onPress={() => toggleSelect(item)}
              onFocus={() => setFocusedDevice(`dev_${key}`)}
              onBlur={() => setFocusedDevice((f) => (f === `dev_${key}` ? null : f))}
              style={[
                styles.deviceRow,
                {
                  backgroundColor: sel ? overlay(0.06) : foc ? AppTheme.focusFill : 'transparent',
                  borderLeftColor: foc || sel ? AppTheme.focusAccent : 'transparent',
                },
              ]}
            >
              <Icon name={status === 'offline' ? 'wifi-off' : SensorTypeUi[item.type].icon} size={18} color={color} />
              <View style={{ flex: 1, marginLeft: 8 }}>
                <Text
                  numberOfLines={1}
                  style={{
                    color: foc ? AppTheme.focusAccent : AppTheme.textSecondary,
                    fontSize: 14,
                    fontWeight: foc ? 'bold' : 'normal',
                  }}
                >
                  {item.name}
                </Text>
                <Text style={{ color, fontSize: 12, marginTop: 2, opacity: 0.9 }}>{status}</Text>
              </View>
            </Pressable>
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
        <View style={{ height: 240 }}>{renderFloorTabs()}</View>
        <View style={[styles.hr, { backgroundColor: AppTheme.divider }]} />
        <Text style={{ color: AppTheme.textPrimary, fontWeight: 'bold', fontSize: 15, padding: 12, paddingBottom: 6 }}>
          {f.floorLabel} device
        </Text>
        <View style={{ flex: 1 }}>{renderDeviceList(f)}</View>
        <View style={[styles.hr, { backgroundColor: AppTheme.divider }]} />
        <Text style={{ color: AppTheme.textSecondary, fontSize: 13, padding: 12 }}>
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
        <Text style={{ color: AppTheme.textPrimary, fontSize: 15, fontWeight: 'bold' }}>Status</Text>
        <View style={{ height: 10 }} />
        <SideStat label="Devices" value={`${devicesOnlineGlobal}/${devicesTotalGlobal}`} />
        <View style={{ height: 8 }} />
        <SideStat label="Sensors" value={`${sensorsOnlineGlobal}/${sensorsTotalGlobal}`} />
        <View style={{ height: 16 }} />
        <Text numberOfLines={1} style={{ color: C.orange, fontSize: 14, fontWeight: 'bold' }}>Offline Devices</Text>
        <View style={{ height: 6 }} />
        {offlineIds.length === 0 ? (
          <Text style={{ color: AppTheme.textSecondary, fontSize: 13 }}>None</Text>
        ) : (
          <>
            {offlineIds.map((id) => (
              <Text key={id} numberOfLines={1} style={{ color: AppTheme.textSecondary, fontSize: 13, paddingVertical: 2 }}>Device {id}</Text>
            ))}
            {affected.length > 0 && (
              <>
                <Text numberOfLines={1} style={{ color: AppTheme.textSecondary, fontSize: 14, fontWeight: 'bold', marginTop: 14, marginBottom: 6 }}>
                  Floors affected
                </Text>
                {affected.map((f) => (
                  <Text key={f.id} numberOfLines={1} style={{ color: AppTheme.textSecondary, fontSize: 13, paddingVertical: 2 }}>{f.floorLabel}</Text>
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
    const cell = { flex: 1, fontSize: 14 } as const;
    return (
      <View style={[styles.bottom, { backgroundColor: AppTheme.card, borderTopColor: AppTheme.divider }]}>
        <Text numberOfLines={1} style={{ width: 120, color: AppTheme.focusAccent, fontWeight: 'bold', fontSize: 15 }}>{f.floorLabel}</Text>
        <View style={{ width: 1, alignSelf: 'stretch', backgroundColor: AppTheme.divider }} />
        <Text style={[cell, { color: AppTheme.textSecondary, paddingLeft: 12 }]}>Devices: {devicesOnline}/{devicesTotal}</Text>
        <Text style={[cell, { color: AppTheme.textSecondary }]}>Sensors: {sensorsOnline}/{sensorsTotal}</Text>
        <Text style={[cell, { color: AppTheme.ok }]}>Online sensors: {sensorsOnline}</Text>
        <Text style={[cell, { color: AppTheme.warn }]}>Offline sensors: {sensorsTotal - sensorsOnline}</Text>
      </View>
    );
  };

  // ---------- fire-alert layout ----------
  const renderFireAlert = () => {
    if (!alertFloor) return null;
    return (
      <View style={{ flex: 1 }}>
        {renderTopBar(true)}
        <View style={{ flex: 1, flexDirection: 'row' }}>
          <View style={styles.fireList}>
            <Text style={{ color: C.redAccent, fontSize: 14, fontWeight: 'bold', padding: 12, paddingTop: 14, paddingBottom: 8 }}>
              Fire Floor
            </Text>
            <FlatList
              data={fireFloorList}
              keyExtractor={(f) => f.id}
              renderItem={({ item, index }) => {
                const sel = index === alertIdx;
                const foc = focusedFloor === 1000 + index;
                return (
                  <Pressable
                    focusable
                    onPress={() => { setSelectedAlertFloorIndex(index); setSelectedKey(null); }}
                    onFocus={() => { setFocusedFloor(1000 + index); if (index !== alertIdx) { setSelectedAlertFloorIndex(index); setSelectedKey(null); } }}
                    onBlur={() => setFocusedFloor((x) => (x === 1000 + index ? null : x))}
                    style={[
                      styles.fireItem,
                      { backgroundColor: foc ? 'rgba(244,67,54,0.25)' : sel ? 'rgba(244,67,54,0.12)' : 'transparent', borderLeftColor: sel || foc ? C.redAccent : 'transparent' },
                    ]}
                  >
                    <Icon name="local-fire-department" size={18} color={C.redAccent} />
                    <Text
                      numberOfLines={1}
                      style={{ flex: 1, marginLeft: 8, fontSize: 15, color: sel ? FIRE_TEXT : FIRE_TEXT2, fontWeight: sel ? 'bold' : 'normal' }}
                    >
                      {item.floorLabel}
                    </Text>
                    {firingSensorsForFloor(manager, item, fireStartTimes).length > 0 && (
                      <View style={styles.countBadge}>
                        <Text style={{ color: C.white, fontSize: 13, fontWeight: 'bold' }}>
                          {firingSensorsForFloor(manager, item, fireStartTimes).length}
                        </Text>
                      </View>
                    )}
                  </Pressable>
                );
              }}
            />
          </View>
          <View style={{ flex: 1 }}>
            <View style={[styles.alertHeader, { backgroundColor: AppTheme.card }]}>
              <Text style={{ color: C.redAccent, fontSize: 14, fontWeight: 'bold' }}>{alertFloor.floorLabel} image</Text>
            </View>
            <View style={{ flex: 1 }}><FloorBody floor={alertFloor} onlyFiring {...floorProps} /></View>
          </View>
        </View>

        <AlertFooter
          floor={alertFloor}
          floors={fireFloorList}
          floorIdx={alertIdx}
          counts={fireFloorList.map((f) => firingSensorsForFloor(manager, f, fireStartTimes).length)}
          sensors={firingSensors}
          selectedKey={selectedKey}
          now={now}
          startTimes={fireStartTimes}
          onGlobal={stepAlertGlobal}
          onFloor={stepAlertFloor}
          onPickFloor={(i) => { setSelectedAlertFloorIndex(i); setSelectedKey(null); }}
          onPickSensor={(i) => setSelectedKey(pinKey(firingSensors[i]))}
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
  selectedKey: string | null;
  focusedDevice: string | null;
  setFocusedDevice: React.Dispatch<React.SetStateAction<string | null>>;
  toggleSelect: (s: PlacedSensor) => void;
  statusTick: number;   // only used to re-render pins as time passes
  dataVersion: number;  // only used to re-render pins when new data arrives
  dark: boolean;        // theme change must repaint the memoised view
  pinSize: number;
}) {
  const { floor, onlyFiring, manager, selectedKey, focusedDevice, setFocusedDevice, toggleSelect } = props;
  const { info, error, isCurrent } = useSvg(floor?.imagePath ?? null);
  const [box, setBox] = useState({ w: 0, h: 0 });
  if (!floor) return <EmptyState />;
  if (error) {
    return (
      <View style={styles.center}>
        <Icon name="broken-image" size={48} color={C.grey} />
        <Text style={{ color: C.grey, fontSize: 15, textAlign: 'center', marginTop: 8 }}>
          {'Floor plan image cannot be opened.\nLoad it again from the Configuration screen.'}
        </Text>
      </View>
    );
  }
  if (!info) return <SvgSpinner />;

  const pins = onlyFiring ? floor.sensors.filter((s) => statusFor(manager, s) === 'fire') : floor.sensors;
  const pinSize = AppSettings.pinSize;
  const rippleBox = pinSize * 3;
  const onLayout = (e: LayoutChangeEvent) => setBox({ w: e.nativeEvent.layout.width, h: e.nativeEvent.layout.height });

  return (
    <FitBox aspect={info.width / info.height} padding={16}>
        <View onLayout={onLayout} style={[styles.floorCanvas, { backgroundColor: C.white }]}>
          <SvgFill xml={info.xml} uri={info.uri} />
          {isCurrent && pins.map((s) => {
            const status = statusFor(manager, s);
            const color = colorForStatus(status);
            const fire = status === 'fire';
            const key = pinKey(s);
            const selected = selectedKey === key;
            const focused = focusedDevice === `pin_${key}`;
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
                <Pressable
                  onPress={() => toggleSelect(s)}
                  onFocus={() => setFocusedDevice(`pin_${key}`)}
                  onBlur={() => setFocusedDevice((f) => (f === `pin_${key}` ? null : f))}
                  style={{
                    width: pinSize, height: pinSize, borderRadius: pinSize / 2, backgroundColor: color,
                    alignItems: 'center', justifyContent: 'center',
                    borderWidth: selected ? 3 : focused ? 2 : 0,
                    borderColor: selected ? C.black : C.teal700,
                    ...(fire ? { shadowColor: C.red, shadowOpacity: 0.6, shadowRadius: 16, elevation: 10 } : null),
                    ...(focused && !selected ? { shadowColor: C.teal700, shadowOpacity: 0.5, shadowRadius: 12, elevation: 6 } : null),
                  }}
                >
                  <Icon
                    name={status === 'offline' ? 'wifi-off' : SensorTypeUi[s.type].icon}
                    size={pinSize * 0.5}
                    color={C.white}
                  />
                </Pressable>
              </View>
            );
          })}
        </View>
    </FitBox>
  );
});

/** Top-bar button that shows a clear ring when reached with the D-pad. */
function IconBtn({ onPress, children }: { onPress: () => void; children: React.ReactNode }) {
  const [foc, setFoc] = useState(false);
  return (
    <Pressable
      focusable
      onPress={onPress}
      onFocus={() => setFoc(true)}
      onBlur={() => setFoc(false)}
      style={[styles.iconBtn, { borderRadius: 8, borderWidth: 2, borderColor: foc ? AppTheme.focusAccent : 'transparent', backgroundColor: foc ? 'rgba(100,255,218,0.12)' : 'transparent' }]}
    >
      {children}
    </Pressable>
  );
}

function SideStat({ label, value }: { label: string; value: string }) {
  return (
    <View style={{ flexDirection: 'row', justifyContent: 'space-between' }}>
      <Text style={{ color: AppTheme.textSecondary, fontSize: 14 }}>{label}</Text>
      <Text style={{ color: AppTheme.textPrimary, fontSize: 14, fontWeight: 'bold' }}>{value}</Text>
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
  sensors: PlacedSensor[];
  selectedKey: string | null;
  now: number;
  startTimes: Map<string, number>;
  onGlobal: (d: number) => void;
  onFloor: (d: number) => void;
  onPickFloor: (i: number) => void;
  onPickSensor: (i: number) => void;
}) {
  const {
    floor,
    floors,
    floorIdx,
    counts,
    sensors,
    selectedKey,
    now,
    startTimes,
  } = props;

  // Fix: use a compatible ref type for React Native Pressable.
  const ref = useRef<any>(null);

  const [self, setSelf] = useState<number | undefined>(undefined);
  const [foc, setFoc] = useState(false);

  useEffect(() => {
    const h = findNodeHandle(ref.current);

    if (h) {
      setSelf(h);
    }

    // Claim remote focus as soon as the alert starts.
    const t = setTimeout(() => {
      ref.current?.requestTVFocus?.();
    }, 80);

    return () => clearTimeout(t);
  }, []);

  useRemoteKeys((k) => {
    if (k === 'right') {
      props.onGlobal(1);
    } else if (k === 'left') {
      props.onGlobal(-1);
    } else if (k === 'down' || k === 'select' || k === 'next') {
      props.onFloor(1);
    } else if (k === 'prev') {
      props.onFloor(-1);
    }
  }, foc);

  const border = foc ? C.white : C.redAccent;

  const wrap = (children: React.ReactNode) => (
    <Pressable
      ref={ref}
      focusable
      hasTVPreferredFocus
      onPress={() => {
        // Navigation keys are handled by useRemoteKeys.
      }}
      onFocus={() => setFoc(true)}
      onBlur={() => setFoc(false)}
      nextFocusDown={self}
      nextFocusLeft={self}
      nextFocusRight={self}
      style={[
        styles.alertFooter,
        {
          borderTopColor: border,
          borderTopWidth: foc ? 3 : 1,
        },
      ]}
    >
      {children}
    </Pressable>
  );

  if (sensors.length === 0) {
    return wrap(
      <View style={[styles.center, { height: 80 }]}>
        <Text style={{ color: FIRE_TEXT2, fontSize: 14 }}>
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

  const totalAlerts = counts.reduce((a, b) => a + b, 0);
  const otherFloorAlerts = totalAlerts - sensors.length;

  const detail = (
    label: string,
    value: string,
    flex: number,
  ) => (
    <View style={[styles.alertDetail, { flex }]}>
      <Text style={{ color: FIRE_TEXT2, fontSize: 12 }}>
        {label}
      </Text>

      <Text
        numberOfLines={2}
        style={{
          color: FIRE_TEXT,
          fontSize: 14,
          fontWeight: '600',
          marginTop: 3,
        }}
      >
        {value === '' ? '-' : value}
      </Text>
    </View>
  );

  const nav = (icon: string, onPress: () => void) => (
    <Pressable
      focusable={false}
      disabled={totalAlerts < 2}
      onPress={onPress}
      style={{ paddingHorizontal: 4 }}
    >
      <Icon
        name={icon}
        size={34}
        color={
          totalAlerts > 1
            ? C.white
            : 'rgba(255,255,255,0.24)'
        }
      />
    </Pressable>
  );

  return wrap(
    <>
      {floors.length > 1 && (
        <View style={styles.chipRow}>
          <Text
            style={{
              color: C.redAccent,
              fontSize: 13,
              fontWeight: 'bold',
              marginRight: 8,
            }}
          >
            FIRE ON:
          </Text>

          {floors.map((f, i) => (
            <Pressable
              key={f.id}
              focusable={false}
              onPress={() => props.onPickFloor(i)}
              style={[
                styles.chip,
                {
                  backgroundColor:
                    i === floorIdx
                      ? C.redAccent
                      : 'rgba(244,67,54,0.15)',
                },
              ]}
            >
              <Text
                style={{
                  color:
                    i === floorIdx ? C.white : FIRE_TEXT,
                  fontSize: 13,
                  fontWeight: '600',
                }}
              >
                {`${f.floorLabel} · ${counts[i]}`}
              </Text>
            </Pressable>
          ))}
        </View>
      )}

      <View
        style={{
          flexDirection: 'row',
          alignItems: 'center',
        }}
      >
        {nav('chevron-left', () => props.onGlobal(-1))}

        <Icon
          name="local-fire-department"
          size={30}
          color={C.redAccent}
        />

        <View style={{ width: 6 }} />

        {detail('Device', cur.name, 3)}
        {detail('Sensor', cur.zoneLabel, 2)}
        {detail('Location', cur.location, 3)}
        {detail(
          'Time',
          formatElapsed(startTimes.get(pinKey(cur)), now),
          1,
        )}

        {cur.notes.trim() !== '' &&
          detail('Notes', cur.notes, 3)}

        {nav('chevron-right', () => props.onGlobal(1))}
      </View>

      <View style={styles.footerInfo}>
        <Text
          style={{
            color: C.redAccent,
            fontSize: 14,
            fontWeight: 'bold',
          }}
        >
          {`${floor.floorLabel}  •  Floor ${
            floorIdx + 1
          } of ${floors.length}  •  Alert ${
            idx + 1
          } of ${sensors.length}`}
        </Text>

        <View style={styles.dots}>
          {sensors.map((s, i) => (
            <Pressable
              key={pinKey(s)}
              focusable={false}
              onPress={() => props.onPickSensor(i)}
              style={[
                styles.dot,
                {
                  width: i === idx ? 22 : 9,
                  backgroundColor:
                    i === idx
                      ? C.redAccent
                      : 'rgba(255,255,255,0.24)',
                },
              ]}
            />
          ))}
        </View>

        {totalAlerts > 1 && (
          <Text
            style={{
              color: FIRE_TEXT2,
              fontSize: 13,
              marginLeft: 12,
            }}
          >
            Left / Right: browse alerts    Down / OK: next floor
            {'    '}CH+ / CH-: floors
          </Text>
        )}

        {otherFloorAlerts > 0 && (
          <Text
            style={{
              color: '#FFAB40',
              fontSize: 13,
              marginLeft: 12,
            }}
          >
            {`+${otherFloorAlerts} on other floors`}
          </Text>
        )}
      </View>
    </>,
  );
}


function EmptyState() {
  return (
    <View style={styles.center}>
      <Icon name="image" size={64} color={C.grey} />
      <Text style={{ color: C.grey, fontSize: 16, marginTop: 12 }}>No floor plan configured yet</Text>
      <Text style={{ color: C.grey, fontSize: 14, marginTop: 4 }}>Load one from the Configuration screen</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  center: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  topBar: { height: 56, paddingHorizontal: 14, flexDirection: 'row', alignItems: 'center', borderBottomWidth: 1 },
  logo: { width: 80, height: 56 },
  topCenter: { position: 'absolute', left: 0, right: 0, top: 0, bottom: 0, alignItems: 'center', justifyContent: 'center' },
  clock: { width: 90, textAlign: 'right', fontSize: 14, lineHeight: 17, fontWeight: '600', marginRight: 10 },
  conn: { paddingHorizontal: 10, paddingVertical: 5, borderRadius: 6, borderWidth: 1, marginRight: 8 },
  iconBtn: { padding: 8, marginLeft: 4 },
  floorCanvas: { flex: 1, borderRadius: 8, overflow: 'hidden' },
  floorTabs: { flex: 1, borderRightWidth: 1, borderBottomWidth: 1 },
  floorHeader: { height: 42, flexDirection: 'row', alignItems: 'center', paddingHorizontal: 12 },
  floorTab: { height: 40, paddingHorizontal: 12, justifyContent: 'center', borderLeftWidth: 3 },
  deviceRow: { paddingHorizontal: 8, paddingVertical: 5, flexDirection: 'row', alignItems: 'center', borderLeftWidth: 3 },
  left: { width: PANEL_WIDTH },
  right: { width: RIGHT_PANEL_WIDTH, flexGrow: 0, flexShrink: 0 },
  hr: { height: 1 },
  bottom: { height: 48, paddingHorizontal: 16, flexDirection: 'row', alignItems: 'center', borderTopWidth: 1 },
  fireList: { width: 190, backgroundColor: FIRE_BG },
  fireItem: { height: 44, paddingHorizontal: 12, flexDirection: 'row', alignItems: 'center', borderLeftWidth: 3 },
  alertHeader: { height: 44, paddingHorizontal: 16, justifyContent: 'center', borderBottomWidth: 1, borderBottomColor: C.redAccent },
  alertFooter: { paddingHorizontal: 8, paddingVertical: 8, backgroundColor: FIRE_BG },
  chipRow: { flexDirection: 'row', alignItems: 'center', flexWrap: 'wrap', marginBottom: 6 },
  chip: { paddingHorizontal: 10, paddingVertical: 4, borderRadius: 12, borderWidth: 1, borderColor: C.redAccent, marginRight: 8, marginBottom: 4 },
  footerInfo: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', flexWrap: 'wrap', marginTop: 6 },
  dots: { flexDirection: 'row', alignItems: 'center', marginLeft: 12 },
  dot: { height: 9, borderRadius: 5, marginHorizontal: 2 },
  countBadge: { backgroundColor: C.redAccent, borderRadius: 10, paddingHorizontal: 7, paddingVertical: 2, marginLeft: 6 },
  alertDetail: { flex: 1, paddingHorizontal: 8, justifyContent: 'center' },
});