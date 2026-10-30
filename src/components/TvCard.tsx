
import React, { useEffect, useRef, useState } from 'react';
import {
  Animated,
  Pressable,
  StyleSheet,
  Text,
} from 'react-native';

import { useIsFocused } from '@react-navigation/native';
import { Icon } from './Icon';
import { C } from '../theme/palette';

interface Props {
  icon: string;
  label: string;
  selected: boolean;
  onPress: () => void;
  onFocus: () => void;
}

/**
 * TV-friendly focusable card.
 * White by default and teal when focused/selected.
 */
export function TvCard({
  icon,
  label,
  selected,
  onPress,
  onFocus,
}: Props) {
  const [focused, setFocused] = useState(false);
  const screenFocused = useIsFocused();

  const hasFocus = screenFocused && (focused || selected);

  const scale = useRef(new Animated.Value(1)).current;

  useEffect(() => {
    Animated.timing(scale, {
      toValue: hasFocus ? 1.06 : 1,
      duration: 150,
      useNativeDriver: true,
    }).start();
  }, [hasFocus, scale]);

  return (
    <Pressable
      focusable={screenFocused}
      hasTVPreferredFocus={selected && screenFocused}
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityState={{ selected: hasFocus }}
      onPress={onPress}
      onFocus={() => {
        setFocused(true);
        onFocus();
      }}
      onBlur={() => {
        setFocused(false);
      }}
      style={styles.wrap}
    >
      <Animated.View
        style={[
          styles.card,
          hasFocus ? styles.cardFocused : styles.cardNormal,
          {
            transform: [{ scale }],
          },
        ]}
      >
        <Icon
          name={icon}
          size={44}
          color={hasFocus ? C.white : C.teal700}
        />

        <Text
          numberOfLines={1}
          ellipsizeMode="tail"
          style={[
            styles.label,
            {
              color: hasFocus ? C.white : '#222222',
            },
          ]}
        >
          {label}
        </Text>
      </Animated.View>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  wrap: {
    width: 180,
    height: 150,
    margin: 8,
  },

  card: {
    width: '100%',
    height: '100%',

    borderRadius: 18,
    borderWidth: 2,

    alignItems: 'center',
    justifyContent: 'center',

    paddingHorizontal: 16,
    paddingVertical: 18,
  },

  cardNormal: {
    backgroundColor: C.white,
    borderColor: '#E5E7EB',

    shadowColor: '#000000',
    shadowOpacity: 0.08,
    shadowRadius: 8,
    shadowOffset: {
      width: 0,
      height: 3,
    },

    elevation: 4,
  },

  cardFocused: {
    backgroundColor: C.teal700,
    borderColor: C.tealAccent,

    shadowColor: C.tealAccent,
    shadowOpacity: 0.35,
    shadowRadius: 18,
    shadowOffset: {
      width: 0,
      height: 0,
    },

    elevation: 10,
  },

  label: {
    marginTop: 12,
    fontSize: 16,
    fontWeight: '700',
    textAlign: 'center',
  },
});
