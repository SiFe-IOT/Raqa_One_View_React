// Replacement for Flutter's ChangeNotifier / ValueNotifier.
import { useSyncExternalStore } from 'react';

export class Observable {
  private listeners = new Set<() => void>();
  private _version = 0;

  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  };

  getVersion = () => this._version;

  protected notify() {
    this._version++;
    this.listeners.forEach((l) => l());
  }
}

/** Re-render the calling component whenever [obs] notifies. */
export function useObservable(obs: Observable) {
  useSyncExternalStore(obs.subscribe, obs.getVersion);
}

export class ValueNotifier<T> extends Observable {
  private _value: T;
  constructor(value: T) {
    super();
    this._value = value;
  }
  get value(): T {
    return this._value;
  }
  set value(v: T) {
    this._value = v;
    this.notify();
  }
}

export function useValueNotifier<T>(n: ValueNotifier<T>): T {
  useObservable(n);
  return n.value;
}

/** A bare change signal: call bump() to notify subscribers. */
export class Signal extends Observable {
  bump() {
    this.notify();
  }
}
