// D-pad / remote support (replaces Flutter's Focus + onKeyEvent).
//
// Works across every way a TV remote can reach JS, because which one exists
// depends on the react-native(-tvos) version:
//   1. TVEventHandler.addListener(...)      (react-native-tvos 0.71+)
//   2. new TVEventHandler().enable(...)     (older tvos fork / old RN)
//   3. DeviceEventEmitter 'onHWKeyEvent'    (Android TV hardware key bridge)
//   4. DeviceEventEmitter 'onKeyDown'/'keyDown' with raw Android keyCodes
// One global subscription fans out to all hooks; duplicate deliveries of the
// same key press (several sources firing together) are collapsed.
import { useEffect, useRef } from 'react';
import * as RN from 'react-native';
import { DeviceEventEmitter } from 'react-native';
import { useIsFocused } from '@react-navigation/native';

/** 'next' / 'prev' = CH+ / PgDn and CH- / PgUp on the remote. */
export type RemoteKey = 'up' | 'down' | 'left' | 'right' | 'select' | 'next' | 'prev';

type Handler = (key: RemoteKey) => void;

const KEYCODE: Record<number, RemoteKey> = {
  19: 'up', 20: 'down', 21: 'left', 22: 'right',
  23: 'select', 66: 'select', 160: 'select', 62: 'select',
  166: 'next', 93: 'next',   // CHANNEL_UP, PAGE_DOWN
  167: 'prev', 92: 'prev',   // CHANNEL_DOWN, PAGE_UP
};

const NAME: Record<string, RemoteKey> = {
  up: 'up', down: 'down', left: 'left', right: 'right',
  select: 'select', center: 'select', enter: 'select', dpadcenter: 'select',
  channelup: 'next', pagedown: 'next', channeldown: 'prev', pageup: 'prev',
  dpad_up: 'up', dpad_down: 'down', dpad_left: 'left', dpad_right: 'right', dpad_center: 'select',
};

const subscribers = new Set<Handler>();
const kbSubscribers = new Set<KbHandler>();
let teardown: (() => void) | null = null;
let lastKey: string | null = null;
let lastAt = 0;
let lastSource = '';

/**
 * The same physical press can reach JS through several sources at once.
 * Collapse it: an identical key from a DIFFERENT source within 150 ms is a
 * duplicate. The same source repeating (key held down) is let through.
 */
function isDuplicate(id: string, source: string) {
  const t = Date.now();
  const dup = id === lastKey && source !== lastSource && t - lastAt < 150;
  if (!dup) { lastKey = id; lastAt = t; lastSource = source; }
  return dup;
}

// Physical / Bluetooth keyboard (mirrors the Flutter AppLockGate fast path).
export type KbKey = { digit: string } | 'backspace' | 'escape';
type KbHandler = (k: KbKey) => void;

function keyboardFromEvent(evt: any): KbKey | null {
  if (!evt) return null;
  if (evt.eventKeyAction === 1 || evt.action === 1 || evt.type === 'keyUp') return null;
  const code = evt.keyCode ?? evt.eventKeyCode ?? evt.keycode;
  if (typeof code !== 'number') return null;
  if (code >= 7 && code <= 16) return { digit: String(code - 7) };      // KEYCODE_0..9
  if (code >= 144 && code <= 153) return { digit: String(code - 144) }; // KEYCODE_NUMPAD_0..9
  if (code === 67) return 'backspace';                                 // KEYCODE_DEL
  if (code === 111) return 'escape';                                   // KEYCODE_ESCAPE
  return null;
}

function dispatch(evt: any, source: string) {
  const kb = keyboardFromEvent(evt);
  if (kb) {
    const id = typeof kb === 'string' ? kb : `digit${kb.digit}`;
    if (isDuplicate(id, source)) return;
    [...kbSubscribers].forEach((h) => { try { h(kb); } catch (e) { console.warn('keyboard handler', e); } });
    return;
  }
  const key = fromEvent(evt);
  if (!key || isDuplicate(key, source)) return;
  [...subscribers].forEach((h) => { try { h(key); } catch (e) { console.warn('remote handler', e); } });
}

function fromEvent(evt: any): RemoteKey | null {
  if (!evt) return null;
  // key-up (Android ACTION_UP = 1) must be ignored; also 'keyUp' style events
  if (evt.eventKeyAction === 1 || evt.action === 1 || evt.type === 'keyUp') return null;
  const raw = evt.eventType ?? evt.keyName ?? evt.key ?? evt.type;
  if (typeof raw === 'string') {
    const k = NAME[raw.toLowerCase()];
    if (k) return k;
  }
  const code = evt.keyCode ?? evt.eventKeyCode ?? evt.keycode;
  if (typeof code === 'number' && KEYCODE[code]) return KEYCODE[code];
  return null;
}

function start() {
  const cleanups: Array<() => void> = [];

  const TV = (RN as any).TVEventHandler;
  if (TV) {
    try {
      if (typeof TV.addListener === 'function') {
        const sub = TV.addListener((e: any) => dispatch(e, 'tv-listener'));
        cleanups.push(() => sub?.remove?.());
      }
    } catch (e) { /* fall through to other sources */ }
    try {
      if (typeof TV === 'function') {
        const tv = new TV();
        if (typeof tv.enable === 'function') {
          tv.enable(null, (_: unknown, evt: any) => dispatch(evt, 'tv-legacy'));
          cleanups.push(() => tv.disable?.());
        }
      }
    } catch (e) { /* class form not available in this RN version */ }
  }

  for (const name of ['onHWKeyEvent', 'onKeyDown', 'keyDown', 'onTVKey']) {
    const sub = DeviceEventEmitter.addListener(name, (e: any) => dispatch(e, `emit:${name}`));
    cleanups.push(() => sub.remove());
  }

  return () => cleanups.forEach((c) => { try { c(); } catch { /* ignore */ } });
}

function release() {
  if (subscribers.size === 0 && kbSubscribers.size === 0 && teardown) { teardown(); teardown = null; }
}

function subscribe(h: Handler) {
  subscribers.add(h);
  if (!teardown) teardown = start();
  return () => { subscribers.delete(h); release(); };
}

function subscribeKb(h: KbHandler) {
  kbSubscribers.add(h);
  if (!teardown) teardown = start();
  return () => { kbSubscribers.delete(h); release(); };
}

/**
 * @param enabled extra condition; the hook is ALSO automatically paused while
 * the owning screen is not the focused one (stack screens stay mounted
 * underneath, so without this every screen would react to every key).
 */
export function useRemoteKeys(handler: (key: RemoteKey) => void, enabled = true) {
  const ref = useRef(handler);
  ref.current = handler;

  let screenFocused = true;
  try { screenFocused = useIsFocused(); } catch { /* not inside a navigator */ }
  const active = enabled && screenFocused;

  useEffect(() => {
    if (!active) return;
    return subscribe((k) => ref.current(k));
  }, [active]);
}

/** Dedicated hook for the remote's Back / Menu key via the Android back button. */
export function useRemoteBack(handler: () => boolean | void, enabled = true) {
  const ref = useRef(handler);
  ref.current = handler;
  let screenFocused = true;
  try { screenFocused = useIsFocused(); } catch { /* ignore */ }
  const active = enabled && screenFocused;
  useEffect(() => {
    if (!active) return;
    const sub = RN.BackHandler.addEventListener('hardwareBackPress', () => ref.current() === true);
    return () => sub.remove();
  }, [active]);
}

/** Physical/Bluetooth keyboard digits, Backspace and Escape. */
export function useKeyboardKeys(handler: (k: KbKey) => void, enabled = true) {
  const ref = useRef(handler);
  ref.current = handler;
  let screenFocused = true;
  try { screenFocused = useIsFocused(); } catch { /* ignore */ }
  const active = enabled && screenFocused;
  useEffect(() => {
    if (!active) return;
    return subscribeKb((k) => ref.current(k));
  }, [active]);
}
