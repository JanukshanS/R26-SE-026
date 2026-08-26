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
 */
module.exports = ({ config }) => ({
  ...config,
  android: {
    ...config.android,
    config: {
      ...config.android?.config,
      googleMaps: {
        apiKey: process.env.EXPO_PUBLIC_GOOGLE_MAPS_API_KEY ?? "",
      },
    },
  },
});
