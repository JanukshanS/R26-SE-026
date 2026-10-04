/**
 * Expo reads app.json first and passes it here as `config`, so this file only
 * has to add what app.json cannot express: values that come from the
 * environment. The Maps SDK key is one — it is a credential, and
 * contributing.md says credentials never land in a tracked file.
 *
 * Without a key, react-native-maps renders a blank grey map in a dev or
 * release build (Expo Go ships its own key, which is why the map looks fine
 * there). MapPreview times out after 8s and falls back to coordinates, so a
 * missing key degrades rather than hangs.
 *
 * The key must be restricted by package name + signing SHA-1, which makes it a
 * different key from the referrer-restricted one the web app uses.
 *
 * The feature switches (lib/features.ts) are also read here: a feature that is
 * off must not leave its permissions or native plugins in the binary, or the
 * store listing asks users for Bluetooth/camera access the app never uses.
 * react-native.config.js drops the Bluetooth native modules on the same flag.
 */
const flag = (value) => value === "1" || value?.toLowerCase() === "true";

const FEATURES = {
  insurance: flag(process.env.EXPO_PUBLIC_FEATURE_INSURANCE),
  obd: flag(process.env.EXPO_PUBLIC_FEATURE_OBD),
};

const BLUETOOTH_PERMISSIONS = [
  "android.permission.BLUETOOTH",
  "android.permission.BLUETOOTH_ADMIN",
  "android.permission.BLUETOOTH_CONNECT",
  "android.permission.BLUETOOTH_SCAN",
];
const CAPTURE_PERMISSIONS = ["android.permission.CAMERA", "android.permission.RECORD_AUDIO"];
// The foreground service only ever runs a claim upload or an OBD trip recording.
const FOREGROUND_SERVICE_PERMISSIONS = ["android.permission.FOREGROUND_SERVICE_DATA_SYNC"];

const SOS_LOCATION_TEXT =
  "Your location is shared with the roadside assistance provider sent to help you.";

function pluginName(plugin) {
  return Array.isArray(plugin) ? plugin[0] : plugin;
}

module.exports = ({ config }) => {
  const blocked = [
    ...(FEATURES.obd ? [] : BLUETOOTH_PERMISSIONS),
    ...(FEATURES.insurance ? [] : CAPTURE_PERMISSIONS),
    ...(FEATURES.obd || FEATURES.insurance ? [] : FOREGROUND_SERVICE_PERMISSIONS),
  ];

  const droppedPlugins = new Set([
    ...(FEATURES.obd ? [] : ["react-native-ble-plx"]),
    ...(FEATURES.insurance ? [] : ["expo-camera"]),
    ...(FEATURES.obd || FEATURES.insurance
      ? []
      : ["./plugins/withBackgroundActionsForegroundServiceType.js"]),
  ]);

  const plugins = (config.plugins ?? [])
    .filter((p) => !droppedPlugins.has(pluginName(p)))
    .map((p) =>
      !FEATURES.insurance && pluginName(p) === "expo-location"
        ? ["expo-location", { locationWhenInUsePermission: SOS_LOCATION_TEXT }]
        : p
    );

  // expo-camera stays linked even with insurance off, and App Store review
  // rejects a binary that links camera/mic APIs without a purpose string — so
  // the strings stay, just without promising a claims feature that isn't there.
  const infoPlist = { ...config.ios?.infoPlist };
  if (!FEATURES.insurance) {
    infoPlist.NSCameraUsageDescription = "Camera access is used to take photos of your vehicle.";
    infoPlist.NSMicrophoneUsageDescription = "Microphone access is used to record video with sound.";
    infoPlist.NSLocationWhenInUseUsageDescription = SOS_LOCATION_TEXT;
  }

  return {
    ...config,
    plugins,
    ios: {
      ...config.ios,
      infoPlist,
    },
    android: {
      ...config.android,
      permissions: (config.android?.permissions ?? []).filter((p) => !blocked.includes(p)),
      blockedPermissions: [...(config.android?.blockedPermissions ?? []), ...blocked],
      config: {
        ...config.android?.config,
        googleMaps: {
          apiKey: process.env.EXPO_PUBLIC_GOOGLE_MAPS_API_KEY ?? "",
        },
      },
    },
  };
};
