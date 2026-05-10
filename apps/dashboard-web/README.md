# Dashboard Web App

Web dashboard that visualises live incidents, hotspots, dispatch comparisons, and the what-if simulator. Aimed at traffic-authority operations centres and dispatcher consoles.

## Status

Skeleton — to be migrated from `icy-r/kaduna-rp` (`dashboard/` directory). Migration tracked in the geo-intelligence component roadmap.

## Stack

- Next.js 16 (App Router, TypeScript)
- Tailwind CSS v4
- Leaflet.js + react-leaflet + leaflet.heat
- pnpm (pinned to 10.18.3)

## Data source

Reads from the `geo-intelligence` component's REST API in production. For development the dashboard can also read static JSON snapshots committed to `apps/dashboard-web/public/data/`.

## Run (after migration)

```bash
cd apps/dashboard-web
pnpm install
pnpm dev    # http://localhost:3000
```

## Features (already implemented in source repo)

- Interactive map with priority-coloured incident markers
- Density heatmap weighted by impact score
- Hotspot zone overlays (DBSCAN clusters)
- Priority and road-type filters
- Statistics panel (KPIs, distributions)
- Incident detail panel with score breakdown and congestion prediction
- What-if simulator
