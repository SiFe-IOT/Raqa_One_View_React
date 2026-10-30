import { AppSettings } from '../services/appSettings';
import { C, withOpacity } from './palette';

// Getter-based theme: components call useAppSettings() so they re-render
// when dark mode flips, then read these values.
const dark = () => AppSettings.darkModeEnabled;

export const AppTheme = {
  get background() { return dark() ? C.black : '#F4F1F6'; },
  get panel() { return dark() ? '#161616' : '#ECE7EF'; },
  get card() { return dark() ? '#121212' : C.white; },
  get textPrimary() { return dark() ? C.white : 'rgba(0,0,0,0.87)'; },
  get textSecondary() { return dark() ? C.grey : 'rgba(0,0,0,0.54)'; },
  get divider() { return dark() ? 'rgba(255,255,255,0.24)' : 'rgba(0,0,0,0.12)'; },

  /** Surface for dialogs / sheets (follows the theme). */
  get dialog() { return dark() ? '#1E1E1E' : C.white; },
  get fieldBg() { return dark() ? 'rgba(255,255,255,0.04)' : 'rgba(0,0,0,0.04)'; },
  get fieldBgHot() { return dark() ? 'rgba(255,255,255,0.08)' : 'rgba(0,0,0,0.08)'; },
  get iconDim() { return dark() ? 'rgba(255,255,255,0.7)' : 'rgba(0,0,0,0.6)'; },
  /** Status colours that stay readable on both themes. */
  get ok() { return dark() ? '#69F0AE' : '#2E7D32'; },
  get warn() { return dark() ? '#FFAB40' : '#E65100'; },
  get danger() { return dark() ? C.redAccent : '#C62828'; },

  get focusAccent() { return dark() ? C.tealAccent400 : '#00796B'; },
  get focusBorder() { return this.focusAccent; },
  get focusFill() { return withOpacity(this.focusAccent, dark() ? 0.14 : 0.10); },

  /** Glow as RN shadow props (iOS) + elevation (Android). */
  get focusGlow() {
    return {
      shadowColor: this.focusAccent,
      shadowOpacity: dark() ? 0.45 : 0.3,
      shadowRadius: 14,
      shadowOffset: { width: 0, height: 0 },
      elevation: 8,
    };
  },

  focusDecoration(radius = 10) {
    return {
      backgroundColor: this.focusFill,
      borderRadius: radius,
      borderWidth: 2,
      borderColor: this.focusBorder,
      ...this.focusGlow,
    };
  },
};
