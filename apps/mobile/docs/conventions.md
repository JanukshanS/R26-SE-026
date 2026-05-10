# Mobile App Conventions

Hard rules for any code added to `apps/mobile/`. These exist because we lost time relearning them.

## 1. Icons — never emoji, never platform-only

**Use `lucide-react-native`** via the `<Icon name="..." />` wrapper at `components/ui/icon.tsx`. Identical rendering on iOS, Android, and web; tree-shakable; well-typed.

```tsx
import { Icon } from "@components/ui/icon";

<Icon name="Wrench" size={24} color={palette.brand} />
```

**Why this overrides the building-native-ui skill rule:** the skill recommends `expo-image` with `source="sf:name"` for SF Symbols. SF Symbols **do not render on Android.** This project ships to both platforms, so we use Lucide for cross-platform parity.

If a future feature genuinely needs platform-native symbol fidelity (e.g. iOS-only premium polish), use `expo-symbols` with both an iOS SF Symbol name and an Android Material Symbols XML drawable; otherwise stick with Lucide.

**Never:**
- ❌ Unicode emoji as visual icons (`<Text>🛞</Text>`) — they render with platform-specific designs (red fire on Android for ⚠️, balloon for 📍 on Samsung One UI, etc.) and look like a child made the app.
- ❌ Unicode arrows (`▶ ▾ ↩`) — same problem.
- ❌ `@expo/vector-icons` directly — Lucide covers our needs and is consistent.

**Acceptable:**
- ✅ Emoji as decorative inline content in user-generated text (chat messages, notes)
- ✅ Lucide icons via the `Icon` wrapper
- ✅ `expo-image` for product imagery, photos, logos

Browse Lucide icons: https://lucide.dev/icons

## 2. Safe areas — handled by the `Screen` wrapper

**Every route uses `<Screen>` from `components/ui/screen.tsx`.** It applies top + bottom safe-area insets correctly, lifts the footer above the home indicator, and handles `contentInsetAdjustmentBehavior="automatic"` for iOS scroll lift.

```tsx
import { Screen } from "@components/ui/screen";

export default function MyScreen() {
  return (
    <Screen
      footer={<Button title="Continue" onPress={...} />}
    >
      <HeaderBar />
      <Text>...</Text>
    </Screen>
  );
}
```

**`<Screen>` props:**
- `edges` — defaults to `["top", "bottom"]`. Pass `["top"]` only if a sticky bottom element provides its own bottom inset (like the home screen's bottom tab bar).
- `padded` — defaults to `true` (adds `spacing.xl` horizontal padding). Set to `false` for full-bleed screens with custom layout.
- `scrollable` — defaults to `true`. Set to `false` for screens that don't need to scroll (rare).
- `footer` — sticks to the bottom above the home indicator. Use this for primary CTA buttons.

**Don't:**
- ❌ Use `SafeAreaView` from `react-native` (deprecated)
- ❌ Manually pad with `paddingTop: 44` etc.
- ❌ Use `<View style={{ flex: 1 }}>` as the root — content will sit under the status bar

**Do:**
- ✅ Wrap every screen in `<Screen>`
- ✅ For sticky bottom elements (custom tab bars), use `useSafeAreaInsets()` and add `insets.bottom` to your padding
- ✅ Root `app/_layout.tsx` wraps everything in `<SafeAreaProvider>` — don't add another one

## 3. Styling — inline, no Tailwind

Inline styles, reading from `theme/index.ts` tokens. No NativeWind, no StyleSheet.create unless reusing styles is faster.

```tsx
import { palette, spacing, typography, radii } from "@theme/index";

<View style={{
  padding: spacing.lg,
  backgroundColor: palette.surface,
  borderRadius: radii.md,
  borderCurve: "continuous",
}}>
  <Text style={{ ...typography.bodyStrong, color: palette.text }}>...</Text>
</View>
```

Always use `borderCurve: "continuous"` on rounded corners (better iOS curve quality).

For shadows, use the `boxShadow` style prop, never the legacy `shadow*` / `elevation` props.

## 4. Path aliases — always use them

Configured in `tsconfig.json`:

| Alias | Maps to |
|---|---|
| `@/*` | `./*` (broad fallback) |
| `@app/*` | `./app/*` |
| `@features/*` | `./features/*` |
| `@components/*` | `./components/*` |
| `@hooks/*` | `./hooks/*` |
| `@lib/*` | `./lib/*` |
| `@services/*` | `./services/*` |
| `@store/*` | `./store/*` |
| `@constants/*` | `./constants/*` |
| `@theme/*` | `./theme/*` |
| `@assets/*` | `./assets/*` |

Prefer aliases over relative imports. Easier to refactor when files move.

## 5. File naming — kebab-case

`incident-card.tsx` not `IncidentCard.tsx`. Component **export** is PascalCase but the file isn't.

```tsx
// File: components/ui/incident-card.tsx
export function IncidentCard() { ... }
```

## 6. Routes — never co-locate non-route code in `app/`

`app/` is **only** for Expo Router routes (`*.tsx` files representing screens, plus `_layout.tsx` files). Components, hooks, utilities go in their respective top-level folders.

If a component is only used by one screen, put it in `features/<feature>/components/`, not next to the route file.

## 7. Other library rules (from building-native-ui skill, kept)

- Use `process.env.EXPO_OS`, not `Platform.OS`
- Use `expo-image` instead of `<img>`
- Use `react-native-safe-area-context`, not RN's deprecated `SafeAreaView`
- Use `expo-haptics` for delightful press feedback (already wired in `Button`)
- Routes that belong to a Stack should have a `ScrollView` (or our `<Screen>` wrapper) as their first child
- Add `selectable` prop to `<Text>` elements showing copyable data
- Use `{ fontVariant: ['tabular-nums'] }` on counters / numeric values that need to align

## 8. When in doubt

1. Read the component's existing pattern in the codebase
2. Check the building-native-ui skill (overrides apply only where this doc explicitly diverges)
3. Ask before adding a new dependency
