import { Platform } from 'react-native';
import * as FileSystem from 'expo-file-system/legacy';

/**
 * Tracks which identity (Supabase user id, or 'guest') last used this device,
 * so `vehicleContext.tsx` can tell a genuine account switch apart from a
 * plain app relaunch / token refresh for the *same* user — and wipe stale
 * local claim-in-progress data (`clearAllClaimData()`) only on a real switch.
 *
 * PLATFORM SPLIT
 * --------------
 * On native, this persists to a small text file under the app's document
 * directory (matches the pattern the other lib/*-store.ts files use for
 * claim data). On web, `expo-file-system` throws at runtime (no native
 * module), so we fall back to `localStorage` — same read/write semantics,
 * same key, just a different backend. This keeps the emergency + dispatch
 * flow working in the browser demo without any behavioural drift on phone.
 */

const ROOT_DIR       = (FileSystem.documentDirectory ?? '') + 'auth/';
const LAST_USER_FILE = ROOT_DIR + 'last-authenticated-user.txt';
const WEB_KEY        = 'kaduna.lastAuthenticatedUserId';

export async function loadLastAuthenticatedUserId(): Promise<string | null> {
  if (Platform.OS === 'web') {
    try {
      const v = globalThis.localStorage?.getItem(WEB_KEY);
      return v && v.length > 0 ? v : null;
    } catch {
      return null;
    }
  }
  try {
    const info = await FileSystem.getInfoAsync(LAST_USER_FILE);
    if (!info.exists) return null;
    const t = (await FileSystem.readAsStringAsync(LAST_USER_FILE)).trim();
    return t.length > 0 ? t : null;
  } catch {
    return null;
  }
}

export async function saveLastAuthenticatedUserId(id: string): Promise<void> {
  if (Platform.OS === 'web') {
    try {
      globalThis.localStorage?.setItem(WEB_KEY, id);
    } catch {
      /* private-window mode etc. — silently skip, worst case is one extra
         claim-data wipe on next relaunch, no correctness impact */
    }
    return;
  }
  await FileSystem.makeDirectoryAsync(ROOT_DIR, { intermediates: true });
  await FileSystem.writeAsStringAsync(LAST_USER_FILE, id);
}
