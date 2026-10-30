import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  BackHandler, PanResponder, Pressable, StyleSheet, Text, ToastAndroid, View, LayoutChangeEvent,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useNavigation } from '@react-navigation/native';
import {
  pick,
  keepLocalCopy,
  types,
  isErrorWithCode,
  errorCodes,
} from '@react-native-documents/picker';
import { Icon } from '../components/Icon';
import { SvgFill, SvgSpinner, useSvg } from '../components/SvgFloorPlan';
import { FitBox } from '../components/FitBox';
import { AssignSensorDialog, AssignRequest } from '../components/AssignSensorDialog';
import { EditSensorDialog } from '../components/EditSensorDialog';
import { ImageHistorySheet } from '../components/ImageHistorySheet';
import { FocusTrap } from '../components/FocusTrap';
import { ConfigurationStore } from '../services/configurationStore';
import { PlacedSensor, SensorType, SensorTypeUi, SensorZone, zonesForDeviceType } from '../services/configTypes';
import { ModbusRtu } from '../services/modbusRtu';
import { AppSettings, useAppSettings } from '../services/appSettings';
import { useObservable } from '../services/observable';
import { AppTheme } from '../theme/appTheme';
import { C, withOpacity } from '../theme/palette';
import { useRemoteKeys } from '../hooks/useRemoteKeys';

const SENSOR_TYPES: SensorType[] = ['fire', 'temperature'];
const CROSSHAIR_STEP = 0.04;
const clamp01 = (n: number) => Math.min(1, Math.max(0, n));

type Region = 'back' | 'menu' | 'rail' | 'pin' | 'empty' | 'crosshair' | 'error';

type Ghost = { icon: string; color: string; x: number; y: number } | null;

export function ConfigScreen() {
  useAppSettings();
  useObservable(ConfigurationStore);
  const navigation = useNavigation();
  const store = ConfigurationStore;
  const active = store.active;

  const { info, error, retry } = useSvg(active?.imagePath ?? null);
  const [errIdx, setErrIdx] = useState(0);

  // ---------- dialogs ----------
  const [menuOpen, setMenuOpen] = useState(false);
  const [historyOpen, setHistoryOpen] = useState(false);
  const [menuSel, setMenuSel] = useState(0);
  const openMenu = () => { setMenuSel(0); setMenuOpen(true); };
  const activateMenu = (i: number) => {
    setMenuOpen(false);
    if (i === 0) loadImage();
    else setHistoryOpen(true);
  };
  const [assignReq, setAssignReq] = useState<AssignRequest | null>(null);
  const [editing, setEditing] = useState<PlacedSensor | null>(null);

  // ---------- remote (D-pad) state ----------
  const [region, setRegion] = useState<Region>(active ? 'rail' : 'empty');
  const [railIdx, setRailIdx] = useState(0);
  const [pinIdx, setPinIdx] = useState(0);
  const [armed, setArmed] = useState<SensorType | null>(null);
  const [cross, setCross] = useState({ x: 0.5, y: 0.5 });

  useEffect(() => {
    // Only react to the floor plan changing. Depending on `region` here forced
    // the highlight back to the empty / error area on every key press, so the
    // back and menu buttons could never be reached without a floor plan.
    if (!active) setRegion('empty');
    else if (error) { setErrIdx(0); setRegion('error'); }
    else setRegion((r) => (r === 'empty' || r === 'error' ? 'rail' : r));
  }, [active, error]);

  // ---------- canvas geometry ----------
  const [canvas, setCanvas] = useState({ w: 0, h: 0 });
  const canvasRef = useRef<React.ComponentRef<typeof View> | null>(null);
  const rootRef = useRef<React.ComponentRef<typeof View> | null>(null);
  const [ghost, setGhost] = useState<Ghost>(null);

  const onCanvasLayout = (e: LayoutChangeEvent) =>
    setCanvas({ w: e.nativeEvent.layout.width, h: e.nativeEvent.layout.height });

  // ---------- scanned devices / zones ----------
  const scannedSlaveIds = () =>
    ModbusRtu.slaveIds.filter((id) => ModbusRtu.slaveModelMap.has(id)).sort((a, b) => a - b);

  const availableZonesForSlave = useCallback((slaveId: number): SensorZone[] => {
    const type = ModbusRtu.slaveTypeMap.get(slaveId);
    if (!type) return [];
    const placed = new Set(store.sensorsForSlave(slaveId).map((s) => s.zoneAddress));
    return zonesForDeviceType(type).filter((z) => !placed.has(z.address));
  }, [store]);

  const toast = (m: string) => ToastAndroid.show(m, ToastAndroid.SHORT);

  // ---------- load image ----------
const loadImage = async () => {
  try {
    const [res] = await pick({ type: [types.allFiles] });
    if (!res) return;

    const originalName = res.name ?? 'floorplan';
    const lowerName = originalName.toLowerCase();
    const mime = (res.type ?? '').toLowerCase();
    const supportedExt = /\.(svg|png|jpe?g)$/i.exec(lowerName)?.[1]?.toLowerCase();
    const inferredExt = supportedExt ?? (
      mime === 'image/svg+xml' ? 'svg' :
      mime === 'image/png' ? 'png' :
      mime === 'image/jpeg' || mime === 'image/jpg' ? 'jpg' : null
    );
    if (!inferredExt) {
      return toast('Choose an SVG, PNG, JPG, or JPEG floor-plan image');
    }

    // Keep the real extension because the renderer selects SVG vs raster by it.
    const fileName = supportedExt ? originalName : `${originalName}.${inferredExt}`;

    // Persist a private copy so the image survives app restarts.
    const [copy] = await keepLocalCopy({
      files: [{ uri: res.uri, fileName: `${Date.now()}_${fileName}` }],
      destination: 'documentDirectory',
    });

    if (copy.status === 'success') {
      store.addImage(copy.localUri);
    } else {
      toast('Could not save a copy of the file');
    }
  } catch (e) {
    if (!(isErrorWithCode(e) && e.code === errorCodes.OPERATION_CANCELED)) {
      toast('Could not load file');
    }
  }
};

  // ---------- drop / move / tap ----------
  const onSensorDropped = (type: SensorType, fx: number, fy: number) => {
    if (!store.active) return;
    const available = scannedSlaveIds().filter((id) => availableZonesForSlave(id).length > 0);
    if (available.length === 0) {
      return toast(scannedSlaveIds().length === 0
        ? 'No scanned devices yet. Open Devices and run a scan first.'
        : 'Every scanned device already has all its zones pinned');
    }
    setAssignReq({ type, xFraction: fx, yFraction: fy, availableSlaveIds: available });
  };

  const onSensorMoved = (s: PlacedSensor, fx: number, fy: number) =>
    store.addOrUpdateSensor({ ...s, xFraction: fx, yFraction: fy });

  // Convert absolute screen coords -> canvas fraction, if inside the canvas.
  const dropAt = (pageX: number, pageY: number, cb: (fx: number, fy: number) => void) => {
    canvasRef.current?.measureInWindow((x, y, w, h) => {
      if (pageX >= x && pageX <= x + w && pageY >= y && pageY <= y + h) {
        cb(clamp01((pageX - x) / w), clamp01((pageY - y) / h));
      }
    });
  };

  const moveGhost = (g: Ghost) => {
    if (!g) return setGhost(null);
    rootRef.current?.measureInWindow((ox, oy) => setGhost({ ...g, x: g.x - ox, y: g.y - oy }));
  };

  // ---------- crosshair ----------
  /** Why a sensor cannot be placed right now, or null if it can. */
  const placementBlockedReason = (): string | null => {
    if (!store.active) return 'Load a floor plan before placing a sensor';
    // The crosshair needs the canvas on screen to receive the D-pad.
    if (!info) return 'The floor plan is still loading - try again in a moment';
    const ids = scannedSlaveIds();
    if (ids.length === 0) return 'No scanned devices yet. Open Devices and run a scan first.';
    if (!ids.some((id) => availableZonesForSlave(id).length > 0)) return 'Every scanned device already has all its zones pinned';
    return null;
  };

  const armType = (type: SensorType) => {
    const blocked = placementBlockedReason();
    if (blocked) return toast(blocked);
    setArmed(type);
    setCross({ x: 0.5, y: 0.5 });
    setRegion('crosshair');
  };
  const disarm = useCallback(() => {
    setArmed((a) => {
      if (a) { setRailIdx(SENSOR_TYPES.indexOf(a)); setRegion('rail'); }
      return null;
    });
  }, []);

  // Back button cancels crosshair placement before leaving the screen.
  useEffect(() => {
    const sub = BackHandler.addEventListener('hardwareBackPress', () => {
      if (menuOpen) { setMenuOpen(false); return true; }
      if (historyOpen) { setHistoryOpen(false); return true; }
      if (armed) { disarm(); return true; }
      return false;
    });
    return () => sub.remove();
  }, [armed, disarm, menuOpen, historyOpen]);

  const sensors = active?.sensors ?? [];

  useRemoteKeys((key) => {
    if (assignReq || editing || historyOpen) return;

    if (menuOpen) {
      if (key === 'up') setMenuSel(Math.max(0, menuSel - 1));
      else if (key === 'down') setMenuSel(Math.min(1, menuSel + 1));
      else if (key === 'select') activateMenu(menuSel);
      return;
    }

    if (region === 'crosshair' && armed) {
      if (key === 'left') setCross((c) => ({ ...c, x: clamp01(c.x - CROSSHAIR_STEP) }));
      else if (key === 'right') setCross((c) => ({ ...c, x: clamp01(c.x + CROSSHAIR_STEP) }));
      else if (key === 'up') setCross((c) => ({ ...c, y: clamp01(c.y - CROSSHAIR_STEP) }));
      else if (key === 'down') setCross((c) => ({ ...c, y: clamp01(c.y + CROSSHAIR_STEP) }));
      else if (key === 'select') {
        const t = armed;
        const { x, y } = cross;
        disarm();
        onSensorDropped(t, x, y);
      }
      return;
    }

    if (region === 'back') {
      if (key === 'select') navigation.goBack();
      else if (key === 'right') setRegion('menu');
      else if (key === 'down') setRegion(!active ? 'empty' : error ? 'error' : 'rail');
      return;
    }

    if (region === 'menu') {
      if (key === 'select') openMenu();
      else if (key === 'left') setRegion('back');
      else if (key === 'down') setRegion(!active ? 'empty' : error ? 'error' : 'rail');
      return;
    }

    if (region === 'error') {
      if (key === 'left') setErrIdx(Math.max(0, errIdx - 1));
      else if (key === 'right') setErrIdx(Math.min(2, errIdx + 1));
      else if (key === 'up') setRegion('menu');
      else if (key === 'select') {
        if (errIdx === 0) retry();
        else if (errIdx === 1) loadImage();
        else if (active) store.removeImage(active.id);
      }
      return;
    }

    if (region === 'empty') {
      if (key === 'select') loadImage();
      else if (key === 'up') setRegion('menu');
      return;
    }

    if (region === 'rail') {
      if (key === 'select') armType(SENSOR_TYPES[railIdx]);
      else if (key === 'up') railIdx === 0 ? setRegion('menu') : setRailIdx((i) => (i - 1 + SENSOR_TYPES.length) % SENSOR_TYPES.length);
      else if (key === 'down') setRailIdx((i) => (i + 1) % SENSOR_TYPES.length);
      else if (key === 'right' && sensors.length) { setPinIdx(0); setRegion('pin'); }
      return;
    }

    if (region === 'pin') {
      const s = sensors[Math.min(pinIdx, sensors.length - 1)];
      if (!s) return setRegion('rail');
      if (key === 'select') setEditing(s);
      else if (key === 'left') setRegion('rail');
      else if (key === 'down' || key === 'right') setPinIdx((i) => (i + 1) % sensors.length);
      else if (key === 'up') setPinIdx((i) => (i - 1 + sensors.length) % sensors.length);
    }
  });

  // ---------- render ----------
  const pinSize = AppSettings.pinSize;

  const hint =
    armed === null
      ? 'Drag a sensor icon onto the layout, or tap an existing sensor to edit it.\n\nUsing a remote: focus a sensor icon and press Select to place it with the D-pad.'
      : `Placing a ${SensorTypeUi[armed].label} sensor.\n\nUse the D-pad to move the crosshair, Select to drop it here, Back to cancel.`;

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: AppTheme.background }}>
      <View ref={rootRef} style={{ flex: 1 }} collapsable={false}>
        <FocusTrap active={!menuOpen && !historyOpen && !assignReq && !editing} style={{ flex: 1 }}>
        {/* App bar */}
        <View style={[styles.appBar, { backgroundColor: AppTheme.panel }]}>
          <Pressable
            focusable={false}
            onPress={() => navigation.goBack()}
            hitSlop={8}
            style={[styles.menuBtn, region === 'back' && { borderColor: AppTheme.focusAccent, backgroundColor: AppTheme.focusFill }]}
          >
            <Icon name="arrow-back" color={AppTheme.textPrimary} />
          </Pressable>
          <Text style={[styles.appTitle, { color: AppTheme.textPrimary }]}>Configuration</Text>
          <Pressable
            focusable={false}
            onPress={openMenu}
            style={[styles.menuBtn, region === 'menu' && { borderColor: AppTheme.focusAccent, backgroundColor: AppTheme.focusFill }]}
          >
            <Icon name="more-vert" color={AppTheme.textPrimary} />
          </Pressable>
        </View>

        <View style={{ flex: 1, flexDirection: 'row' }}>
          {/* Left rail */}
          <View style={[styles.rail, { backgroundColor: AppTheme.panel }]}>
            {SENSOR_TYPES.map((type, i) => (
              <RailIcon
                key={type}
                type={type}
                focused={region === 'rail' && railIdx === i}
                armed={armed === type}
                onPress={() => armType(type)}
                onDrag={(x, y) => moveGhost({ icon: SensorTypeUi[type].icon, color: C.black, x, y })}
                onDrop={(x, y) => { setGhost(null); dropAt(x, y, (fx, fy) => onSensorDropped(type, fx, fy)); }}
              />
            ))}
          </View>

          {/* Canvas */}
          <View style={{ flex: 1 }}>
            {!active ? (
              <EmptyState focused={region === 'empty'} onLoad={loadImage} />
            ) : error ? (
              <ImageError
                name={active.imagePath.split(/[\\/]/).pop() ?? ''}
                sel={region === 'error' ? errIdx : -1}
                onRetry={retry}
                onLoad={loadImage}
                onRemove={() => store.removeImage(active.id)}
              />
            ) : !info ? (
              <SvgSpinner label="Loading floor plan…" />
            ) : (
              <FitBox aspect={info.width / info.height} padding={20}>
                  <View
                    ref={canvasRef}
                    collapsable={false}
                    onLayout={onCanvasLayout}
                    style={styles.canvas}
                  >
                    <SvgFill xml={info.xml} uri={info.uri} />
                    {sensors.map((s, i) => (
                      <Pin
                        key={`${s.slaveId}_${s.zoneAddress}`}
                        sensor={s}
                        size={pinSize}
                        canvas={canvas}
                        focused={region === 'pin' && pinIdx === i}
                        onTap={() => setEditing(s)}
                        onDrag={(x, y) => moveGhost({ icon: SensorTypeUi[s.type].icon, color: SensorTypeUi[s.type].color, x, y })}
                        onDrop={(x, y) => { setGhost(null); dropAt(x, y, (fx, fy) => onSensorMoved(s, fx, fy)); }}
                      />
                    ))}
                    {armed && (
                      <View
                        pointerEvents="none"
                        style={[styles.cross, { left: cross.x * canvas.w - 15, top: cross.y * canvas.h - 15 }]}
                      >
                        <Icon name={SensorTypeUi[armed].icon} size={16} color={C.orange} />
                      </View>
                    )}
                  </View>
              </FitBox>
            )}
          </View>

          {/* Hint panel */}
          <View style={[styles.hint, { backgroundColor: AppTheme.panel }]}>
            <Text style={{ color: AppTheme.textSecondary, fontSize: 16, lineHeight: 23, textAlign: 'center' }}>{hint}</Text>
          </View>
        </View>

        </FocusTrap>

        {/* Drag ghost */}
        {ghost && (
          <View pointerEvents="none" style={[styles.ghost, { left: ghost.x - 22, top: ghost.y - 22 }]}>
            <Icon name={ghost.icon} size={22} color={ghost.color === C.black ? 'rgba(0,0,0,0.54)' : ghost.color} />
          </View>
        )}
      </View>

      {/* Overflow menu (inline overlay so remote keys keep reaching the app) */}
      {menuOpen && (
        <FocusTrap active style={[StyleSheet.absoluteFill, styles.menuScrim]}>
          <Pressable focusable={false} style={StyleSheet.absoluteFill} onPress={() => setMenuOpen(false)} />
          <View style={[styles.menu, { backgroundColor: AppTheme.card }]}>
            <MenuItem icon="add-photo-alternate" label="Load Floor Plan (SVG/PNG/JPG)" selected={menuSel === 0}
              onPress={() => activateMenu(0)} />
            <MenuItem icon="history" label={`Image History (${store.history.length})`} selected={menuSel === 1}
              onPress={() => activateMenu(1)} />
          </View>
        </FocusTrap>
      )}

      <ImageHistorySheet visible={historyOpen} onClose={() => setHistoryOpen(false)} />

      <AssignSensorDialog
        request={assignReq}
        availableZonesForSlave={availableZonesForSlave}
        onClose={(result) => {
          setAssignReq(null);
          if (result) store.addOrUpdateSensor(result);
        }}
      />

      <EditSensorDialog
        sensor={editing}
        onRemove={(s) => store.removeSensor(s.slaveId, s.zoneAddress)}
        onClose={(result) => {
          setEditing(null);
          if (result) store.addOrUpdateSensor(result);
        }}
      />
    </SafeAreaView>
  );
}

////////////////////////////////////////////////////////////
// Sub-components
////////////////////////////////////////////////////////////

/** Press-and-drag gesture shared by rail icons and existing pins. */
function useDrag(opts: {
  onTap?: () => void;
  onDrag: (pageX: number, pageY: number) => void;
  onDrop: (pageX: number, pageY: number) => void;
}) {
  const o = useRef(opts);
  o.current = opts;
  const dragging = useRef(false);

  return useMemo(
    () =>
      PanResponder.create({
        onStartShouldSetPanResponder: () => true,
        onPanResponderTerminationRequest: () => false,
        onPanResponderMove: (_e, g) => {
          if (!dragging.current && Math.hypot(g.dx, g.dy) > 6) dragging.current = true;
          if (dragging.current) o.current.onDrag(g.moveX, g.moveY);
        },
        onPanResponderRelease: (_e, g) => {
          if (dragging.current) o.current.onDrop(g.moveX, g.moveY);
          else o.current.onTap?.();
          dragging.current = false;
        },
        onPanResponderTerminate: () => {
          dragging.current = false;
          o.current.onDrop(-1, -1);
        },
      }),
    [],
  );
}

function RailIcon(props: {
  type: SensorType; focused: boolean; armed: boolean;
  onPress: () => void; onDrag: (x: number, y: number) => void; onDrop: (x: number, y: number) => void;
}) {
  const pan = useDrag({ onTap: props.onPress, onDrag: props.onDrag, onDrop: props.onDrop });
  const ring = props.armed ? C.orange : props.focused ? AppTheme.focusAccent : 'transparent';
  return (
    <View style={styles.railItem}>
      <View {...pan.panHandlers} style={[styles.railIcon, { borderColor: ring }]}>
        <Icon name={SensorTypeUi[props.type].icon} size={22} color="rgba(0,0,0,0.54)" />
      </View>
      <Text style={{ color: AppTheme.textSecondary, fontSize: 13, marginTop: 4 }}>{SensorTypeUi[props.type].label}</Text>
    </View>
  );
}

function Pin(props: {
  sensor: PlacedSensor; size: number; canvas: { w: number; h: number }; focused: boolean;
  onTap: () => void; onDrag: (x: number, y: number) => void; onDrop: (x: number, y: number) => void;
}) {
  const { sensor, size, canvas, focused } = props;
  const pan = useDrag({ onTap: props.onTap, onDrag: props.onDrag, onDrop: props.onDrop });
  const ui = SensorTypeUi[sensor.type];
  return (
    <View
      {...pan.panHandlers}
      style={{
        position: 'absolute',
        left: sensor.xFraction * canvas.w - size / 2,
        top: sensor.yFraction * canvas.h - size / 2,
        width: size, height: size, borderRadius: size / 2,
        backgroundColor: 'rgba(255,255,255,0.85)',
        alignItems: 'center', justifyContent: 'center',
        borderWidth: focused ? 3 : 0, borderColor: C.teal,
      }}
    >
      <Icon name={ui.icon} size={size * 0.5} color={ui.color} />
    </View>
  );
}

/** Shown when the SVG cannot be read (file moved/deleted, cache cleared by Android, corrupt SVG). */
function ImageError(props: { name: string; sel: number; onRetry: () => void; onLoad: () => void; onRemove: () => void }) {
  const btn = (i: number, icon: string, label: string, onPress: () => void, outlined = false) => (
    <Pressable
      key={label}
      focusable={false}
      onPress={onPress}
      style={[
        styles.loadBtn,
        { marginTop: 0, marginHorizontal: 6 },
        outlined && { backgroundColor: 'transparent', borderColor: C.teal },
        props.sel === i && { borderColor: AppTheme.focusAccent, borderWidth: 3 },
      ]}
    >
      <Icon name={icon} color={C.white} size={18} />
      <Text style={{ color: C.white, marginLeft: 8, fontWeight: '600' }}>{label}</Text>
    </Pressable>
  );
  return (
    <View style={[styles.center, { padding: 24 }]}>
      <Icon name="broken-image" size={56} color={AppTheme.textSecondary} />
      <Text style={{ color: AppTheme.textPrimary, fontSize: 16, fontWeight: '600', marginTop: 12 }}>This floor plan cannot be opened</Text>
      <Text style={{ color: AppTheme.textSecondary, fontSize: 13, lineHeight: 18, textAlign: 'center', marginTop: 6 }}>
        {props.name}{'\n'}The file may have been moved, deleted or cleared by Android.{'\n'}Load it again, or remove it from history.
      </Text>
      <View style={{ flexDirection: 'row', flexWrap: 'wrap', justifyContent: 'center', marginTop: 16 }}>
        {btn(0, 'refresh', 'Retry', props.onRetry)}
        {btn(1, 'add-photo-alternate', 'Load another', props.onLoad)}
        {btn(2, 'delete-outline', 'Remove', props.onRemove, true)}
      </View>
    </View>
  );
}

function EmptyState({ focused, onLoad }: { focused: boolean; onLoad: () => void }) {
  return (
    <View style={styles.center}>
      <Icon name="image" size={64} color={C.grey} />
      <Text style={{ color: C.grey, fontSize: 16, marginTop: 12 }}>No floor plan loaded</Text>
      <Text style={{ color: C.grey, fontSize: 12, marginTop: 4 }}>SVG files only</Text>
      <Pressable
        focusable={false}
        onPress={onLoad}
        style={[styles.loadBtn, focused && { borderWidth: 2, borderColor: AppTheme.focusAccent }]}
      >
        <Icon name="add-photo-alternate" color={C.white} />
        <Text style={{ color: C.white, marginLeft: 8, fontWeight: '600' }}>Load Floor Plan</Text>
      </Pressable>
    </View>
  );
}

const MenuItem = ({ icon, label, onPress, selected }: { icon: string; label: string; onPress: () => void; selected: boolean }) => (
  <Pressable
    focusable={false}
    onPress={onPress}
    style={[styles.menuItem, selected && { backgroundColor: 'rgba(100,255,218,0.12)', borderLeftWidth: 4, borderLeftColor: AppTheme.focusAccent }]}
  >
    <Icon name={icon} color={AppTheme.textPrimary} />
    <Text style={{ color: AppTheme.textPrimary, marginLeft: 16, fontSize: 16 }}>{label}</Text>
  </Pressable>
);

const styles = StyleSheet.create({
  appBar: { height: 56, flexDirection: 'row', alignItems: 'center', paddingHorizontal: 16 },
  appTitle: { flex: 1, fontSize: 20, fontWeight: '500', marginLeft: 16 },
  menuBtn: { padding: 6, borderRadius: 24, marginHorizontal: 4, borderWidth: 2, borderColor: 'transparent' },
  rail: { width: 96, paddingVertical: 24, alignItems: 'center' },
  railIcon: { width: 50, height: 50, borderRadius: 25, backgroundColor: C.white, borderWidth: 3, alignItems: 'center', justifyContent: 'center' },
  railItem: { alignItems: 'center', marginBottom: 20 },
  hint: { width: 220, padding: 24, alignItems: 'center', justifyContent: 'center' },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  loadBtn: { flexDirection: 'row', alignItems: 'center', backgroundColor: C.teal, paddingHorizontal: 18, paddingVertical: 10, borderRadius: 20, marginTop: 16, borderWidth: 2, borderColor: 'transparent' },
  canvas: { flex: 1, backgroundColor: C.white, borderRadius: 8, overflow: 'hidden' },
  cross: { position: 'absolute', width: 30, height: 30, borderRadius: 15, borderWidth: 2, borderColor: C.orange, backgroundColor: withOpacity(C.orange, 0.15), alignItems: 'center', justifyContent: 'center' },
  ghost: { position: 'absolute', width: 44, height: 44, borderRadius: 22, backgroundColor: C.white, alignItems: 'center', justifyContent: 'center', elevation: 8 },
  menuScrim: { backgroundColor: 'rgba(0,0,0,0.3)', alignItems: 'flex-end', paddingTop: 56, paddingRight: 12 },
  menu: { borderRadius: 8, paddingVertical: 8, minWidth: 280, elevation: 8 },
  menuItem: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 16, paddingVertical: 12, borderLeftWidth: 4, borderLeftColor: 'transparent' },
});
