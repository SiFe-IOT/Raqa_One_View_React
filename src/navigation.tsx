import React from 'react';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import { HomeScreen } from './screens/HomeScreen';
import { SettingScreen } from './screens/SettingScreen';
import { DeviceScreen } from './screens/DeviceScreen';
import { ConfigScreen } from './screens/ConfigScreen';
import { DashboardScreen } from './screens/DashboardScreen';
import { AppLockGate } from './components/AppLockGate';
import { ConfigurationStore } from './services/configurationStore';
import { useObservable } from './services/observable';
import { useAppSettings } from './services/appSettings';
import { AppTheme } from './theme/appTheme';

export type RootStackParamList = {
  Root: undefined;
  Home: undefined;
  Dashboard: undefined;
  Devices: undefined;
  Config: undefined;
  Settings: undefined;
};

const Stack = createNativeStackNavigator<RootStackParamList>();

/** Skip the menu on launch if a site image is already configured. */
function Root() {
  useObservable(ConfigurationStore);
  return ConfigurationStore.active !== null ? <DashboardScreen /> : <HomeScreen />;
}

const LockedDevices = () => <AppLockGate><DeviceScreen /></AppLockGate>;
const LockedConfig = () => <AppLockGate><ConfigScreen /></AppLockGate>;

export function RootNavigator() {
  useAppSettings();
  return (
    <Stack.Navigator
      screenOptions={{
        headerStyle: { backgroundColor: AppTheme.panel },
        headerTintColor: AppTheme.textPrimary,
        contentStyle: { backgroundColor: AppTheme.background },
      }}
    >
      <Stack.Screen name="Root" component={Root} options={{ headerShown: false }} />
      <Stack.Screen name="Home" component={HomeScreen} options={{ headerShown: false }} />
      <Stack.Screen name="Dashboard" component={DashboardScreen} options={{ headerShown: false }} />
      <Stack.Screen name="Devices" component={LockedDevices} options={{ headerShown: false }} />
      <Stack.Screen name="Config" component={LockedConfig} options={{ headerShown: false }} />
      <Stack.Screen name="Settings" component={SettingScreen} options={{ title: 'Settings' }} />
    </Stack.Navigator>
  );
}
