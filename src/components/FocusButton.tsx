import React, { useEffect, useRef, useState } from 'react';
import { Pressable, StyleProp, StyleSheet, Text, ViewStyle } from 'react-native';
import { useAppSettings } from '../services/appSettings';
import { AppTheme } from '../theme/appTheme';
import { C } from '../theme/palette';

type Variant = 'text' | 'primary' | 'danger' | 'dangerText';

/** Dialog button with a clearly visible D-pad focus ring. */
export function FocusButton({
  label, onPress, variant = 'text', autoFocus, disabled, style, highlighted,
}: {
  label: string;
  onPress: () => void;
  variant?: Variant;
  autoFocus?: boolean;
  disabled?: boolean;
  style?: StyleProp<ViewStyle>;
  /** When given, the parent owns focus: this only draws the ring (no native focus). */
  highlighted?: boolean;
}) {
  useAppSettings();
  const [focNative, setFoc] = useState(false);
  const external = highlighted !== undefined;
  const foc = external ? !!highlighted : focNative;
  const ref = useRef<React.ComponentRef<typeof Pressable>>(null);
  useEffect(() => {
    if (!autoFocus || disabled || external) return;
    const t = setTimeout(() => (ref.current as any)?.requestTVFocus?.(), 80);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  const filled = variant === 'primary' || variant === 'danger';
  const bg = variant === 'primary' ? C.teal : variant === 'danger' ? C.red : foc ? AppTheme.focusFill : 'transparent';
  const fg = filled ? C.white : variant === 'dangerText' ? AppTheme.danger : AppTheme.focusAccent;
  const ring = foc ? (filled ? AppTheme.textPrimary : AppTheme.focusAccent) : 'transparent';
  return (
    <Pressable
      ref={ref}
      hasTVPreferredFocus={autoFocus && !disabled && !external}
      focusable={external ? false : !disabled}
      disabled={disabled}
      onPress={onPress}
      onFocus={() => setFoc(true)}
      onBlur={() => setFoc(false)}
      style={[styles.btn, { backgroundColor: bg, borderColor: ring, opacity: disabled ? 0.4 : 1 }, style]}
    >
      <Text style={{ color: fg, fontSize: 15, fontWeight: filled || foc ? '700' : '600' }}>{label}</Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  btn: { paddingHorizontal: 16, paddingVertical: 8, borderRadius: 8, borderWidth: 2, marginLeft: 8 },
});