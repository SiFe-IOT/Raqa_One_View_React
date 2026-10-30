import React, { useEffect, useRef } from 'react';
import { Animated, Easing, StyleSheet, View } from 'react-native';

/** Two expanding red rings, 1.8s loop, second ring half a cycle behind. */
export function FireRipple({ size, color }: { size: number; color: string }) {
  const a = useRef(new Animated.Value(0)).current;
  const b = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    const loop = (v: Animated.Value) =>
      Animated.loop(Animated.timing(v, { toValue: 1, duration: 1800, easing: Easing.linear, useNativeDriver: true }));
    const la = loop(a);
    const lb = loop(b);
    la.start();
    const t = setTimeout(() => lb.start(), 900);
    return () => { clearTimeout(t); la.stop(); lb.stop(); };
  }, [a, b]);

  const ring = (v: Animated.Value) => (
    <Animated.View
      style={[
        styles.ring,
        {
          width: size, height: size, borderRadius: size / 2, borderColor: color,
          opacity: v.interpolate({ inputRange: [0, 1], outputRange: [0.55, 0] }),
          transform: [{ scale: v.interpolate({ inputRange: [0, 1], outputRange: [0.25, 1] }) }],
        },
      ]}
    />
  );

  return (
    <View pointerEvents="none" style={[StyleSheet.absoluteFill, styles.center]}>
      {ring(a)}
      {ring(b)}
    </View>
  );
}

const styles = StyleSheet.create({
  center: { alignItems: 'center', justifyContent: 'center' },
  ring: { position: 'absolute', borderWidth: 2.5 },
});
