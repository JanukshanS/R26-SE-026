# Dashboard Web App

Web dashboard for the Kaduna.lk Geo-Intelligence component. Aimed at traffic-authority operations centres and dispatcher consoles. Visualises live incidents, hotspot clusters, the what-if simulator, and live stats.

## Status

Migrated from `RP/dashboard/` on 2026-05-10. Theme aligned with the mobile app (warm cream + brand orange). Reads static JSON from `public/data/` for now; will switch to consuming `components/geo-intelligence/`'s FastAPI backend in PP2.

## Stack

- Next.js 16 (App Router, TypeScript)
- Tailwind CSS v4
- Leaflet.js + react-leaflet + leaflet.heat
- pnpm (pinned to 10.18.3)

## Run

```bash
cd apps/dashboard-web
pnpm install
pnpm dev      # http://localhost:3000
pnpm build    # production build
```

## Theme tokens

CSS variables in `src/app/globals.css` plus the Tailwind `@theme` block:

| Token | Value | Use |
|---|---|---|
| `--bg` | `#FFF7E6` | Page background (warm cream) |
| `--surface` | `#FFFFFF` | Cards |
| `--surface-2` | `#FAF1DC` | Muted surfaces, map background |
| `--border` | `#F0E2C8` | Subtle borders |
| `--text` | `#1B1B1B` | Primary text |
| `--text-muted` | `#6B7280` | Secondary text |
| `--accent` | `#F97316` | Brand orange (was indigo) |
| `--critical` / `--high` / `--medium` / `--low` | red / orange / yellow / green | Priority bands |

The `--high` priority colour aliases to brand orange (so HIGH-impact incidents read as the brand colour).

## Data source

Reads `public/data/{incidents,hotspots,stats,model}.json` produced by `RP/scripts/prepare_dashboard_data.py`. To refresh:

```bash
cd ../../../RP    # back to the personal scratchpad
source venv/bin/activate
python scripts/prepare_dashboard_data.py
# this writes to RP/dashboard/public/data/; copy to apps/dashboard-web/public/data/
cp dashboard/public/data/*.json ../rp-group/Main-Repo/apps/dashboard-web/public/data/
```

(In PP2 this becomes a single API call once `components/geo-intelligence/` is wired up.)

## Features

- Interactive map (CARTO Voyager basemap — light + readable)
- Priority-coloured incident markers
- Density heatmap weighted by impact score
- Hotspot zone overlays (DBSCAN clusters)
- Priority + road-type filters
- Statistics panel (KPIs, distributions, hourly profile)
- Incident detail panel with score breakdown and congestion prediction
- What-If simulator
