// Owns native TV focus for a whole screen/overlay, like Flutter's single
// autofocused Focus node. All children should be focusable={false}; the
// screen drives its own highlight from useRemoteKeys. Without an owner,
// Android TV hands focus (and the Select key) to controls hidden underneath.
import React, { useEffect, useRef, useState } from 'react';
import { findNodeHandle, Pressable, StyleProp, View, ViewStyle } from 'react-native';

export function FocusTrap({
  active = true,
  claimKey,
  style,
  children,
}: {
  active?: boolean;
  /** Change this value to make the trap take native focus back (e.g. after the keyboard closes). */
  claimKey?: number;
  style?: StyleProp<ViewStyle>;
  children: React.ReactNode;
}) {
  const ref = useRef<View>(null);
  const [self, setSelf] = useState<number | undefined>(undefined);

  useEffect(() => {
    const h = findNodeHandle(ref.current);
    if (h) setSelf(h);
  }, []);

  // (Re)claim focus whenever this trap becomes the active one, e.g. after an
  // overlay on top of it closes.
  useEffect(() => {
    if (!active) return;
    // Retry a few times: after the soft keyboard closes Android re-assigns focus
    // on its own a moment later, which would otherwise override a single request.
    const timers = [60, 250, 600, 1200].map((ms) =>
      setTimeout(() => (ref.current as any)?.requestTVFocus?.(), ms));
    return () => timers.forEach(clearTimeout);
  }, [active, claimKey]);

  return (
    <Pressable
      ref={ref}
      focusable={active}
      hasTVPreferredFocus={active}
      onPress={() => { /* keys are handled by useRemoteKeys */ }}
      nextFocusUp={self}
      nextFocusDown={self}
      nextFocusLeft={self}
      nextFocusRight={self}
      style={style}
    >
      {children}
    </Pressable>
  );
}
