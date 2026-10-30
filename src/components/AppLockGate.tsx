import React, { useEffect, useRef, useState } from 'react';
import { findNodeHandle, Pressable, ScrollView, StyleSheet, Text, useWindowDimensions, View } from 'react-native';
import { useNavigation } from '@react-navigation/native';
import { Icon } from './Icon';
import { AppSettings, useAppSettings } from '../services/appSettings';
import { AppTheme } from '../theme/appTheme';
import { C } from '../theme/palette';
import { useKeyboardKeys, useRemoteKeys } from '../hooks/useRemoteKeys';

// Flat selection index: 0-8 digits 1-9, 9 Clear, 10 digit 0, 11 Backspace, 12 Unlock, 13 Cancel
const CLEAR = 9, ZERO = 10, BACKSPACE = 11, UNLOCK = 12, CANCEL = 13, COLS = 3;

export function AppLockGate({ children }: { children: React.ReactNode }) {
  useAppSettings();
  const navigation = useNavigation();
  const { height } = useWindowDimensions();
  // Shrink the keys on short screens so Unlock / Cancel never fall off-screen.
  const keyH = Math.max(40, Math.min(64, Math.floor((height - 340) / 4)));
  const [locked, setLocked] = useState(AppSettings.password.length > 0);
  const [pin, setPin] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [sel, setSelState] = useState(0);

  // Mirrors of state so key handlers never read stale values and never need
  // side effects inside state updaters (updaters may run twice, which made one
  // key press act twice and walk onto Cancel).
  // Native focus trap (equivalent of Flutter's autofocused Focus node).
  // Every tile is non-focusable, so without a focus owner Android TV hands
  // focus (and the Select key) to the screens hidden underneath, e.g. the
  // first Home card = Dashboard. That was the "any key opens Dashboard" bug.
  const trapRef = useRef<View>(null);
  const [trap, setTrap] = useState<number | undefined>(undefined);
  useEffect(() => {
    const h = findNodeHandle(trapRef.current);
    if (h) setTrap(h);
  }, [locked]);

  const selRef = useRef(0);
  const pinRef = useRef('');
  const setSel = (n: number) => { selRef.current = n; setSelState(n); };
  const setPinBoth = (v: string) => { pinRef.current = v; setPin(v); };

  const append = (d: string) => { setPinBoth(pinRef.current + d); setError(null); };
  const backspace = () => {
    if (!pinRef.current) return;
    setPinBoth(pinRef.current.slice(0, -1)); setError(null);
  };
  const clear = () => {
    if (!pinRef.current) return;
    setPinBoth(''); setError(null);
  };
  // Navigator.maybePop equivalent
  const cancel = () => {
    if (navigation.canGoBack()) navigation.goBack();
    else (navigation as any).navigate('Home');
  };
  const unlock = () => {
    if (pinRef.current === AppSettings.password) { setLocked(false); setError(null); setPinBoth(''); }
    else setError('Incorrect password');
  };

  const activate = (i: number) => {
    switch (i) {
      case CLEAR: return clear();
      case ZERO: return append('0');
      case BACKSPACE: return backspace();
      case UNLOCK: return unlock();
      case CANCEL: return cancel();
      default: if (i >= 0 && i <= 8) append(String(i + 1));
    }
  };

  const move = (n: number) => { if (n >= 0 && n <= CANCEL) setSel(n); };

  // Same movement rules as the Flutter _handleKeyEvent.
  useRemoteKeys((key) => {
    const s = selRef.current;
    const inGrid = s <= 8;
    const inBottomRow = s >= CLEAR && s <= BACKSPACE;
    switch (key) {
      case 'right':
        if (inGrid) { if (s % COLS < COLS - 1) move(s + 1); }
        else if (inBottomRow) { if (s < BACKSPACE) move(s + 1); }
        return;
      case 'left':
        if (inGrid) { if (s % COLS > 0) move(s - 1); }
        else if (inBottomRow) { if (s > CLEAR) move(s - 1); }
        return;
      case 'down':
        if (inGrid) move(s + COLS);
        else if (inBottomRow) move(UNLOCK);
        else if (s === UNLOCK) move(CANCEL);
        return;
      case 'up':
        if (inBottomRow) move(s - COLS);
        else if (s >= 3 && s <= 8) move(s - COLS);
        else if (s === UNLOCK) move(ZERO);
        else if (s === CANCEL) move(UNLOCK);
        return;
      case 'select':
        activate(s);
    }
  }, locked);

  // Physical / Bluetooth keyboard fast path (digits, Backspace, Escape).
  useKeyboardKeys((k) => {
    if (k === 'backspace') backspace();
    else if (k === 'escape') cancel();
    else append(k.digit);
  }, locked);

  if (!locked) return <>{children}</>;

  const keyTile = (index: number, label?: string, icon?: string, onTap?: () => void) => {
    const on = sel === index;
    return (
      <Pressable
        key={index}
        focusable={false}
        style={[styles.key, { backgroundColor: on ? C.teal700 : AppTheme.panel, borderColor: on ? AppTheme.focusAccent : 'transparent' }]}
        onPress={() => { move(index); (onTap ?? (() => append(label!)))(); }}
      >
        {icon ? (
          <Icon name={icon} size={20} color={on ? C.white : AppTheme.textPrimary} />
        ) : (
          <Text style={[styles.keyText, { color: on ? C.white : AppTheme.textPrimary }]}>{label}</Text>
        )}
      </Pressable>
    );
  };

  const actionTile = (index: number, label: string, onTap: () => void, filled: boolean) => {
    const on = sel === index;
    const bg = filled ? (on ? C.teal400 : C.teal700) : on ? AppTheme.panel : 'transparent';
    return (
      <Pressable
        focusable={false}
        style={[styles.action, { backgroundColor: bg, borderColor: on ? C.tealAccent : 'transparent' }]}
        onPress={() => { move(index); onTap(); }}
      >
        <Text style={[styles.actionText, { color: filled ? C.white : AppTheme.textSecondary }]}>{label}</Text>
      </Pressable>
    );
  };

  const tiles = [
    ...Array.from({ length: 9 }, (_, i) => keyTile(i, String(i + 1))),
    keyTile(CLEAR, 'C', undefined, clear),
    keyTile(ZERO, '0'),
    keyTile(BACKSPACE, undefined, 'backspace', backspace),
  ];

  return (
    <Pressable
      ref={trapRef}
      focusable
      hasTVPreferredFocus
      onPress={() => { /* keys are handled by useRemoteKeys */ }}
      nextFocusUp={trap}
      nextFocusDown={trap}
      nextFocusLeft={trap}
      nextFocusRight={trap}
      style={[styles.root, { backgroundColor: AppTheme.background }]}
    >
      <ScrollView focusable={false} contentContainerStyle={styles.scroll}>
        <View style={styles.box}>
          <View style={{ alignItems: 'center' }}>

          <Icon name="lock" size={40} color={AppTheme.focusAccent} />
          <Text style={[styles.title, { color: AppTheme.textPrimary }]}>Locked</Text>
          </View>
          <Text style={{ color: error ? AppTheme.danger : AppTheme.textSecondary, fontSize: 13, marginBottom: 4 }}>PIN</Text>
          <View style={[styles.field, { borderColor: error ? AppTheme.danger : AppTheme.divider }]}>
            <Text style={{ color: AppTheme.textPrimary, fontSize: 20, letterSpacing: 4 }}>
              {pin.length ? '•'.repeat(pin.length) : ' '}
            </Text>
          </View>
          {error && <Text style={[styles.error, { color: AppTheme.danger }]}>{error}</Text>}
          <View style={styles.grid}>{tiles.map((t, i) => <View key={i} style={[styles.cell, { height: keyH }]}>{t}</View>)}</View>
          <View style={{ height: 12 }} />
          {actionTile(UNLOCK, 'Unlock', unlock, true)}
          <View style={{ height: 8 }} />
          {actionTile(CANCEL, 'Cancel', cancel, false)}
        </View>
      </ScrollView>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  scroll: { paddingVertical: 16, alignItems: 'center' },
  box: { width: 300, alignItems: 'stretch' },
  title: { fontSize: 18, textAlign: 'center', marginTop: 8, marginBottom: 12 },
  field: { borderWidth: 1, borderRadius: 4, paddingHorizontal: 12, paddingVertical: 10, minHeight: 44, justifyContent: 'center' },
  error: { fontSize: 13, marginTop: 4 },
  grid: { flexDirection: 'row', flexWrap: 'wrap', marginTop: 12, marginHorizontal: -4 },
  cell: { width: '33.333%', padding: 4 },
  key: { flex: 1, borderRadius: 12, borderWidth: 2, alignItems: 'center', justifyContent: 'center' },
  keyText: { fontSize: 18, fontWeight: 'bold' },
  action: { paddingVertical: 10, borderRadius: 10, borderWidth: 2, alignItems: 'center' },
  actionText: { fontSize: 16, fontWeight: 'bold' },
});
