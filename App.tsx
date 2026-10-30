import React, { useEffect, useMemo } from 'react';
import { StatusBar } from 'react-native';
import { NavigationContainer, DarkTheme, DefaultTheme } from '@react-navigation/native';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { RootNavigator } from './src/navigation';
import { Rs485Service } from './src/services/rs485Service';
import { RsProvider } from './src/services/RsContext';
import { ConfigurationStore } from './src/services/configurationStore';
import { AppSettings, useAppSettings } from './src/services/appSettings';
import { C } from './src/theme/palette';
import { preloadSvgs, RasterHost } from './src/components/SvgFloorPlan';

export default function App() {
  useAppSettings();
  const manager = useMemo(() => new Rs485Service(), []);

  useEffect(() => {
    // manager.init() already loads AppSettings; no need to load them twice.
    manager.init();
    // Read + parse every floor-plan SVG in the background right after the
    // saved config loads, so the dashboard shows the image immediately.
    ConfigurationStore.loadFromDisk().then(() => preloadSvgs(ConfigurationStore.history.map((c) => c.imagePath)));
    return () => { manager.dispose(); };
  }, [manager]);

  const dark = AppSettings.darkModeEnabled;
  const navTheme = {
    ...(dark ? DarkTheme : DefaultTheme),
    colors: { ...(dark ? DarkTheme : DefaultTheme).colors, primary: dark ? C.tealAccent : C.teal },
  };

  return (
    <SafeAreaProvider>
      {/* Keeps the Android TV screen on while the app is foregrounded. */}
      <StatusBar barStyle={dark ? 'light-content' : 'dark-content'} hidden />
      <RasterHost />
      <RsProvider manager={manager}>
        <NavigationContainer theme={navTheme}>
          <RootNavigator />
        </NavigationContainer>
      </RsProvider>
    </SafeAreaProvider>
  );
}