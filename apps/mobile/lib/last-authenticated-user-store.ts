import * as FileSystem from 'expo-file-system/legacy';

/**
 * Tracks which identity (Supabase user id, or 'guest') last used this device,
 * so `vehicleContext.tsx` can tell a genuine account switch apart from a
 * plain app relaunch / token refresh for the *same* user — and wipe stale
 * local claim-in-progress data (`clearAllClaimData()`) only on a real switch.
 */

const ROOT_DIR = (FileSystem.documentDirectory ?? '') + 'auth/';
const LAST_USER_FILE = ROOT_DIR + 'last-authenticated-user.txt';

export async function loadLastAuthenticatedUserId(): Promise<string | null> {
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
  await FileSystem.makeDirectoryAsync(ROOT_DIR, { intermediates: true });
  await FileSystem.writeAsStringAsync(LAST_USER_FILE, id);
}
