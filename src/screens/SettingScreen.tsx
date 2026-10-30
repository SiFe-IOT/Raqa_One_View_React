import React, { useEffect, useRef, useState } from 'react';
import { BackHandler, findNodeHandle, NativeScrollEvent, NativeSyntheticEvent, Pressable, ScrollView, StyleSheet, Switch, Text, ToastAndroid, View } from 'react-native';
import Clipboard from '@react-native-clipboard/clipboard';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useNavigation } from '@react-navigation/native';
import { Icon } from '../components/Icon';
import { FocusTrap } from '../components/FocusTrap';
import { InlineDialog } from '../components/InlineDialog';
import { TvTextField } from '../components/TvFields';
import { FocusButton } from '../components/FocusButton';
import { AppSettings, useAppSettings } from '../services/appSettings';
import { ModbusRtu } from '../services/modbusRtu';
import { AppTheme } from '../theme/appTheme';
import { C } from '../theme/palette';
import { useRemoteKeys } from '../hooks/useRemoteKeys';

const PIN_STEP = 2;
const PIN_MIN = 10;
// Must not exceed the fixed preview box (styles.pinPreview) or the row height changes.
const PIN_MAX = 60;

// Flip to true to show the System section (Backup / Reset Password).
const SHOW_SYSTEM = false;

const clampPin = (v: number) => Math.min(PIN_MAX, Math.max(PIN_MIN, v));

/** Focusable row with a visible D-pad focus highlight. */
function FocusRow({ onPress, style, children, autoFocus, blocked }: { onPress?: () => void; style?: any; children: React.ReactNode; autoFocus?: boolean; blocked?: boolean }) {
  const [foc, setFoc] = useState(false);
  return (
    <Pressable
      focusable={!blocked}
      hasTVPreferredFocus={autoFocus && !blocked}
      onPress={onPress}
      onFocus={() => setFoc(true)}
      onBlur={() => setFoc(false)}
      style={[style, { borderLeftWidth: 4, borderLeftColor: foc ? AppTheme.focusAccent : 'transparent', backgroundColor: foc ? AppTheme.focusFill : 'transparent' }]}
    >
      {children}
    </Pressable>
  );
}

/*
 * These MUST live outside SettingScreen. When they were declared inside it,
 * every re-render (e.g. each pin-size step) created a brand-new component
 * type, React remounted all rows, and the Dark Mode row's auto-focus pulled
 * the remote's focus back to the top of the list.
 */
function SettingRow(p: {
  icon: string; iconColor: string; title: string; subtitle: string;
  value?: boolean; onChange?: (v: boolean) => void; onPress?: () => void;
  autoFocus?: boolean; blocked?: boolean;
}) {
  return (
    <FocusRow
      autoFocus={p.autoFocus}
      blocked={p.blocked}
      onPress={p.onChange ? () => p.onChange!(!p.value) : p.onPress}
      style={styles.row}
    >
      <Icon name={p.icon} size={24} color={p.iconColor} />
      <View style={styles.rowText}>
        <Text style={{ color: AppTheme.textPrimary, fontSize: 17 }}>{p.title}</Text>
        <Text style={{ color: AppTheme.textSecondary, fontSize: 13 }}>{p.subtitle}</Text>
      </View>
      {p.onChange && (
        // The row itself is the remote-focusable target (Select toggles it).
        <Switch focusable={false} value={!!p.value} onValueChange={p.onChange} trackColor={{ true: C.teal, false: undefined }} />
      )}
    </FocusRow>
  );
}

const Divider = () => <View style={{ height: 1, backgroundColor: AppTheme.divider }} />;
const Header = ({ t }: { t: string }) => <Text style={[styles.header, { color: AppTheme.focusAccent }]}>{t.toUpperCase()}</Text>;

/**
 * In-screen app bar (same look as ConfigScreen) instead of the native header.
 * The back button lives in the screen, so it can be disabled while a dialog is
 * open and can never steal the remote's focus from it.
 */
function AppBar({ title, disabled }: { title: string; disabled: boolean }) {
  const navigation = useNavigation();
  const [foc, setFoc] = useState(false);
  return (
    <View style={[styles.appBar, { backgroundColor: AppTheme.panel }]}>
      <Pressable
        focusable={!disabled}
        onPress={() => navigation.goBack()}
        onFocus={() => setFoc(true)}
        onBlur={() => setFoc(false)}
        hitSlop={8}
        style={[styles.menuBtn, foc && { borderColor: AppTheme.focusAccent, backgroundColor: AppTheme.focusFill }]}
      >
        <Icon name="arrow-back" color={AppTheme.textPrimary} />
      </Pressable>
      <Text style={[styles.appTitle, { color: AppTheme.textPrimary }]}>{title}</Text>
    </View>
  );
}

export function SettingScreen() {
  useAppSettings();
  const navigation = useNavigation();
  const [pinFocused, setPinFocused] = useState(false);
  // Pin the native focus in place for Left/Right. Without this Android also
  // moves focus sideways (e.g. to the header back button) on every press,
  // which made the size jump and the focus disappear.
  const pinBoxRef = useRef<React.ElementRef<typeof Pressable>>(null);
  const [pinSelf, setPinSelf] = useState<number | undefined>(undefined);
  useEffect(() => {
    const h = findNodeHandle(pinBoxRef.current);
    if (h) setPinSelf(h);
  }, []);
  const [backupJson, setBackupJson] = useState<string | null>(null);
  const [pwOpen, setPwOpen] = useState(false);
  const overlayOpen = backupJson !== null || pwOpen;

  // On open, Android briefly focuses the first focusable view (back button /
  // ScrollView) and draws a black default focus box before hasTVPreferredFocus
  // moves focus to Dark Mode. Keep the back button unfocusable for a moment so
  // Dark Mode gets the very first focus.
  const [ready, setReady] = useState(false);
  useEffect(() => {
    const t = setTimeout(() => setReady(true), 400);
    return () => clearTimeout(t);
  }, []);

  // The native header's back button is focusable and can steal the remote's
  // focus from a dialog (e.g. after the keyboard closes). Hide the header and
  // use the in-screen AppBar instead.
  useEffect(() => {
    navigation.setOptions({ headerShown: false });
  }, [navigation]);

  const adjustPin = (d: number) => {
    const currentSize = AppSettings.pinSize;
    const nextSize = clampPin(currentSize + d);
    if (nextSize !== currentSize) {
      AppSettings.setPinSize(nextSize);
    }
  };

  // Left/Right adjust pin size only while that control has focus; up/down
  // are not consumed so normal focus traversal still works.
  useRemoteKeys((k) => {
    if (!pinFocused) return;
    if (k === 'right') adjustPin(PIN_STEP);
    if (k === 'left') adjustPin(-PIN_STEP);
  }, pinFocused);

  const obj = (m: Map<number, any>) => Object.fromEntries([...m.entries()].map(([k, v]) => [String(k), v]));
  const showBackup = () =>
    setBackupJson(
      JSON.stringify(
        {
          slaveIds: ModbusRtu.slaveIds,
          slaveNames: obj(ModbusRtu.slaveNames),
          slaveModels: obj(ModbusRtu.slaveModelMap),
          slaveTypes: obj(ModbusRtu.slaveTypeMap),
          slavePriorities: obj(ModbusRtu.slavePriorityMap),
          baudRate: ModbusRtu.baudRate,
          pollIntervalMs: ModbusRtu.pollIntervalMs,
        },
        null,
        2,
      ),
    );

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: AppTheme.background }}>
      <AppBar title="Settings" disabled={overlayOpen || !ready} />
      <ScrollView focusable={false} style={{ flex: 1 }}>
        <Header t="Appearance" />
        <SettingRow blocked={overlayOpen} autoFocus icon="dark-mode" iconColor={AppTheme.focusAccent} title="Dark Mode"
          subtitle="Use a dark color scheme across the whole app"
          value={AppSettings.darkModeEnabled} onChange={(v) => AppSettings.setDarkModeEnabled(v)} />
        <Divider />

        <Header t="Alarm" />
        <SettingRow blocked={overlayOpen} icon="campaign" iconColor={C.orange} title="Siren" subtitle="Turn the siren output on or off"
          value={AppSettings.sirenEnabled} onChange={(v) => AppSettings.setSirenEnabled(v)} />
        <Divider />

        <Header t="Devices" />
        <SettingRow blocked={overlayOpen} icon="low-priority" iconColor={AppTheme.focusAccent} title="Priority"
          subtitle="Show the priority badge on the Devices screen"
          value={AppSettings.priorityEnabled} onChange={(v) => AppSettings.setPriorityEnabled(v)} />
        <Divider />

        <Header t="Dashboard" />
        <Pressable
          ref={pinBoxRef}
          focusable={!overlayOpen}
          nextFocusLeft={pinSelf}
          nextFocusRight={pinSelf}
          onFocus={() => setPinFocused(true)}
          onBlur={() => setPinFocused(false)}
          style={[
            styles.pinBox,
            {
              borderWidth: 2,
              borderRadius: 10,
              borderColor: pinFocused ? AppTheme.focusAccent : AppTheme.divider,
              backgroundColor: pinFocused ? AppTheme.focusFill : 'transparent',
            },
          ]}
        >
          <Icon name="control-camera" size={24} color={AppTheme.focusAccent} />
          <View style={styles.rowText}>
            <Text style={{ color: AppTheme.textPrimary, fontSize: 16 }}>Sensor pin size</Text>
            <Text style={{ color: AppTheme.textSecondary, fontSize: 12 }}>Use Left / Right to adjust</Text>
          </View>
          {/* Live preview at the real size, in a fixed box so the row never changes height. */}
          <View style={styles.pinPreview}>
            <View style={{ width: AppSettings.pinSize, height: AppSettings.pinSize, borderRadius: AppSettings.pinSize / 2, backgroundColor: C.red, alignItems: 'center', justifyContent: 'center' }}>
              <Icon name="local-fire-department" size={AppSettings.pinSize * 0.5} color={C.white} />
            </View>
          </View>
          <Pressable focusable={false} onPress={() => adjustPin(-PIN_STEP)} hitSlop={8}>
            <Icon name="chevron-left" size={28} color={AppTheme.textPrimary} />
          </Pressable>
          <Text style={[styles.pinValue, { color: AppTheme.focusAccent }]}>
            {Math.round(AppSettings.pinSize)}px
          </Text>
          <Pressable focusable={false} onPress={() => adjustPin(PIN_STEP)} hitSlop={8}>
            <Icon name="chevron-right" size={28} color={AppTheme.textPrimary} />
          </Pressable>
        </Pressable>
        <Divider />

        {SHOW_SYSTEM && (
          <>
            <Header t="System" />
            <SettingRow blocked={overlayOpen} icon="backup" iconColor={AppTheme.focusAccent} title="Backup" subtitle="Export the current device configuration" onPress={showBackup} />
            <SettingRow blocked={overlayOpen} icon="lock-reset" iconColor={C.orange} title="Reset Password" subtitle="Change the app-lock password" onPress={() => setPwOpen(true)} />
          </>
        )}

        <Header t="App" />
        <SettingRow
          blocked={overlayOpen}
          icon="exit-to-app"
          iconColor={C.red}
          title="Exit"
          subtitle="Close the app"
          onPress={() => BackHandler.exitApp()}
        />
        <Divider />
      </ScrollView>

      <BackupOverlay json={backupJson} onClose={() => setBackupJson(null)} />
      <PasswordDialog visible={pwOpen} onClose={() => setPwOpen(false)} />
    </SafeAreaView>
  );
}

/**
 * Backup JSON viewer. Up/Down scroll the text on the remote; at the top/bottom
 * edge they fall through to the Close / Copy buttons (Left/Right switch buttons).
 */
function BackupOverlay({ json, onClose }: { json: string | null; onClose: () => void }) {
  const scrollRef = useRef<React.ElementRef<typeof ScrollView>>(null);
  const metrics = useRef({ y: 0, content: 0, view: 0 });
  const [focus, setFocus] = useState<'scroll' | 'close' | 'copy'>('scroll');
  const STEP = 120;

  const copy = () => {
    Clipboard.setString(json ?? '');
    ToastAndroid.show('Copied to clipboard', ToastAndroid.SHORT);
  };

  const scrollBy = (d: number) => {
    const m = metrics.current;
    const max = Math.max(0, m.content - m.view);
    const y = Math.min(max, Math.max(0, m.y + d));
    m.y = y;
    scrollRef.current?.scrollTo({ y, animated: false });
  };

  useRemoteKeys((k) => {
    const m = metrics.current;
    const max = Math.max(0, m.content - m.view);
    if (focus === 'scroll') {
      if (k === 'down') { if (m.y >= max - 1) setFocus('close'); else scrollBy(STEP); }
      else if (k === 'up') { if (m.y > 0) scrollBy(-STEP); }
    } else {
      if (k === 'up') setFocus('scroll');
      else if (k === 'left') setFocus('close');
      else if (k === 'right') setFocus('copy');
      else if (k === 'select') { if (focus === 'close') onClose(); else copy(); }
    }
  }, json !== null);

  // reopen at the top with the text focused
  useEffect(() => { if (json !== null) { metrics.current.y = 0; setFocus('scroll'); } }, [json]);

  if (json === null) return null;
  return (
    <InlineDialog visible onRequestClose={onClose}>
      <FocusTrap style={[StyleSheet.absoluteFill, styles.scrim]}>
        <View style={[styles.dialog, { backgroundColor: AppTheme.card }]}>
          <Text style={[styles.dialogTitle, { color: AppTheme.textPrimary }]}>Backup</Text>
          <View style={[styles.jsonBox, { borderColor: focus === 'scroll' ? C.orange : 'transparent' }]}>
            <ScrollView
              ref={scrollRef}
              focusable={false}
              style={{ maxHeight: 280 }}
              onScroll={(e: NativeSyntheticEvent<NativeScrollEvent>) => { metrics.current.y = e.nativeEvent.contentOffset.y; }}
              scrollEventThrottle={16}
              onContentSizeChange={(_, h) => { metrics.current.content = h; }}
              onLayout={(e) => { metrics.current.view = e.nativeEvent.layout.height; }}
            >
              <Text style={{ fontFamily: 'monospace', fontSize: 12, color: AppTheme.textPrimary }}>{json}</Text>
            </ScrollView>
          </View>
          <View style={styles.actions}>
            <Pressable focusable={false} onPress={onClose} style={[styles.linkBtn, focus === 'close' && { borderWidth: 2, borderColor: AppTheme.focusAccent }]}>
              <Text style={[styles.link, { color: AppTheme.focusAccent }]}>Close</Text>
            </Pressable>
            <Pressable focusable={false} style={[styles.btn, focus === 'copy' && { borderWidth: 2, borderColor: AppTheme.textPrimary }]} onPress={copy}>
              <Text style={styles.btnText}>Copy</Text>
            </Pressable>
          </View>
        </View>
      </FocusTrap>
    </InlineDialog>
  );
}

/**
 * Remote-friendly password dialog: TvTextField (keyboard opens only on Select).
 * Digits only - the lock screen's on-screen keypad has digits 0-9 and nothing
 * else, so a password with letters could never be entered again with a remote.
 *
 * NOTE: AppSettings.password is compared in plain text here. If this is a real
 * app lock, store a hash (or use the Android Keystore) inside AppSettings and
 * compare against that instead.
 */
function PasswordDialog({ visible, onClose }: { visible: boolean; onClose: () => void }) {
  useAppSettings();
  const [cur, setCur] = useState('');
  const [nw, setNw] = useState('');
  const [conf, setConf] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [sel, setSel] = useState(0);
  const [typing, setTyping] = useState(false);
  const [ticks, setTicks] = useState([0, 0, 0]); // Select pressed on field i
  const [claim, setClaim] = useState(0);         // re-take native focus after the keyboard closes
  const hasCurrent = AppSettings.password.length > 0;

  // Items, top to bottom: [current], new, confirm, Cancel, Save
  const FIELDS = hasCurrent ? 3 : 2;
  const CANCEL = FIELDS;
  const SAVE = FIELDS + 1;
  const first = hasCurrent ? 0 : 1; // index into cur/nw/conf of the first visible field

  const reset = () => { setCur(''); setNw(''); setConf(''); setError(null); setSel(0); onClose(); };

  useEffect(() => { if (visible) setSel(0); }, [visible]);

  const save = async () => {
    if (hasCurrent && cur !== AppSettings.password) return setError('Current password is incorrect');
    if (!nw) return setError('New password cannot be empty');
    if (nw !== conf) return setError('Passwords do not match');
    await AppSettings.setPassword(nw);
    reset();
  };

  // The dialog owns the D-pad itself (a FocusTrap keeps native focus on it), so
  // focus can never fall through to the Settings list underneath.
  useRemoteKeys((k) => {
    if (k === 'up') setSel((x) => (x >= CANCEL ? FIELDS - 1 : Math.max(0, x - 1)));
    else if (k === 'down') setSel((x) => (x < CANCEL ? x + 1 : x));
    else if (k === 'left') { if (sel === SAVE) setSel(CANCEL); }
    else if (k === 'right') { if (sel === CANCEL) setSel(SAVE); }
    else if (k === 'select') {
      if (sel < FIELDS) setTicks((t) => t.map((v, i) => (i === first + sel ? v + 1 : v)));
      else if (sel === CANCEL) reset();
      else if (sel === SAVE) save();
    }
  }, visible && !typing);

  const field = (idx: number, label: string, value: string, set: (v: string) => void) => {
    const pos = idx - first; // position in the visible list
    return (
      <TvTextField
        external
        highlighted={sel === pos}
        startEdit={ticks[idx]}
        onEditingChange={(e) => { setTyping(e); if (!e) setClaim((c) => c + 1); }}
        onSubmit={() => setSel(pos + 1 >= FIELDS ? SAVE : pos + 1)}
        label={label}
        value={value}
        onChangeText={set}
        secure
        numeric
        digitsOnly
        // 'next' makes Android move its OWN focus forward, out of the dialog and
        // onto the Settings page underneath. The dialog advances the highlight itself.
        returnKeyType="done"
      />
    );
  };

  return (
    <InlineDialog visible={visible} onRequestClose={reset}>
      <FocusTrap active claimKey={claim} style={[StyleSheet.absoluteFill, styles.scrim]}>
        <View style={[styles.dialog, { backgroundColor: AppTheme.card }]}>
          <Text style={[styles.dialogTitle, { color: AppTheme.textPrimary }]}>Reset Password</Text>
          {hasCurrent && (
            <>
              {field(0, 'Current password', cur, setCur)}
              <View style={{ height: 12 }} />
            </>
          )}
          {field(1, 'New password (digits only)', nw, setNw)}
          <View style={{ height: 12 }} />
          {field(2, 'Confirm new password', conf, setConf)}
          {error && <Text style={{ color: AppTheme.danger, marginTop: 8 }}>{error}</Text>}
          <View style={styles.actions}>
            <FocusButton label="Cancel" highlighted={sel === CANCEL} onPress={reset} />
            <FocusButton label="Save" variant="primary" highlighted={sel === SAVE} onPress={save} />
          </View>
        </View>
      </FocusTrap>
    </InlineDialog>
  );
}

const styles = StyleSheet.create({
  appBar: { height: 56, flexDirection: 'row', alignItems: 'center', paddingHorizontal: 16 },
  appTitle: { flex: 1, fontSize: 20, fontWeight: '500', marginLeft: 16 },
  menuBtn: { padding: 6, borderRadius: 24, marginHorizontal: 4, borderWidth: 2, borderColor: 'transparent' },
  header: { fontSize: 13, fontWeight: 'bold', letterSpacing: 1.1, paddingHorizontal: 16, paddingTop: 16, paddingBottom: 4 },
  row: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 16, paddingVertical: 12 },
  rowText: { flex: 1, marginLeft: 16 },
  pinBox: { flexDirection: 'row', alignItems: 'center', marginHorizontal: 16, marginVertical: 4, paddingHorizontal: 12, paddingVertical: 10, borderRadius: 10 },
  pinPreview: { width: PIN_MAX, height: PIN_MAX, alignItems: 'center', justifyContent: 'center', marginRight: 8 },
  pinValue: { width: 54, textAlign: 'center', fontWeight: 'bold' },
  scrim: { flex: 1, backgroundColor: 'rgba(0,0,0,0.6)', justifyContent: 'center', alignItems: 'center' },
  dialog: { width: '80%', maxWidth: 480, borderRadius: 16, padding: 20 },
  dialogTitle: { fontSize: 20, fontWeight: '600', marginBottom: 12 },
  actions: { flexDirection: 'row', justifyContent: 'flex-end', alignItems: 'center', marginTop: 16 },
  link: { fontSize: 15, marginRight: 20 },
  btn: { backgroundColor: C.teal, paddingHorizontal: 16, paddingVertical: 8, borderRadius: 8, borderWidth: 2, borderColor: 'transparent' },
  btnText: { color: C.white, fontWeight: '600' },
  linkBtn: { paddingHorizontal: 8, paddingVertical: 6, borderRadius: 8, marginRight: 12, borderWidth: 2, borderColor: 'transparent' },
  jsonBox: { borderWidth: 3, borderRadius: 8, padding: 8 },
});