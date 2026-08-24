# Kaduna.lk — App & Dispatch Flows

> Living flow documentation. Edit the Mermaid blocks below and the diagrams
> re-render automatically on GitHub and in VS Code (see "How to edit" at the bottom).
> Keep this file as the single source of truth for navigation + the dispatch spine.

## 1. Screen navigation (Expo Router route groups)

```mermaid
flowchart TD
  %% ---- Entry ----
  idx(["index — Welcome"])

  %% ================= ONBOARDING =================
  subgraph OB["(onboarding)"]
    direction TB
    addveh["add-vehicle"]
    pers["personal-details"]
    ins["add-insurer"]
    acct["add-account (login)"]
    addveh --> pers --> ins --> acct
  end

  %% ================= DRIVER =================
  subgraph DR["(driver)"]
    direction TB
    home(["home — hub"])
    health["health"]
    cdetail["component-detail"]
    autosch["auto-schedule"]
    parts["order-parts"]
    mveh["manage-vehicles"]
    prof["profile"]
    dauth["auth"]
    home --> health
    home --> parts
    home --> mveh
    home --> prof
    home --> dauth
    prof --> mveh
    prof --> dauth
    dauth --> mveh
  end

  %% ================= EMERGENCY =================
  subgraph EM["(emergency) — diagnosis + dispatch"]
    direction TB
    safety["safety-check"]
    intent["intent (Q1 picker)"]
    qdisp["quick-dispatch (fast-path)"]

    subgraph ENG["engine subtree"]
      direction TB
      estate["engine-state"]
      esound["diagnosis-sound"]
      eelec["electrical"]
      erun["running-issue"]
      eover["overheat-detail"]
      enoise["noise-detail"]
      esmoke["smoke-color"]
      estate --> esound
      estate --> eelec
      estate --> erun
      erun --> eover
      erun --> enoise
      erun --> esmoke
    end

    bdetail["brake-detail"]
    gdetail["gear-detail"]

    subgraph TAIL["shared diagnosis tail"]
      direction TB
      lights["diagnosis-lights"]
      smells["smells"]
      recent["recent"]
      context["context"]
      result["diagnosis-result"]
      lights --> smells --> recent --> context --> result
    end

    conn(["connected — provider assigned"])

    safety -->|"CRASH (fast-path)"| conn
    safety -->|"MINOR / NONE"| intent
    intent -->|engine| estate
    intent -->|brake| bdetail
    intent -->|gear| gdetail

    %% subtree leaves converge on the shared tail
    esound --> lights
    eelec --> lights
    eover --> lights
    enoise --> lights
    esmoke --> lights
    erun --> lights
    bdetail --> lights
    gdetail --> lights

    result -->|See connected mechanic| conn
    qdisp --> conn
  end

  %% ================= PROVIDER =================
  subgraph PR["(provider)"]
    direction TB
    onboard["onboarding"]
    avail(["available"])
    ajob["active-job"]
    avail -->|"no provider profile linked"| onboard
    onboard -->|"register provider"| avail
    avail -->|"tap an assigned job"| ajob
    ajob -->|"Decline / Mark resolved"| avail
  end

  %% ---- cross-group transitions ----
  idx -->|Create an Account| addveh
  idx -->|Login| acct
  idx -->|Service Provider pill| avail
  acct --> home

  home -->|"SOS / Get help"| safety
  home -->|"quick action: Tyre / Fuel / Locksmith"| qdisp

  conn -->|Back to Home| home
  result -->|Back to Home| home
  avail -->|Logout| idx
  home -->|Logout| idx

  classDef hub fill:#1d4ed8,stroke:#1e3a8a,color:#fff;
  class idx,home,conn,avail hub;
```

## 2. Hero flow — mobile → dispatch → geo → provider (sequence)

```mermaid
sequenceDiagram
  autonumber
  actor D as Driver
  participant M as Mobile app<br/>(safety-check / quick-dispatch)
  participant API as Dispatch service<br/>/api/v1
  participant DB as Postgres (Prisma)
  participant GEO as Geo-Intelligence<br/>/v1/score

  D->>M: Tap "Get help" (or quick action)
  M->>M: getCurrentDriverLocation() (GPS, cached)

  M->>API: POST /api/v1/incidents {location, vehicleInfo}
  API->>DB: insert Incident (status=CREATED)
  API-->>M: 201 { incidentId }

  M->>API: POST /api/v1/triage/submit {incidentId, responses}
  API->>API: runTriageEngine → ServiceType probabilities + tier
  API->>DB: persist TriageResponse (status=DISPATCHING)
  API-->>M: 200 { result: probabilities, tier, confidence }

  M->>API: POST /api/v1/dispatch/optimize {incidentId}
  Note over API,GEO: trafficImpactScore omitted by mobile,<br/>so dispatch sources it live
  API->>GEO: POST /v1/score {lat, lng, incident_type, hour, ...}
  Note over API,GEO: hour/day_of_week were read from the container clock (UTC),<br/>not Asia/Colombo — fixed on this branch
  alt geo reachable
    GEO-->>API: 200 { score 1–10 }
  else timeout / error (2s)
    GEO-->>API: (unreachable)
    API->>API: fall back to neutral score = 5
  end
  API->>DB: read AVAILABLE providers
  API->>API: ECM optimizer — minimize expected cost, rank providers
  API->>DB: persist DispatchDecisions + assign top provider<br/>(status=PROVIDER_ASSIGNED)
  API-->>M: 200 { selectedProvider, rankedProviders, metadata }

  M->>D: navigate to "connected" (show provider + ETA + impact card)
```

> **Known limitation (G-004):** `geo-client.ts` sends static road geometry
> (`primary`, 2 lanes, 1 blocked) for every incident. Live scores reflect
> incident type and time-of-day but not OSM road class at GPS. Research CSVs
> use per-incident geometry. See `rp-analysis/gaps/remediation/R4-integration-test-spec.md`.
>
> Measured consequence, before this branch: `lanes_blocked` was pinned at 1 alongside
> `road_type` and `total_lanes`, so two of the five scoring factors never moved — CLF
> (`lanes_blocked / total_lanes`, weight 0.25, and the most data-identified factor at
> r = 0.883) and LF (road-class lookup, weight 0.15) — freezing 40% of the score weight.
> Sweeping every payload `geo-client.ts` could emit (all incident types × all hours ×
> all days) confined live scores to [2.6, 7.9], so the CRITICAL band (>= 8.0) was
> unreachable through dispatch while the research dataset contains 18 CRITICAL incidents.
>
> Deriving `lanes_blocked` from the triage service type (`SERVICE_TO_LANES_BLOCKED` in
> `contracts/geo-service-mapping.ts`) unfreezes CLF and widens the reachable range to
> **[2.6, 8.4]**, measured by sweeping all 2688 payloads `geo-client.ts` can emit
> (16 mapped service types × 24 hours × 7 days) through the real model. CRITICAL is
> now attainable, and only for the four service types that close a carriageway:
> MAJOR_ACCIDENT, URGENT_TOW, SEVERE_MECHANICAL_TOW and FLOOD_RECOVERY — the peak is
> 8.4 for a major accident at 08:00 on a weekday.
> `road_type` and `total_lanes` remain the standing limitation until incidents carry
> OSM road class from GPS — LF is still constant, so 15% of the weight is still frozen.

### 2.1 ECM cost — the traffic term cannot reorder providers

In `dispatch-optimizer.ts` the externality term is
`λ × (trafficImpactScore / 10) × expectedTotalTime`, but `expectedTotalTime` is
algebraically the sum of the other two cost terms (`expectedServiceCost +
expectedMismatchCost`, since the service-type probabilities sum to 1). Raw cost
factors to `expectedTotalTime × (1 + λ × score / 10)`, so the geo score scales every
provider's cost by the same constant — it changes the reported numbers, never the
ranking. On this branch the term is changed to multiply `travelTimeMin`, so a high
impact score penalises distant providers. This is a design change to the objective:
the dispatch owner should confirm it before it is treated as settled.

### 2.2 Provider job loop — assigned → accepted → resolved

The provider side of the spine. `available` lists the jobs dispatch assigned to this
provider, `active-job` accepts or declines one, and the resolution report writes the
`ResolutionFeedback` row that closes the Bayesian loop back onto triage.

```mermaid
sequenceDiagram
  autonumber
  actor P as Provider
  participant M as Mobile app<br/>(provider)/available + active-job
  participant API as Dispatch service<br/>/api/v1
  participant SB as Supabase PostgREST<br/>profiles.provider_id
  participant DB as Postgres (Prisma)

  P->>M: Open available
  M->>API: GET /api/v1/incidents?assignedProviderId=(own id)
  Note over API,SB: Provider has no user column in Prisma, so ownership is read<br/>from the caller's own profile row with the caller's own token
  API->>SB: GET /rest/v1/profiles?select=provider_id
  alt caller owns the provider
    SB-->>API: 200 provider_id matches
    API->>DB: read Incidents where assignedProviderId
    API-->>M: 200 { incidents, total, limit, offset }
  else no profile row, null provider_id, or a different provider
    SB-->>API: 200 no match
    API-->>M: 403 Caller does not own this provider
  end

  P->>M: Tap a PROVIDER_ASSIGNED job
  M->>API: POST /api/v1/dispatch/respond {incidentId, providerId, accepted}
  alt accepted = true
    API->>DB: Incident status=EN_ROUTE, stamp DispatchDecision accepted + responseTimeSeconds
    API-->>M: 200 { incident, accepted: true }
    Note over M,API: Retrying an accept on EN_ROUTE or ON_SCENE returns 200 and<br/>writes nothing, so a failed request is safe to send again
  else accepted = false
    API->>DB: Incident status=DISPATCHING, assignedProviderId=null, record declineReason
    API-->>M: 200 { incident, accepted: false }
    Note over API,DB: Re-optimization is not automatic - the caller must POST<br/>/api/v1/dispatch/optimize again, or the incident sits unassigned
  end

  P->>M: Job done - pick the actual service type + minutes
  M->>API: POST /api/v1/incidents/{id}/resolve {actualServiceType, resolutionTimeMinutes}
  API->>DB: Incident status=RESOLVED or ESCALATED
  API->>DB: insert ResolutionFeedback (predicted vs actual, wasMatch)
  API-->>M: 200 { incident, wasMatch, message }
  M->>P: Back to available
```

## 3. Legend & conventions (how to add / modify / mark)

```mermaid
flowchart LR
  A["Standard screen"] --> B(["Hub / terminal screen"])
  A -. "TODO / not built yet" .-> C["Planned screen"]
  classDef hub fill:#1d4ed8,stroke:#1e3a8a,color:#fff;
  classDef todo stroke-dasharray:5 5,stroke:#d97706,color:#92400e;
  class B hub;
  class C todo;
```

**Conventions for this doc**

- **Node naming** — use the real route file name (e.g. `diagnosis-lights`), not a prose label, so a node maps 1:1 to a file in `apps/mobile/app/`.
- **Shapes** — `["..."]` = a screen; `(["..."])` = a hub or terminal screen (entry, home, connected, available); apply `class <node> hub` for the blue highlight.
- **Edges** — label every transition with the trigger that fires it: `home -->|SOS| safety`. Branches from one screen = multiple labelled edges out of that node.
- **Adding a screen** — (1) add the route file under the right `(group)/`, (2) add one node inside that group's `subgraph`, (3) add the labelled edge(s) for how you reach it. That's the whole change — one node + one edge line.
- **Marking work-in-progress** — use a dashed edge `-. "TODO" .->` and the `todo` class so unbuilt screens are visually distinct. Remove the dashes once the route exists.
- **Keep it strict** — do **not** add Mermaid `click` directives: GitHub renders with `securityLevel: 'strict'` and will silently drop them. Diagrams stay pure-visual.
- **Backend changes** — the dispatch spine lives in `components/dispatch/src/routes/*` and `services/geo-client.ts`; if an endpoint or the geo fallback changes, update the sequence diagram in section 2.

## How to edit & render

- **GitHub**: push this file — all three Mermaid blocks render inline in the file view and in any PR/issue. No build step, no images.
- **VS Code**: install **Markdown Preview Mermaid Support** (`bierner.markdown-mermaid`), open this file, `Ctrl/Cmd-Shift-V` for a live preview that updates as you type.
- **Scratch experiments**: paste a block into the Mermaid Live Editor (mermaid.live), then paste back.
- **Richer visuals later (optional)**: add `docs/<name>.drawio.svg`, edit with the **Draw.io Integration** extension (`hediet.vscode-drawio`); it shows as an image on GitHub while staying editable. Keep this file as the canonical flow source.
