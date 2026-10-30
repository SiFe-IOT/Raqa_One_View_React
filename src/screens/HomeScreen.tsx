import React, { useRef, useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useNavigation } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { TvCard } from '../components/TvCard';
import { useAppSettings } from '../services/appSettings';
import { AppTheme } from '../theme/appTheme';
import { useRemoteKeys } from '../hooks/useRemoteKeys';
import type { RootStackParamList } from '../navigation';

const ITEMS: { icon: string; label: string; route: keyof RootStackParamList }[] = [
  { icon: 'dashboard', label: 'Dashboard', route: 'Dashboard' },
  { icon: 'devices-other', label: 'Devices', route: 'Devices' },
  { icon: 'settings-input-component', label: 'Configuration', route: 'Config' },
  { icon: 'settings', label: 'Settings', route: 'Settings' },
];

export function HomeScreen() {
  useAppSettings();
  const navigation = useNavigation<NativeStackNavigationProp<RootStackParamList>>();
  const [selected, setSelectedState] = useState(0);
  const selRef = useRef(0);
  const setSelected = (n: number) => { selRef.current = n; setSelectedState(n); };

  // Select can arrive twice (native press + remote key); only navigate once.
  const lastOpen = useRef(0);
  // Native focus already moved the highlight for this key press; do not move it twice.
  const lastFocusAt = useRef(0);
  const open = (i: number) => {
    const t = Date.now();
    if (t - lastOpen.current < 600) return;
    lastOpen.current = t;
    // Home is opened from the Dashboard's menu button, so a Dashboard is
    // already underneath. Pushing another would run two dashboards (two
    // timers and two looping sirens): just go back to it.
    if (i === 0 && navigation.canGoBack()) { navigation.goBack(); return; }
    navigation.navigate(ITEMS[i].route as any);
  };

  useRemoteKeys((key) => {
    if ((key === 'left' || key === 'right') && Date.now() - lastFocusAt.current < 150) return;
    if (key === 'right') setSelected(Math.min(ITEMS.length - 1, selRef.current + 1));
    else if (key === 'left') setSelected(Math.max(0, selRef.current - 1));
    else if (key === 'select') open(selRef.current);
  });

  return (
    <SafeAreaView style={[styles.root, { backgroundColor: AppTheme.background }]}>
      <View style={styles.pad}>
        <Text style={[styles.title, { color: AppTheme.textPrimary }]}>RaQa One View</Text>
        <Text style={[styles.sub, { color: AppTheme.textSecondary }]}>
          Real-Time Fire & Safety Monitoring System
        </Text>
        <View style={styles.grid}>
          {ITEMS.map((item, i) => (
            <View key={item.label} style={styles.cell}>
              <TvCard
                icon={item.icon}
                label={item.label}
                selected={selected === i}
                onPress={() => { setSelected(i); open(i); }}
                onFocus={() => { lastFocusAt.current = Date.now(); setSelected(i); }}
              />
            </View>
          ))}
        </View>
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  pad: { flex: 1, paddingHorizontal: 48, paddingVertical: 32 },
  title: { fontSize: 28, fontWeight: 'bold' },
  sub: { fontSize: 18, marginTop: 8, marginBottom: 40 },
  grid: { flexDirection: 'row', marginHorizontal: -12 },
  cell: { flex: 1, paddingHorizontal: 12, alignItems: 'center' },
});
