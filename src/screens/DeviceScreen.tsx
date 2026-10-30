import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  ActivityIndicator, FlatList, Pressable, StyleSheet, Text, ToastAndroid, View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useNavigation } from '@react-navigation/native';
import { Icon } from '../components/Icon';
import { DeviceRegisterPreview } from '../components/DeviceRegisterPreview';
import { FocusTrap } from '../components/FocusTrap';
import { InlineDialog } from '../components/InlineDialog';
import { TvSelectField, TvTextField } from '../components/TvFields';
import { FocusButton } from '../components/FocusButton';
import { useRs485 } from '../services/RsContext';
import { useObservable } from '../services/observable';
import { ModbusRtu } from '../services/modbusRtu';
import { DeviceScanning } from '../services/deviceScanning';
import { AppSettings, useAppSettings } from '../services/appSettings';
import { AppTheme } from '../theme/appTheme';
import { C } from '../theme/palette';
import { useRemoteKeys } from '../hooks/useRemoteKeys';

const COLUMNS = 7;
const TOTAL_SLAVES = 31;
const MAX_INDEX = TOTAL_SLAVES + 2;

export function DeviceScreen() {
  useAppSettings();
  const manager = useRs485();
  useObservable(manager.changes);
  const navigation = useNavigation();
  const scanner = useMemo(() => new DeviceScanning(manager), [manager]);

  const [enabled, setEnabled] = useState<Set<number>>(new Set());
  const [models, setModels] = useState<Map<number, string>>(new Map());
  const [isScanning, setIsScanning] = useState(false);
  const [selected, setSelected] = useState(0);
  const [editing, setEditing] = useState<number | null>(null);
  const [, bump] = useState(0);
  const listRef = useRef<FlatList<number>>(null);

  // ---------- load ----------
  useEffect(() => {
    (async () => {
      await ModbusRtu.loadSettings();
      setEnabled(new Set(ModbusRtu.slaveIds));
      setModels(new Map(ModbusRtu.slaveModelMap));
      if (ModbusRtu.slaveIds.length) await manager.applyNewSlaveConfiguration();
    })();
  }, [manager]);

  // ---------- scan ----------
  const toast = (m: string) => ToastAndroid.show(m, ToastAndroid.LONG);

  const startScan = useCallback(async () => {
    if (isScanning) return;

    // Without an open USB/RS485 port the scanner returns instantly, which
    // used to look like the button did nothing. Say why instead.
    if (!manager.port) {
      toast('RS485 adapter not connected. Check the USB cable, then try SCAN again.');
      return;
    }

    setIsScanning(true);
    setEnabled(new Set());
    setModels(new Map());

    let found = 0;
    let failed = false;
    try {
      const detected = await scanner.scanSlaves();
      found = detected.size;
      if (detected.size > 0) {
        const en = new Set(detected.keys());
        const mm = new Map<number, string>();
        detected.forEach((sig, id) => mm.set(id, sig.modelName));
        setEnabled(en);
        setModels(mm);
        ModbusRtu.slaveIds = [...en].sort((a, b) => a - b);
        ModbusRtu.slaveModelMap = new Map(mm);
        await manager.applyNewSlaveConfiguration();
      } else {
        // Nothing answered: the scanner restored the previous configuration,
        // so show that again instead of an empty grid.
        setEnabled(new Set(ModbusRtu.slaveIds));
        setModels(new Map(ModbusRtu.slaveModelMap));
      }
    } catch (e) {
      console.warn('Scan error:', e);
      failed = true;
      setEnabled(new Set(ModbusRtu.slaveIds));
      setModels(new Map(ModbusRtu.slaveModelMap));
    }
    setIsScanning(false);

    if (failed) toast('Scan failed. Check the RS485 connection and try again.');
    else if (found > 0) toast(`Found ${found} device(s).`);
    else if (scanner.lastUnknownCount > 0) {
      toast(`${scanner.lastUnknownCount} device(s) answered but are not a supported model. Previous configuration kept.`);
    } else toast('No devices responded. Check wiring (A/B), baud rate and slave addresses 1-31. Previous configuration kept.');
  }, [isScanning, scanner, manager]);

  // ---------- save ----------
  const saveSettings = useCallback(async () => {
    ModbusRtu.slaveIds = [...enabled].sort((a, b) => a - b);
    ModbusRtu.slaveModelMap = new Map(models);
    await ModbusRtu.saveSettings();
    if (enabled.size) await manager.applyNewSlaveConfiguration();
    navigation.goBack();
  }, [enabled, models, manager, navigation]);

  // ---------- selection ----------
  const updateIndex = (n: number) => {
    const idx = Math.max(0, Math.min(MAX_INDEX, n));
    setSelected(idx);
    const tile = idx - 3;
    if (tile >= 0 && tile < TOTAL_SLAVES) {
      listRef.current?.scrollToIndex({ index: Math.floor(tile / COLUMNS), viewPosition: 0.5, animated: true });
    }
  };

  const openEdit = (slaveId: number) => {
    if (enabled.has(slaveId) && models.has(slaveId)) setEditing(slaveId);
  };

  useRemoteKeys((key) => {
    if (editing !== null) return;
    switch (key) {
      case 'right': return updateIndex(selected + 1);
      case 'left': return updateIndex(selected - 1);
      case 'down': return updateIndex(selected < 3 ? 3 : selected + COLUMNS);
      case 'up':
        return updateIndex(selected >= 3 && selected < 3 + COLUMNS ? 1 : selected - COLUMNS);
      case 'select':
        if (selected === 0) navigation.goBack();
        else if (selected === 1 && !isScanning) startScan();
        else if (selected === 2 && enabled.size > 0) saveSettings();
        else if (selected >= 3) openEdit(selected - 3 + 1);
    }
  }, editing === null);

  // ---------- UI ----------
  const topButton = (index: number, child: React.ReactNode, onPress?: () => void) => (
    <Pressable
      focusable={false}
      onPress={onPress}
      disabled={!onPress}
      style={[styles.topBtn, { backgroundColor: selected === index ? C.orange : AppTheme.panel, opacity: onPress ? 1 : 0.4 }]}
    >
      {child}
    </Pressable>
  );

  const rows = useMemo(() => Array.from({ length: Math.ceil(TOTAL_SLAVES / COLUMNS) }, (_, r) => r), []);

  const renderRow = ({ item: r }: { item: number }) => (
    <View style={styles.row}>
      {Array.from({ length: COLUMNS }, (_, c) => {
        const index = r * COLUMNS + c;
        if (index >= TOTAL_SLAVES) return <View key={c} style={styles.cell} />;
        const slaveId = index + 1;
        const isEnabled = enabled.has(slaveId);
        const isSel = selected === index + 3;
        const canEdit = isEnabled && models.has(slaveId);
        const priority = ModbusRtu.priorityForSlave(slaveId);

        return (
          <View key={c} style={styles.cell}>
            <Pressable
              focusable={false}
              disabled={!canEdit}
              onPress={() => { updateIndex(index + 3); openEdit(slaveId); }}
              style={[
                styles.tile,
                {
                  backgroundColor: isEnabled ? 'rgba(76,175,80,0.15)' : 'rgba(128,128,128,0.06)',
                  borderColor: isSel ? C.orange : 'rgba(128,128,128,0.3)',
                  borderWidth: isSel ? 3 : 1,
                },
              ]}
            >
              <Text style={{ color: isEnabled ? AppTheme.textPrimary : AppTheme.textSecondary, fontWeight: 'bold', fontSize: 13 }}>
                Slave {slaveId}
              </Text>
              <View style={{ height: 4 }} />
              {isScanning && !isEnabled ? (
                <ActivityIndicator size="small" color={C.teal} />
              ) : canEdit ? (
                <View style={{ height: 32, width: '100%' }}>
                  <DeviceRegisterPreview
                    manager={manager}
                    slaveIndex={slaveId - 1}
                    type={ModbusRtu.slaveTypeMap.get(slaveId) ?? 'fsa'}
                  />
                </View>
              ) : null}
              {canEdit && (
                <Text numberOfLines={1} style={{ fontSize: 13, color: AppTheme.textSecondary }}>
                  {models.get(slaveId)}
                </Text>
              )}
            </Pressable>
            {canEdit && priority !== undefined && AppSettings.priorityEnabled && (
              <View style={[styles.badge, { backgroundColor: AppTheme.card }]}>
                <Text style={styles.badgeText}>P{priority}</Text>
              </View>
            )}
          </View>
        );
      })}
    </View>
  );

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: AppTheme.background }}>
      {/* Owns the remote's focus (like Flutter's _screenFocus) so SCAN/OK/Back and the grid always respond. */}
      <FocusTrap active={editing === null} style={{ flex: 1 }}>
      <View style={styles.topBar}>
        {topButton(0, <Icon name="arrow-back" color={AppTheme.textPrimary} />, () => navigation.goBack())}
        <Text style={[styles.title, { color: AppTheme.textPrimary }]}>Devices</Text>
        <View style={{ flexDirection: 'row' }}>
          {topButton(1,
            <Text style={[styles.topBtnText, { color: selected === 1 ? C.black : AppTheme.textPrimary }]}>{isScanning ? 'SCANNING...' : 'SCAN'}</Text>,
            isScanning ? undefined : startScan)}
          <View style={{ width: 10 }} />
          {topButton(2,
            <Text style={[styles.topBtnText, { color: selected === 2 ? C.black : AppTheme.ok }]}>OK</Text>,
            enabled.size === 0 ? undefined : saveSettings)}
        </View>
      </View>

      <FlatList
        ref={listRef}
        data={rows}
        keyExtractor={(r) => String(r)}
        renderItem={renderRow}
        contentContainerStyle={{ paddingHorizontal: 20 }}
        onScrollToIndexFailed={() => {}}
        extraData={[selected, enabled, models, isScanning]}
      />
      </FocusTrap>

      <EditSlaveDialog
        slaveId={editing}
        currentName={editing !== null ? models.get(editing) ?? '' : ''}
        onClose={() => setEditing(null)}
        onSaved={async (id, name, priority) => {
          if (name) setModels((m) => new Map(m).set(id, name));
          if (AppSettings.priorityEnabled) {
            if (priority === null) await ModbusRtu.clearPriorityForSlave(id);
            else await ModbusRtu.setPriorityForSlave(id, priority);
          }
          bump((n) => n + 1);
          setEditing(null);
        }}
      />
    </SafeAreaView>
  );
}

const MAX_PRIORITY = 99;
const PRIORITY_OPTIONS = Array.from({ length: MAX_PRIORITY + 1 }, (_, i) => i);

/**
 * Remote / D-pad friendly:
 *  - Name: press Select to type (keyboard only opens on demand).
 *  - Priority: no keyboard - Left/Right step the number, 0 = none.
 *  - Cancel / Save: normal buttons, Select activates.
 */
function EditSlaveDialog(props: {
  slaveId: number | null;
  currentName: string;
  onClose: () => void;
  onSaved: (slaveId: number, name: string, priority: number | null) => void;
}) {
  useAppSettings();
  const { slaveId, currentName, onClose, onSaved } = props;
  const [name, setName] = useState('');
  const [priority, setPriority] = useState(0);
  const [sel, setSel] = useState(0);          // highlighted item (see indexes below)
  const [typing, setTyping] = useState(false);
  const [editTick, setEditTick] = useState(0); // Select on the name field
  const [claim, setClaim] = useState(0);       // re-take native focus after the keyboard closes
  const priorityEnabled = AppSettings.priorityEnabled;

  // Items, top to bottom: 0 name, [1 priority], Cancel, Save
  const NAME = 0;
  const PRIO = 1;
  const CANCEL = priorityEnabled ? 2 : 1;
  const SAVE = CANCEL + 1;

  useEffect(() => {
    if (slaveId !== null) setSel(NAME);
  }, [slaveId]);

  useEffect(() => {
    if (slaveId !== null) {
      setName(currentName);
      setPriority(Math.min(MAX_PRIORITY, Math.max(0, ModbusRtu.priorityForSlave(slaveId) ?? 0)));
    }
  }, [slaveId, currentName]);

  const save = () => {
    if (slaveId === null) return;
    onSaved(slaveId, name.trim(), priority === 0 ? null : priority);
  };

  // The dialog owns the D-pad itself (a FocusTrap keeps native focus on it), so
  // focus can never wander to the screen underneath or get lost while the
  // priority value changes.
  useRemoteKeys((k) => {
    if (k === 'up') setSel((s) => (s >= CANCEL ? CANCEL - 1 : Math.max(NAME, s - 1)));
    else if (k === 'down') setSel((s) => (s < CANCEL ? s + 1 : s));
    else if (k === 'left') {
      if (priorityEnabled && sel === PRIO) setPriority((p) => Math.max(0, p - 1));
      else if (sel === SAVE) setSel(CANCEL);
    } else if (k === 'right') {
      if (priorityEnabled && sel === PRIO) setPriority((p) => Math.min(MAX_PRIORITY, p + 1));
      else if (sel === CANCEL) setSel(SAVE);
    } else if (k === 'select') {
      if (sel === NAME) setEditTick((t) => t + 1);
      else if (sel === CANCEL) onClose();
      else if (sel === SAVE) save();
    }
  }, slaveId !== null && !typing);

  return (
    <InlineDialog visible={slaveId !== null} onRequestClose={onClose}>
      <FocusTrap active claimKey={claim} style={[StyleSheet.absoluteFill, styles.scrim]}>
        <View style={[styles.dialog, { backgroundColor: AppTheme.card }]}>
          <View style={{ flexDirection: 'row', alignItems: 'center', marginBottom: 14 }}>
            <Icon name="edit-note" size={24} color={C.orange} />
            <Text style={{ color: AppTheme.textPrimary, fontSize: 20, fontWeight: '600', marginLeft: 8 }}>Slave {slaveId}</Text>
          </View>
          <TvTextField
            external
            highlighted={sel === NAME}
            startEdit={editTick}
            onEditingChange={(e) => { setTyping(e); if (!e) setClaim((c) => c + 1); }}
            label="Model name"
            value={name}
            onChangeText={setName}
            returnKeyType="done"
          />
          {priorityEnabled && (
            <View style={{ marginTop: 12 }}>
              <TvSelectField<number>
                external
                highlighted={sel === PRIO}
                label="Priority order  (Left / Right, lower = higher)"
                options={PRIORITY_OPTIONS}
                value={priority}
                labelBuilder={(p) => (p === 0 ? 'None' : String(p))}
                onChange={setPriority}
              />
            </View>
          )}
          <View style={styles.actions}>
            <FocusButton label="Cancel" highlighted={sel === CANCEL} onPress={onClose} />
            <FocusButton label="Save" variant="primary" highlighted={sel === SAVE} onPress={save} />
          </View>
        </View>
      </FocusTrap>
    </InlineDialog>
  );
}

const styles = StyleSheet.create({
  topBar: { height: 65, paddingHorizontal: 20, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  title: { fontSize: 26, fontWeight: 'bold' },
  topBtn: { paddingHorizontal: 14, paddingVertical: 8, borderRadius: 8 },
  topBtnText: { fontSize: 18, fontWeight: 'bold' },
  row: { flexDirection: 'row' },
  cell: { flex: 1, aspectRatio: 1.2, padding: 4 },
  tile: { flex: 1, borderRadius: 12, padding: 6, alignItems: 'center', justifyContent: 'center' },
  badge: { position: 'absolute', top: 8, right: 8, paddingHorizontal: 6, paddingVertical: 2, borderRadius: 6, borderWidth: 1, borderColor: C.orange },
  badgeText: { color: C.orange, fontSize: 11, fontWeight: 'bold' },
  scrim: { flex: 1, backgroundColor: 'rgba(0,0,0,0.6)', justifyContent: 'center', alignItems: 'center' },
  dialog: { width: '70%', maxWidth: 460, borderRadius: 16, padding: 20 },
  actions: { flexDirection: 'row', justifyContent: 'flex-end', alignItems: 'center', marginTop: 20 },
});
