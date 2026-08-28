import type { ConfigContext, ExpoConfig } from "expo/config";

/**
 * app.json stays the source of truth for everything static. This wraps it to
 * inject the Google Maps Android API key from an environment variable rather
 * than committing it to git — `GOOGLE_MAPS_API_KEY` (no EXPO_PUBLIC_ prefix:
 * it's read only at prebuild/build time to populate AndroidManifest.xml's
 * com.google.android.geo.API_KEY meta-data, never bundled into client JS).
 *
 * Local builds: set it in apps/mobile/.env — the Expo CLI loads .env into
 * process.env before evaluating this file, no extra dotenv setup needed.
 * EAS cloud builds: registered per environment via `eas env:create` /
 * `eas env:update` (same pattern as the EXPO_PUBLIC_* backend URLs).
 */
export default ({ config }: ConfigContext): ExpoConfig => ({
  ...(config as ExpoConfig),
  android: {
    ...config.android,
    config: {
      ...config.android?.config,
      googleMaps: {
        apiKey: process.env.GOOGLE_MAPS_API_KEY,
      },
    },
  },
});
