# theme

Reserved for design tokens (colors, spacing, typography, radii). Currently the scaffold puts these in `constants/theme.ts`; either location is fine — pick one and stick with it.

If/when this folder is used:

```
theme/
  colors.ts        Light + dark color tokens
  spacing.ts       4 / 8 / 12 / 16 ...
  typography.ts    Font sizes, line heights, weights
  radii.ts         2 / 4 / 8 / 12 / 16
  shadows.ts       boxShadow strings (NEVER legacy elevation/shadow*)
  index.ts         Re-exports
```

Use inline styles that read from these tokens — Tailwind/NativeWind is not used in this project.
