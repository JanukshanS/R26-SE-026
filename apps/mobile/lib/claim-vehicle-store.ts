import { Platform } from 'react-native';
import * as FileSystem from 'expo-file-system/legacy';

/**
 * Which vehicle the current claim actually belongs to — pinned once, the moment
 * the driver starts Guided Capture for a new claim (see (insurance)/index.tsx's
 * onTaskPress), and read from then on instead of whatever vehicle happens to be
 * selected on Home at the time.
 *
 * Without this, switching the selected vehicle on Home mid-claim (or after it's
 * already been submitted, while still viewing it) made the "Call [Insurer]"
 * button silently switch to the newly-selected vehicle's insurer — wrong, since
 * the point of that button is to call the insurer for the vehicle the claim is
 * actually about, not whichever vehicle is currently selected elsewhere in the
 * app. Cleared by clearAllClaimData() (Start New Claim / Reset This Claim), at
 * which point the app goes back to tracking the live-selected vehicle for the
 * next claim.
 */
const IS_WEB = Platform.OS === 'web';

const ROOT_DIR = (FileSystem.documentDirectory ?? '') + 'claim-upload/';
const CLAIM_VEHICLE_FILE = ROOT_DIR + 'claim-vehicle-id.txt';

export async function saveClaimVehicleId(vehicleId: string): Promise<void> {
  if (IS_WEB) return;
  await FileSystem.makeDirectoryAsync(ROOT_DIR, { intermediates: true });
  await FileSystem.writeAsStringAsync(CLAIM_VEHICLE_FILE, vehicleId);
}

export async function loadClaimVehicleId(): Promise<string | null> {
  if (IS_WEB) return null;
  try {
    await FileSystem.makeDirectoryAsync(ROOT_DIR, { intermediates: true });
    const info = await FileSystem.getInfoAsync(CLAIM_VEHICLE_FILE);
    if (!info.exists) return null;
    const t = (await FileSystem.readAsStringAsync(CLAIM_VEHICLE_FILE)).trim();
    return t.length > 0 ? t : null;
  } catch {
    return null;
  }
}

export async function clearClaimVehicleId(): Promise<void> {
  if (IS_WEB) return;
  try {
    await FileSystem.deleteAsync(CLAIM_VEHICLE_FILE, { idempotent: true });
  } catch {
    // best-effort
  }
}
