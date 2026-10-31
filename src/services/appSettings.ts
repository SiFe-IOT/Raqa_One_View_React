import AsyncStorage from '@react-native-async-storage/async-storage';
import { Observable, useObservable } from './observable';

const K = {
  siren: 'appSirenEnabled',
  priority: 'appPriorityEnabled',
  password: 'appPassword',
  pinSize: 'appPinSize',
  darkMode: 'appDarkModeEnabled',
};

class AppSettingsStore extends Observable {
  sirenEnabled = false;
  priorityEnabled = true;
  /** Local app-lock PIN. Empty string disables the lock. Default '0000'. */
  password = '0000';
  darkModeEnabled = true;
  pinSize = 20;
  readonly minPinSize = 10;
  readonly maxPinSize = 60;

  async loadSettings() {
    const get = (k: string) => AsyncStorage.getItem(k);
    const [siren, prio, pw, pin, dark] = await Promise.all([
      get(K.siren), get(K.priority), get(K.password), get(K.pinSize), get(K.darkMode),
    ]);
    if (siren !== null) this.sirenEnabled = siren === 'true';
    if (prio !== null) this.priorityEnabled = prio === 'true';
    if (pw !== null) this.password = pw;
    if (pin !== null && !isNaN(parseFloat(pin))) this.pinSize = parseFloat(pin);
    if (dark !== null) this.darkModeEnabled = dark === 'true';
    this.notify();
  }

  async setSirenEnabled(v: boolean) {
    this.sirenEnabled = v;
    this.notify();
    await AsyncStorage.setItem(K.siren, String(v));
  }
  async setPriorityEnabled(v: boolean) {
    this.priorityEnabled = v;
    this.notify();
    await AsyncStorage.setItem(K.priority, String(v));
  }
  async setPassword(v: string) {
    this.password = v;
    this.notify();
    await AsyncStorage.setItem(K.password, v);
  }
  async setPinSize(v: number) {
    this.pinSize = Math.min(this.maxPinSize, Math.max(this.minPinSize, v));
    this.notify();
    await AsyncStorage.setItem(K.pinSize, String(this.pinSize));
  }
  async setDarkModeEnabled(v: boolean) {
    this.darkModeEnabled = v;
    this.notify();
    await AsyncStorage.setItem(K.darkMode, String(v));
  }
}

export const AppSettings = new AppSettingsStore();
export const useAppSettings = () => useObservable(AppSettings);
