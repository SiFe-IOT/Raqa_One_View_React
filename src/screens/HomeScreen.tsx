
import React, { useCallback, useRef, useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useNavigation } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';

import { TvCard } from '../components/TvCard';
import { useAppSettings } from '../services/appSettings';
import { AppTheme } from '../theme/appTheme';
import type { RootStackParamList } from '../navigation';

const ITEMS: {
  icon: string;
  label: string;
  route: keyof RootStackParamList;
}[] = [
    { icon: 'dashboard', label: 'Dashboard', route: 'Dashboard' },
    { icon: 'devices-other', label: 'Devices', route: 'Devices' },
    { icon: 'settings-input-component', label: 'Configuration', route: 'Config' },
    { icon: 'settings', label: 'Settings', route: 'Settings' },
  ];

type HomeNavigationProp = NativeStackNavigationProp<RootStackParamList>;

export function HomeScreen() {
  useAppSettings();

  const navigation = useNavigation<HomeNavigationProp>();

  const [selected, setSelected] = useState(0);

  // Prevent duplicate presses for the same card.
  const lastOpenRef = useRef({
    index: -1,
    time: 0,
  });

  const open = useCallback(
    (index: number) => {
      const item = ITEMS[index];

      if (!item) {
        return;
      }

      const now = Date.now();
      const previous = lastOpenRef.current;

      // Ignore duplicate native press events.
      if (
        previous.index === index &&
        now - previous.time < 500
      ) {
        return;
      }

      lastOpenRef.current = {
        index,
        time: now,
      };

      if (item.route === 'Dashboard') {
        const routes = navigation.getState().routes;

        const dashboardExists = routes.some(
          route => route.name === 'Dashboard',
        );

        if (dashboardExists) {
          navigation.popTo('Dashboard');
        } else {
          navigation.navigate('Dashboard');
        }

        return;
      }

      navigation.navigate(item.route);
    },
    [navigation],
  );

  return (
    <SafeAreaView
      style={[
        styles.root,
        { backgroundColor: AppTheme.background },
      ]}
    >
      <View style={styles.pad}>
        <Text
          style={[
            styles.title,
            { color: AppTheme.textPrimary },
          ]}
        >
          RaQa One View
        </Text>

        <Text
          style={[
            styles.sub,
            { color: AppTheme.textSecondary },
          ]}
        >
          Real-Time Fire & Safety Monitoring System
        </Text>

        <View style={styles.grid}>
          {ITEMS.map((item, index) => (
            <View key={item.label} style={styles.cell}>
              <TvCard
                icon={item.icon}
                label={item.label}
                selected={selected === index}
                onPress={() => open(index)}
                onFocus={() => setSelected(index)}
              />
            </View>
          ))}
        </View>
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
  },

  pad: {
    flex: 1,
    paddingHorizontal: 48,
    paddingVertical: 32,
  },

  title: {
    fontSize: 28,
    fontWeight: 'bold',
  },

  sub: {
    fontSize: 18,
    marginTop: 8,
    marginBottom: 40,
  },

  grid: {
    flexDirection: 'row',
    marginHorizontal: -12,
  },

  cell: {
    flex: 1,
    paddingHorizontal: 12,
    alignItems: 'center',
  },
});
