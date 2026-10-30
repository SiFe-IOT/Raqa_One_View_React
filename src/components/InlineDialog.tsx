// Dialog drawn inside the app window instead of a native Modal.
// A native Modal is a separate Android window: remote key events do not
// reach the app's key handlers while one is open, and focus can fall through
// to the screen underneath. An inline overlay keeps both working. Back closes it.
import React, { useEffect } from 'react';
import { BackHandler, StyleSheet, View } from 'react-native';

export function InlineDialog({
  visible,
  onRequestClose,
  children,
}: {
  visible: boolean;
  onRequestClose: () => void;
  children: React.ReactNode;
}) {
  useEffect(() => {
    if (!visible) return;
    const sub = BackHandler.addEventListener('hardwareBackPress', () => { onRequestClose(); return true; });
    return () => sub.remove();
  }, [visible, onRequestClose]);

  if (!visible) return null;
  return (
    <View style={StyleSheet.absoluteFill} onStartShouldSetResponder={() => true}>
      {children}
    </View>
  );
}
