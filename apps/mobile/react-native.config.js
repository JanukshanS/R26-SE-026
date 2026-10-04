/**
 * Leaves the OBD-II Bluetooth native modules out of builds where the OBD
 * feature is off (see lib/features.ts). lib/elm327.ble.ts and elm327.classic.ts
 * only `require` them lazily inside a try, so a binary without them falls
 * through to "no adapter" instead of crashing.
 */
const obd = ["1", "true"].includes(String(process.env.EXPO_PUBLIC_FEATURE_OBD).toLowerCase());

const unlinked = { platforms: { android: null, ios: null } };

module.exports = {
  dependencies: obd
    ? {}
    : {
        "react-native-ble-plx": unlinked,
        "react-native-bluetooth-classic": unlinked,
      },
};
