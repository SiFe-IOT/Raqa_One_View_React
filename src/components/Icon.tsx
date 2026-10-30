import React from 'react';
import MaterialIcons from '@react-native-vector-icons/material-icons';

export const Icon = ({
  name,
  size = 24,
  color,
}: {
  name: string;
  size?: number;
  color?: string;
}) => (
  <MaterialIcons
  name={name as React.ComponentProps<typeof MaterialIcons>['name']}
  size={size}
  color={color}
/>
);