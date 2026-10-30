import React, { useEffect, useRef, useState } from 'react';
import { Animated, Pressable, StyleProp, ViewStyle } from 'react-native';
import { AppTheme } from '../theme/appTheme';

type Props = Omit<React.ComponentProps<typeof Pressable>, 'style' | 'children'> & {
  /** Style applied always; `focused` lets callers restyle the resting/active state. */
  style?: StyleProp<ViewStyle> | ((focused: boolean) => StyleProp<ViewStyle>);
  children: React.ReactNode | ((focused: boolean) => React.ReactNode);
  /** Ring / glow colour while focused (defaults to the theme accent). */
  accent?: string;
  /** Corner radius of the focus ring. */
  radius?: number;
  /** Scale while focused (1 = none). */
  scale?: number;
  /** Fill drawn behind the content while focused. */
  focusFill?: string;
  /** Show the ring and glow. Turn off when the caller draws its own. */
  ring?: boolean;
};

/**
 * D-pad friendly pressable: animated scale-up, accent ring, soft glow and a
 * tinted fill while it has native TV focus. Owns its focus state, so focusing
 * it never re-renders the screen that contains it.
 */
export function FocusPressable({
  style, children, accent, radius = 10, scale = 1.04, focusFill, ring = true,
  onFocus, onBlur, ...rest
}: Props) {
  const [focused, setFocused] = useState(false);
  const anim = useRef(new Animated.Value(1)).current;

  useEffect(() => {
    Animated.spring(anim, {
      toValue: focused ? scale : 1,
      friction: 7,
      tension: 140,
      useNativeDriver: true,
    }).start();
  }, [focused, scale, anim]);

  const color = accent ?? AppTheme.focusAccent;
  const ringStyle: ViewStyle | null = focused && ring
    ? {
        borderColor: color,
        borderWidth: 2,
        borderRadius: radius,
        backgroundColor: focusFill ?? AppTheme.focusFill,
        shadowColor: color,
        shadowOpacity: 0.55,
        shadowRadius: 14,
        shadowOffset: { width: 0, height: 0 },
        elevation: 8,
        zIndex: 5,
      }
    : null;

  const resolved = typeof style === 'function' ? style(focused) : style;
  return (
    <Pressable
      {...rest}
      onFocus={(e) => { setFocused(true); onFocus?.(e); }}
      onBlur={(e) => { setFocused(false); onBlur?.(e); }}
      style={[
        { borderWidth: 2, borderColor: 'transparent', borderRadius: radius },
        resolved,
        ringStyle,
        { transform: [{ scale: anim }] } as any,
      ]}
    >
      {typeof children === 'function' ? (children as (f: boolean) => React.ReactNode)(focused) : children}
    </Pressable>
  );
}