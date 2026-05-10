# Features

Self-contained user-flow modules. Each subdirectory is one feature owned by one developer; consumers depend only on the feature's exported public API, not its internals.

## Conventions

Each feature folder follows the same shape:

```
features/<feature>/
  components/      Feature-local UI components (kebab-case files)
  hooks/           Feature-local React hooks
  services.ts      API calls / business logic for this feature
  types.ts         Feature-local TypeScript types
  index.ts         Public re-exports (what the rest of the app may import)
```

Other code imports from `@features/<feature>` (which resolves to `features/<feature>/index.ts`), never from a feature's internal paths.

## Planned features

| Feature | Owner | Purpose |
|---|---|---|
| `incidents` | Asath | Driver requests roadside help; sees impact-scored ETA |
| `dispatch` | Janukshan | Provider receives dispatches; marks on-scene/resolved |
| `capture` | Dilnuk | Guided multi-angle 3D accident photo capture (ports from Guided-Camera) |
| `auth` | TBD | Sign-in / sign-up via the claims-privacy API gateway |
| `profile` | TBD | User profile, preferences, history |

## When to add a feature

A new folder here is justified when:

1. The user flow is independent of others (can be removed without breaking the rest)
2. It has its own state, types, or non-trivial logic
3. It has 3+ components or hooks of its own

Otherwise, put the code under `components/ui/` (cross-feature primitive) or `hooks/` (cross-feature hook).
