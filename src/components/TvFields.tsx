import React, { useEffect, useRef, useState } from 'react';
import { Pressable, StyleSheet, Text, TextInput, View } from 'react-native';
import { Icon } from './Icon';
import { AppTheme } from '../theme/appTheme';
import { useAppSettings } from '../services/appSettings';
import { useRemoteKeys } from '../hooks/useRemoteKeys';

/**
 * Shows a highlighted display box; the keyboard only opens after an
 * explicit Select/tap (D-pad focus alone never pops the IME).
 */
export function TvTextField(props: {
  label: string;
  value: string;
  onChangeText: (t: string) => void;
  autoFocus?: boolean;
  returnKeyType?: 'next' | 'done';
  onSubmit?: () => void;
  /** Mask the value (passwords). */
  secure?: boolean;
  /** Number keyboard; with [digitsOnly] anything else is dropped. */
  numeric?: boolean;
  digitsOnly?: boolean;
  /** Parent drives the highlight / Select (parent owns native focus). */
  external?: boolean;
  highlighted?: boolean;
  /** Increase to start editing (parent received Select). */
  startEdit?: number;
  onEditingChange?: (editing: boolean) => void;
}) {
  useAppSettings();
  const { label, value, onChangeText, autoFocus, returnKeyType = 'done', onSubmit, secure, numeric, digitsOnly, external, highlighted, startEdit, onEditingChange } = props;
  const change = (t: string) => onChangeText(digitsOnly ? t.replace(/[^0-9]/g, '') : t);
  const [focused, setFocused] = useState(false);
  const [editing, setEditing] = useState(false);
  const inputRef = useRef<TextInput>(null);
  const boxRef = useRef<View>(null);
  const empty = value.trim().length === 0;
  const hot = (external ? !!highlighted : focused) || editing;

  useEffect(() => { onEditingChange?.(editing); }, [editing]); // eslint-disable-line react-hooks/exhaustive-deps
  const begin = () => { if (!editing) { setEditing(true); setTimeout(() => inputRef.current?.focus(), 0); } };
  useEffect(() => { if (startEdit) begin(); }, [startEdit]); // eslint-disable-line react-hooks/exhaustive-deps

  // The Pressable keeps native focus only while the TextInput is closed. When
  // typing ends the TextInput unmounts and focus would be lost, so the D-pad
  // could no longer reach Cancel / Save. Take focus back explicitly.
  const reclaim = () => { if (!external) setTimeout(() => (boxRef.current as any)?.requestTVFocus?.(), 60); };
  const finish = () => { setEditing(false); reclaim(); onSubmit?.(); };

  useEffect(() => {
    if (!autoFocus || external) return;
    const t = setTimeout(() => (boxRef.current as any)?.requestTVFocus?.(), 80);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <Pressable
      ref={boxRef}
      focusable={external ? false : undefined}
      hasTVPreferredFocus={autoFocus && !external}
      onFocus={() => setFocused(true)}
      onBlur={() => setFocused(false)}
      onPress={begin}
      style={[
        styles.box,
        {
          backgroundColor: hot ? AppTheme.fieldBgHot : AppTheme.fieldBg,
          borderColor: hot ? AppTheme.focusAccent : AppTheme.divider,
          borderWidth: hot ? 2 : 1,
        },
      ]}
    >
      <View style={{ flex: 1 }}>
        {editing ? (
          <>
            <Text style={[styles.floatLabel, { color: AppTheme.focusAccent }]}>{label}</Text>
            <TextInput
              ref={inputRef}
              value={value}
              onChangeText={change}
              secureTextEntry={secure}
              keyboardType={numeric ? 'number-pad' : 'default'}
              autoFocus
              returnKeyType={external ? 'done' : returnKeyType}
              blurOnSubmit
              onSubmitEditing={finish}
              onBlur={() => { if (editing) { setEditing(false); reclaim(); } }}
              selectionColor={AppTheme.focusAccent}
              style={[styles.input, { color: AppTheme.textPrimary }]}
            />
          </>
        ) : (
          <>
            <Text style={[styles.label, { color: AppTheme.textSecondary }]}>{label}</Text>
            <Text
              numberOfLines={1}
              style={{ fontSize: 15, color: empty ? AppTheme.textSecondary : AppTheme.textPrimary, fontStyle: empty ? 'italic' : 'normal', marginTop: 2 }}
            >
              {empty ? 'Press OK to edit' : secure ? '•'.repeat(value.length) : value}
            </Text>
          </>
        )}
      </View>
      <Icon name={editing ? 'check-circle' : 'edit'} size={18} color={hot ? AppTheme.focusAccent : AppTheme.textSecondary} />
    </Pressable>
  );
}

/**
 * Popup-free selector: Left/Right (D-pad or chevrons) steps through
 * [options] in place, so focus never leaves the dialog.
 */
export function TvSelectField<T>(props: {
  label: string;
  options: T[];
  value: T | null;
  labelBuilder: (v: T) => string;
  onChange: (v: T) => void;
  autoFocus?: boolean;
  /** Parent drives highlight and Left/Right (parent owns native focus). */
  external?: boolean;
  highlighted?: boolean;
}) {
  useAppSettings();
  const { label, options, value, labelBuilder, onChange, autoFocus, external, highlighted } = props;
  const [focusedNative, setFocused] = useState(false);
  const focused = external ? !!highlighted : focusedNative;
  const selRef = useRef<View>(null);
  const disabled = options.length === 0;

  useEffect(() => {
    if (!autoFocus || external) return;
    const t = setTimeout(() => (selRef.current as any)?.requestTVFocus?.(), 80);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  const index = value === null ? -1 : options.indexOf(value);

  const step = (d: number) => {
    if (disabled) return;
    const next = index < 0 ? 0 : Math.min(options.length - 1, Math.max(0, index + d));
    if (next !== index) onChange(options[next]);
  };

  useRemoteKeys((k) => {
    if (!focused) return;
    if (k === 'left') step(-1);
    if (k === 'right') step(1);
  }, focused && !external);

  const chevron = (name: string, on: boolean, onPress: () => void) => (
    <Pressable focusable={false} onPress={onPress} disabled={!on} style={{ paddingHorizontal: 6, paddingVertical: 8 }}>
      <Icon name={name} size={22} color={on ? AppTheme.iconDim : AppTheme.divider} />
    </Pressable>
  );

  const text = value !== null ? labelBuilder(value) : disabled ? 'None available' : '';

  return (
    <Pressable
      ref={selRef}
      focusable={external ? false : undefined}
      hasTVPreferredFocus={autoFocus && !external}
      onFocus={() => setFocused(true)}
      onBlur={() => setFocused(false)}
      style={[
        styles.select,
        {
          borderColor: focused ? AppTheme.focusAccent : AppTheme.divider,
          borderWidth: focused ? 2 : 1,
          backgroundColor: focused ? AppTheme.fieldBgHot : AppTheme.fieldBg,
        },
      ]}
    >
      {chevron('chevron-left', !disabled && index > 0, () => step(-1))}
      <View style={{ flex: 1 }}>
        <Text style={[styles.label, { color: AppTheme.textSecondary }]}>{label}</Text>
        <Text numberOfLines={1} style={{ fontSize: 15, color: disabled ? AppTheme.textSecondary : AppTheme.textPrimary, textAlign: 'center' }}>{text}</Text>
      </View>
      {chevron('chevron-right', !disabled && index < options.length - 1, () => step(1))}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  box: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 12, paddingVertical: 10, borderRadius: 8 },
  label: { fontSize: 12 },
  floatLabel: { fontSize: 12 },
  input: { fontSize: 15, padding: 0, margin: 0 },
  select: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 12, borderRadius: 8 },
});
