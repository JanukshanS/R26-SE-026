import * as Location from 'expo-location';
import { savePhotoGps } from '@/lib/photo-gps-store';

/**
 * Fire-and-forget: captures GPS for a photo URI and persists it to photo-gps store.
 * Call without `await` after `takePictureAsync` — it must not block the shutter.
 */
export async function snapAndSavePhotoGps(uri: string, capturedAt: string): Promise<void> {
  try {
    const { status } = await Location.getForegroundPermissionsAsync();
    if (status !== 'granted') return;
    const pos = await Location.getCurrentPositionAsync({
      accuracy: Location.Accuracy.Balanced,
    });
    await savePhotoGps(uri, {
      lat: pos.coords.latitude,
      lng: pos.coords.longitude,
      accuracy: pos.coords.accuracy ?? null,
      capturedAt,
    });
  } catch {
    // GPS unavailable — silently skip; photo still uploads without GPS
  }
}
