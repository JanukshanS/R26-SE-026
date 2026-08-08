import * as FileSystem from 'expo-file-system/legacy';

/**
 * Persists which vehicle the driver most recently selected on Home. The
 * (insurance) route group sits outside VehicleProvider (mounted only in
 * (driver)/_layout.tsx and (provider)/_layout.tsx), so it can't read
 * `selectedVehicle` from context — it only gets a `vehicleId` route param
 * snapshot from whenever Home last pushed into it. That snapshot goes stale
 * the moment the driver switches vehicles on Home and starts a second claim
 * without leaving the Insurance section (e.g. via Guided Capture's Reset
 * capture instead of Home → Insurance again). Reading this store fresh on
 * every focus instead fixes that.
 */
const ROOT_DIR = (FileSystem.documentDirectory ?? '') + 'vehicle/';
const SELECTED_VEHICLE_FILE = ROOT_DIR + 'selected-vehicle-id.txt';

export async function saveSelectedVehicleId(id: string): Promise<void> {
  await FileSystem.makeDirectoryAsync(ROOT_DIR, { intermediates: true });
  await FileSystem.writeAsStringAsync(SELECTED_VEHICLE_FILE, id);
}

export async function loadSelectedVehicleId(): Promise<string | null> {
  try {
    const info = await FileSystem.getInfoAsync(SELECTED_VEHICLE_FILE);
    if (!info.exists) return null;
    const t = (await FileSystem.readAsStringAsync(SELECTED_VEHICLE_FILE)).trim();
    return t.length > 0 ? t : null;
  } catch {
    return null;
  }
}
