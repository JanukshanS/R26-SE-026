import * as Location from 'expo-location';
import { router } from 'expo-router';
import { Linking, Platform } from 'react-native';

/** 'denied' = the app isn't allowed to use location; 'off' = device location is
 * switched off. Kept apart so the user is told the actual fix for each. */
export type LocationStatus = 'ok' | 'denied' | 'off';

let promptInFlight = false;
let exiting = false;

/** Checks permission, then (Android) offers the system "Location Accuracy"
 * dialog. Declining that dialog is fine on its own — only device location
 * actually being off counts as 'off'. Location Accuracy is a separate Google
 * setting that improves precision; requiring it would block users whose
 * location (GPS) is already on. */
export async function ensureLocationOn(): Promise<LocationStatus> {
  promptInFlight = true;
  try {
    const { status } = await Location.requestForegroundPermissionsAsync();
    if (status !== 'granted') return 'denied';
    if (Platform.OS === 'android') {
      try {
        await Location.enableNetworkProviderAsync();
      } catch {
        // "No, thanks" / closed — fall through to the real on/off check below.
      }
    }
    return (await Location.hasServicesEnabledAsync()) ? 'ok' : 'off';
  } catch {
    return 'off';
  } finally {
    promptInFlight = false;
  }
}

/** Same check without ever prompting — for re-checking when the app returns to
 * the foreground. Reports 'ok' while ensureLocationOn's own dialog is still
 * resolving: that dialog closing also brings the app back to the foreground,
 * and must not race it into a false exit. */
export async function isLocationOn(): Promise<LocationStatus> {
  if (promptInFlight) return 'ok';
  try {
    const { status } = await Location.getForegroundPermissionsAsync();
    if (status !== 'granted') return 'denied';
    return (await Location.hasServicesEnabledAsync()) ? 'ok' : 'off';
  } catch {
    return 'off';
  }
}

// Which problem the "Location required" pop-up should explain — read by
// LocationRequiredModal (mounted once in the root layout so it shows on top of
// Home no matter where the user was sent from). null = hidden.
let prompt: Exclude<LocationStatus, 'ok'> | null = null;
const listeners = new Set<() => void>();

export function subscribeLocationPrompt(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

export function getLocationPrompt(): Exclude<LocationStatus, 'ok'> | null {
  return prompt;
}

export function dismissLocationPrompt(): void {
  prompt = null;
  listeners.forEach((l) => l());
}

/** The right settings page for the problem: the phone's location settings when
 * switched off, Kaduna's app permissions when blocked. */
export function openLocationSettings(status: Exclude<LocationStatus, 'ok'>): void {
  if (status === 'off' && Platform.OS === 'android') {
    void Linking.sendIntent('android.settings.LOCATION_SOURCE_SETTINGS');
  } else {
    void Linking.openSettings();
  }
}

/** Back to the main Home screen, then the "Location required" pop-up explains
 * this specific problem. Guarded so two triggers firing at once (e.g. the
 * dialog result and the foreground re-check) only exit once. */
export function exitToHome(status: Exclude<LocationStatus, 'ok'>): void {
  if (exiting) return;
  exiting = true;
  setTimeout(() => {
    exiting = false;
  }, 2000);
  router.replace('/(driver)/home');
  prompt = status;
  listeners.forEach((l) => l());
}
