# Kaduna.lk Mobile App

Expo (React Native) cross-platform app for the Kaduna.lk platform. Serves stranded drivers, fleet managers, roadside-assistance providers, and the guided photo-capture flow used by the claims-privacy component.

## Environment

Copy `.env.example` to `.env` and fill in the Supabase URL, publishable key and
API URL, then start with `npx expo start -c` — Metro inlines `EXPO_PUBLIC_*`
values at bundle time and caches them.

## Building a sideloadable APK

```bash
# .env must already point at the target backend — Metro inlines EXPO_PUBLIC_*
# into the bundle during this build, so changing it afterwards does nothing.
cd android
JAVA_HOME=<path-to-jdk-21> ./gradlew assembleRelease
# -> app/build/outputs/apk/release/app-release.apk
```

Gradle 8.14 does not accept JDK 25; use 17 or 21. Without a release keystore
configured the APK is signed with the debug key, which is fine for sideloading
but not for the Play Store.

To confirm a built APK targets the backend you expect:

```bash
unzip -p app-release.apk assets/index.android.bundle | strings | grep -oE 'https://[a-z.-]+'
```

EAS cloud builds do not read `.env`. Register the same variables once per
profile:

```bash
eas env:create --environment production --name EXPO_PUBLIC_SUPABASE_URL --value https://...
```

## Stack

- Expo SDK 54
- Expo Router 6 (file-based routing)
- React 19, React Native 0.81
- New Architecture enabled
- TypeScript 5.9

## Folder layout

```
app/                       Expo Router routes ONLY (no co-located code)
  _layout.tsx              Root layout
  (tabs)/                  Bottom-tab group
    _layout.tsx
    index.tsx              Home
    explore.tsx            (placeholder, rename per feature)
  modal.tsx
features/                  Self-contained user-flow modules
  <feature>/
    components/            Feature-local UI
    hooks/                 Feature-local hooks
    services.ts            Feature-local API calls
    types.ts               Feature-local types
components/                Cross-feature UI
  ui/                      Reusable primitives (atoms): Button, Card, Input
hooks/                     Cross-feature shared hooks
lib/                       Helpers, formatters, date utils
services/                  One client per backend component
  api-client.ts            Base HTTP client
  geo-intelligence.ts      Asath's component API
  dispatch.ts              Janukshan's component API
  claims.ts                Dilnuk's component API
store/                     Zustand stores (add when needed)
theme/                     (reserved; constants/theme.ts holds tokens for now)
constants/                 Static config + design tokens
assets/                    Images, fonts
scripts/                   Local maintenance scripts
```

## Path aliases

`tsconfig.json` provides:

| Alias | Maps to |
|---|---|
| `@/*` | `./*` (broad) |
| `@app/*` | `app/*` |
| `@features/*` | `features/*` |
| `@components/*` | `components/*` |
| `@hooks/*` | `hooks/*` |
| `@lib/*` | `lib/*` |
| `@services/*` | `services/*` |
| `@store/*` | `store/*` |
| `@constants/*` | `constants/*` |
| `@assets/*` | `assets/*` |

Prefer aliases over relative imports.

## Running

```bash
cd apps/mobile
npm install
npx expo start          # then scan QR with Expo Go
npm run android         # or run on a simulator / connected device
npm run ios             # macOS only
```

## Building

For preview / production APK or AAB:

```bash
npx eas build --platform android --profile preview     # internal APK
npx eas build --platform android --profile production  # AAB for Play Store
```

EAS Build config lives in `eas.json`. You'll need an Expo account once the team starts cutting builds.

## Conventions

**See `docs/conventions.md` for the full ruleset.** Hard rules:

- **Icons:** `lucide-react-native` via `<Icon name="..." />` — never emoji as icons, never platform-only SF Symbols (we target both iOS and Android)
- **Safe areas:** every screen wrapped in `<Screen>` from `components/ui/screen.tsx`
- **Styling:** inline styles reading from `@theme/index` tokens; no NativeWind, no StyleSheet.create
- **File names:** kebab-case (`incident-card.tsx`, not `IncidentCard.tsx`)
- **Path aliases:** prefer `@components/*`, `@theme/*`, etc. over relative imports
- **Routes only in `app/`** — never co-locate components, types, or utilities there

## Migration notes

- Dilnuk's existing `Guided-Camera/frontend/` (Expo SDK 54, same stack) ports into `features/capture/` plus any shared assets into `assets/`
- The web dashboard ports separately into `apps/dashboard-web/`

## State management

Not added in the template. Add when first feature needs it:

- **Zustand** for client-side state (recommended; minimal boilerplate)
- **TanStack Query** for server state (caching, retries, background refetch)

Keep it minimal — the app should remain mostly stateless on the client; treat the backend as the source of truth.
