# Kaduna.lk — R26-SE-026

**Project:** Kaduna.lk — A Unified Smart Platform for Roadside Assistance and Automotive Services in Sri Lanka
**Project ID:** R26-SE-026
**Module:** IT4010 — Research Project (2026 Jan batch)
**Supervisor:** Ms. Karthiga Rajendran
**Co-supervisor:** Ms. Kaushalya Rajapakshe
**Department of Software Engineering, SLIIT**

This is the team monorepo. It hosts every component, the user-facing apps, the contracts the components share, and the team-level documentation.

## Team

| Member | IT No. | Component | Repo path |
|---|---|---|---|
| Janukshan S | IT22635266 | Dispatch Optimization & Smart Recovery | `components/dispatch/` |
| Asath M M | IT22633422 | Geo-Intelligence & Traffic Impact Analysis | `components/geo-intelligence/` |
| Herath D M S T | IT22639776 | Predictive Maintenance for Service Management | `components/predictive-maintenance/` |
| De Silva R K D H (Dilnuk) | IT22001252 | Intelligent 3D Accident Claim & Privacy-Enforced Ecosystem | `components/claims-privacy/` |

## Repo layout

```
.
├── components/          one folder per research component, owned by one member
│   ├── dispatch/                 Janukshan
│   ├── geo-intelligence/         Asath
│   ├── predictive-maintenance/   Herath
│   └── claims-privacy/           Dilnuk
├── apps/                user-facing applications that consume the components
│   ├── dashboard-web/            Next.js web dashboard
│   └── mobile/                   React Native (Expo) cross-platform app
├── contracts/           OpenAPI specs / shared types between components
├── docs/                team-level documentation
└── infra/               CI, deployment, shared configuration
```

## Component → app contracts

Components communicate with apps and with each other via HTTP/JSON contracts defined under `contracts/`. Each component exposes:

- A REST API surface (documented in `contracts/<component>.openapi.yaml`)
- A versioned data schema where applicable

Apps depend only on the published contracts, never on internal component code. This keeps the four components individually deliverable and individually testable.

## Getting started

```bash
git clone https://github.com/icy-r/R26-SE-026.git
cd R26-SE-026
```

Each component / app has its own `README.md` with setup and run commands; see those for stack-specific instructions.

## Workflow

- Branch per task; PR into `main`
- One reviewer required (typically the component owner reviews PRs touching their component)
- Component owners are listed in the table above
- Cross-component changes need both owners on the PR

See `docs/contributing.md` for full conventions.

## Status

Initialized 2026-05-10. Component code migration from individual repos in progress; see each component's README for current state.
