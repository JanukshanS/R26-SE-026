import AsyncStorage from '@react-native-async-storage/async-storage';

const SEEN_KEY = 'guided-capture:intro-seen';

export async function hasSeenGuidedCaptureIntro(): Promise<boolean> {
  try {
    return (await AsyncStorage.getItem(SEEN_KEY)) === 'true';
  } catch {
    return false;
  }
}

export async function markGuidedCaptureIntroSeen(): Promise<void> {
  try {
    await AsyncStorage.setItem(SEEN_KEY, 'true');
  } catch {
    // best-effort — worst case the intro shows again next time
  }
}

/** Called from "Reset This Claim" — starting a claim over should bring the
 * walkthrough back too, not just skip straight to the camera. */
export async function clearGuidedCaptureIntroSeen(): Promise<void> {
  try {
    await AsyncStorage.removeItem(SEEN_KEY);
  } catch {
    // best-effort
  }
}
