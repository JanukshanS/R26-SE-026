/**
 * Simple module-level token store.
 * Survives navigation and context re-renders but resets on full app restart.
 * Replace with expo-secure-store for production persistence.
 */

let _token: string | null = null;
let _listeners: Array<(t: string | null) => void> = [];

export const tokenStore = {
  get(): string | null {
    return _token;
  },
  set(token: string | null) {
    _token = token;
    _listeners.forEach((fn) => fn(token));
  },
  subscribe(fn: (t: string | null) => void): () => void {
    _listeners.push(fn);
    return () => {
      _listeners = _listeners.filter((l) => l !== fn);
    };
  },
};
