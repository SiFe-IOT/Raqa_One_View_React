import React, { useState } from 'react';
import { LayoutChangeEvent, View } from 'react-native';

/**
 * Centers its children in an exact-size box that "contains" the given
 * aspect ratio inside the available space (like CSS object-fit: contain).
 * Children should fill it with flex: 1.
 */
export function FitBox({
  aspect,
  padding = 0,
  children,
}: {
  aspect: number; // width / height
  padding?: number;
  children: React.ReactNode;
}) {
  const [size, setSize] = useState({ w: 0, h: 0 });

  const onLayout = (e: LayoutChangeEvent) => {
    const { width, height } = e.nativeEvent.layout;
    setSize((s) => (s.w === width && s.h === height ? s : { w: width, h: height }));
  };

  const availW = Math.max(0, size.w - padding * 2);
  const availH = Math.max(0, size.h - padding * 2);

  let w = availW;
  let h = aspect > 0 ? w / aspect : availH;
  if (h > availH) {
    h = availH;
    w = h * aspect;
  }

  return (
    <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center' }} onLayout={onLayout}>
      {availW > 0 && availH > 0 && <View style={{ width: w, height: h }}>{children}</View>}
    </View>
  );
}
