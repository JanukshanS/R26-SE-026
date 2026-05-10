# lib

Stateless helpers, formatters, and pure utility functions. No React, no platform-specific code, no I/O.

## Examples of what belongs here

- `format-distance.ts` — "1.2 km" / "850 m"
- `format-duration.ts` — "5 min" / "1h 23m"
- `format-currency.ts` — "LKR 1,250.00"
- `parse-coordinates.ts` — string → `{ lat, lng }`
- `assert.ts` — typed assertion helpers
- `is-valid-imei.ts`, `is-valid-vin.ts`

## Examples of what does NOT belong here

- React hooks → `hooks/`
- API calls → `services/`
- Zustand stores → `store/`
- UI primitives → `components/ui/`
