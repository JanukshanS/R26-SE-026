# Kaduna.lk Mobile App

Expo (React Native) cross-platform app for the Kaduna.lk platform. Serves stranded drivers, fleet managers, roadside-assistance providers, and the guided photo-capture flow used by the claims-privacy component.

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

Follow `docs/contributing.md` at the repo root. Plus mobile-specific:

- **kebab-case file names** (e.g. `incident-card.tsx`, not `IncidentCard.tsx`)
- **Inline styles**, not StyleSheet — Tailwind/NativeWind not used in this project
- **`<ScrollView contentInsetAdjustmentBehavior="automatic" />`** as the first child of every Stack screen for safe-area handling
- **`expo-image`** with `source="sf:name"` for SF Symbols (iOS), not `expo-symbols` directly
- **`react-native-safe-area-context`**, not the deprecated `SafeAreaView` from react-native
- **`process.env.EXPO_OS`**, not `Platform.OS`
- **Routes only in `app/`** — never co-locate components, types, or utilities there

## Migration notes

- Dilnuk's existing `Guided-Camera/frontend/` (Expo SDK 54, same stack) ports into `features/capture/` plus any shared assets into `assets/`
- The web dashboard ports separately into `apps/dashboard-web/`

## State management

Not added in the template. Add when first feature needs it:

- **Zustand** for client-side state (recommended; minimal boilerplate)
- **TanStack Query** for server state (caching, retries, background refetch)

Keep it minimal — the app should remain mostly stateless on the client; treat the backend as the source of truth.
