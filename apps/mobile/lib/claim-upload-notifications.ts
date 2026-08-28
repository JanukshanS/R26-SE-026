import { Platform } from 'react-native';
import * as Notifications from 'expo-notifications';

/** One-shot notifications for a claim upload finishing — separate from the
 * persistent "uploading" notification (owned by react-native-background-actions
 * itself, see claim-upload-background-runner.ts). Never fire both kinds at once:
 * the persistent one already says "uploading", so it's replaced by whichever of
 * these fires once the upload settles, not shown alongside it. */

// Without this, expo-notifications' documented default is to NOT show a
// notification at all while the app is in the foreground ("the default
// behavior when the handler is not set... is not to show the notification") —
// which is exactly why the success notification never appeared while the app
// stayed open through the upload. Runs once at module import time, which is
// always before any notification below can possibly fire (this same module
// owns both).
Notifications.setNotificationHandler({
  handleNotification: async () => ({
    shouldShowBanner: true,
    shouldShowList: true,
    shouldPlaySound: false,
    shouldSetBadge: false,
  }),
});

const ONE_SHOT_CHANNEL_ID = 'claim-upload-result';
let ensuredChannel = false;
let requestedPermission = false;

async function ensureAndroidChannel() {
  if (Platform.OS !== 'android' || ensuredChannel) {
    return;
  }
  ensuredChannel = true;
  await Notifications.setNotificationChannelAsync(ONE_SHOT_CHANNEL_ID, {
    name: 'Claim upload result',
    importance: Notifications.AndroidImportance.DEFAULT,
  });
}

/**
 * Requests POST_NOTIFICATIONS (Android 13+) once per app run. Deliberately never
 * gates anything on the result: on Android, denying this permission only means
 * notifications this app posts are silently not shown — it does NOT prevent a
 * foreground service from starting or block any code path. The upload (and its
 * persistent notification's underlying foreground service) runs identically
 * either way; a denial just means the driver won't see any of these notifications
 * pop up, which is an acceptable degraded experience, not a broken one.
 */
export async function ensureClaimUploadNotificationPermission(): Promise<void> {
  if (requestedPermission) {
    return;
  }
  requestedPermission = true;
  try {
    await Notifications.requestPermissionsAsync();
  } catch {
    // Best-effort — proceed regardless (see note above).
  }
  await ensureAndroidChannel();
}

export async function notifyClaimUploadedSuccessfully(): Promise<void> {
  await ensureAndroidChannel();
  await Notifications.scheduleNotificationAsync({
    content: {
      title: 'Claim uploaded successfully',
      ...(Platform.OS === 'android' ? { channelId: ONE_SHOT_CHANNEL_ID } : null),
    },
    trigger: null,
  }).catch((e) => {
    // Best-effort — a missing notification must never fail the upload itself.
    if (__DEV__) {
      console.log('[Claim upload notification failed]', e);
    }
  });
}

export async function notifyClaimUploadFailed(): Promise<void> {
  await ensureAndroidChannel();
  await Notifications.scheduleNotificationAsync({
    content: {
      title: 'Claim upload failed',
      body: 'Open the app to try again.',
      ...(Platform.OS === 'android' ? { channelId: ONE_SHOT_CHANNEL_ID } : null),
    },
    trigger: null,
  }).catch((e) => {
    // Best-effort — see above.
    if (__DEV__) {
      console.log('[Claim upload notification failed]', e);
    }
  });
}
