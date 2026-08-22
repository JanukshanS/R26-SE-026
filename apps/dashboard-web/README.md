# Dashboard Web App

Web dashboard for the Kaduna.lk Geo-Intelligence component. Aimed at traffic-authority operations centres and dispatcher consoles. Visualises live incidents, hotspot clusters, the what-if simulator, and live stats.

## Status

Migrated from `RP/dashboard/` on 2026-05-10; UI re-synced to the RP dashboard overhaul on 2026-08-15 (dark shadcn/ui shell with sidebar sections). Reads static JSON from `public/data/`, upgrading to the geo-intelligence API and live dispatch incidents when those services are up (see the header status badges).

## Stack

- Next.js 16 (App Router, TypeScript)
- Tailwind CSS v4 + shadcn/ui (radix-ui, lucide-react)
- Leaflet.js + react-leaflet + leaflet.heat
- pnpm (pinned to 10.18.3)

## Run

```bash
cd apps/dashboard-web
cp .env.example .env.local   # fill in before the first run
pnpm install
pnpm dev      # http://localhost:3000
pnpm build    # production build
```

## Environment and sign-in

`NEXT_PUBLIC_*` values are inlined into the browser bundle at build time, so
they must be present for `pnpm build` too, not just at runtime — a deploy that
forgets them fails the build rather than shipping a broken page.

The dashboard is behind a Supabase sign-in gate because geo-intelligence and
dispatch now reject unauthenticated requests. Any authenticated Supabase user
gets in; there is no operator role check yet. Signed out, the panels fall back
to the bundled static JSON in `public/data/` rather than erroring.

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
