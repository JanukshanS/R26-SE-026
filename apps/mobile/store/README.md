# store

Cross-feature client state. Empty by default — add stores only when a feature genuinely needs shared client state.

## Recommended library

**Zustand** — minimal, no provider, no boilerplate. Add when needed:

```bash
npm install zustand
```

Example shape:

```ts
// store/auth.ts
import { create } from "zustand";

type AuthStore = {
  token: string | null;
  setToken: (t: string | null) => void;
};

export const useAuth = create<AuthStore>((set) => ({
  token: null,
  setToken: (token) => set({ token }),
}));
```

## When to add a store

- The state is **truly cross-feature** (auth token, app theme, current user)
- Multiple unrelated features read/write it
- It survives navigation and component unmounts

## When NOT to add a store

- State scoped to one feature → use feature-local state inside `features/<feature>/`
- Server data → use TanStack Query (caching, retries, background refresh) instead of writing your own cache
- Form state → useState + react-hook-form
