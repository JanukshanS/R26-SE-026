# Garage Management Service

A workshop system for Kaduna service providers: customers and their vehicles, appointments, job cards, digital inspections the customer approves, parts stock and suppliers, mechanics, branded invoices and reports. It also connects to the roadside side of Kaduna, so a provider can bring a vehicle they attended through dispatch into the workshop as a job card.

- **Stack:** Node 18, Express, Prisma, PostgreSQL. This is the same stack as `components/dispatch`.
- **Port:** 3002. In production it is served at `garage.<BASE_DOMAIN>` through Caddy.
- **Contract:** [`contracts/garage-management.openapi.yaml`](../../contracts/garage-management.openapi.yaml). It is generated from the code, so don't edit it by hand.
- **UI** (all in `apps/kaduna-web`):
  - `/provider/garage`: the owner's workspace (dashboard, Kaduna jobs, appointments, job cards, customers, inventory, purchase orders, part orders, stocktake, tools & equipment, customer parts, suppliers, invoices, reports, mechanics, settings).
  - `/workshop`: the mechanic's phone-friendly view, and where a mechanic joins with an invite code.
  - `/track?t=…`: the customer's live page for one job (no sign-in).
  - `/book?g=…`: a garage's booking page, where customers pick a free slot (no sign-in).
  - `/app`: drivers see the repair status of their Kaduna jobs.

## How it fits in

```
kaduna-web /provider/garage ──HTTPS + Supabase JWT──▶ garage-management ──▶ Postgres (schema "garage")
                                                         │
                                                         └── GET /api/v1/incidents/:id ──▶ dispatch
                                                             (forwards the caller's token)
```

The service stays independent in four ways:

- **It owns its own schema.** It keeps its tables in Postgres schema `garage` and never reads another service's tables. Dispatch data is fetched through dispatch's API, using the provider's own token, so dispatch still decides what that provider may see.
- **Auth is shared rather than reimplemented.** Bearer tokens are Supabase JWTs, verified against the project's JWKS. The provider comes from `profiles.provider_id`, read with the caller's token, exactly as dispatch does it. An account with no provider link gets `403`.
- **Each provider is a separate tenant.** A provider has exactly one garage, and every query is scoped by `garage_id`. The tests check that one garage can never read or change another's records.
- **Other services learn about changes through events, not calls.** Every state change writes an `outbox_events` row in the same transaction. See [Growing it](#growing-it).

## Domain rules

| Area | Rule |
|---|---|
| Job numbers | Per garage, starting at 1, with no gaps or repeats even under concurrent requests (atomic `UPDATE … RETURNING`). Invoice numbers work the same way. |
| Job workflow | `OPEN → IN_PROGRESS ⇄ WAITING_PARTS → READY → CLOSED`. A job can be cancelled from any open state, and moved from `READY` back to `IN_PROGRESS` to reopen it. Invalid moves return `409`. |
| Stock | Stock only changes through a `stock_movements` row (`PURCHASE`, `JOB_USE`, `RETURN`, `ADJUSTMENT`, `WORKSHOP_USE`, `COUNT`), so stock always equals the sum of its history. It can never go below zero. A part line takes stock when it is added. Removing the line, or cancelling the job, puts the stock back. |
| Prices | Money is `Decimal`, never float. A labour line with no price uses the garage's labour rate. A part from inventory defaults to the part's selling price. |
| Invoices | A job must be `READY` or `CLOSED`, and have at least one line, to be invoiced. The invoice snapshots the lines and adds tax at the garage rate. While a job has a live invoice, its lines are locked: void the invoice to change them. A paid invoice can't be voided, and its job can't be cancelled. |
| Roles | The provider who owns the garage is OWNER. Mechanics are `staff_members` rows; the owner adds one and gets an 8-character invite code, and the mechanic joins by entering it while signed in with their own Kaduna account (`POST /staff/join`). A code works once. A mechanic can work jobs (status up to READY, lines, diagnosis, inspection, timeline notes) and read parts and the schedule. They can't open, close, cancel or invoice jobs, or see money, customers' records, suppliers, reports, staff or settings. Switching a mechanic off locks them out at once. |
| Timeline | Every status change writes a `job_updates` row, as do notes from the workshop and the customer's decisions. Public ones show on the tracking link; private notes stay in the workshop. |
| Inspections | One per job: a 25-point checklist or a blank one. Sending it makes every priced item that needs attention PENDING for the customer. If the price of an item that has already been decided changes, the customer is asked again. Approved work is added to the job as a labour line at the approved price, after which the customer can no longer change it. |
| Tracking link | `job_cards.tracking_token` holds 128 random bits and is the only key to `/api/v1/public/track/:token`. Resetting it revokes the link. The page shows first names only and never internal ids. A cancelled job shows nothing. |
| Driver status | Dispatch incidents carry no owner, so `GET /repairs?incidentIds=` is limited to status and the garage's public contact. It never returns prices, tokens or approvals. |
| Appointments | `BOOKED ⇄ CONFIRMED → ARRIVED` (check-in), or `CANCELLED` / `NO_SHOW`. Check-in creates the customer and vehicle when only a name and plate were booked, reuses a known plate, opens the job card with the booked mechanic, and is safe to repeat. |
| Online booking | The owner turns it on under Appointments and shares `/book?g=<booking_token>`. Free slots come from the opening hours cut into slot-length pieces in garage time. A slot is taken by live appointments, staff ones included, up to the number of cars per slot. Slots inside the notice period or beyond the booking window aren't offered. Booking locks the garage row and re-checks the slot, so the last place goes to one customer. Each booking gets its own token (`/book?a=…`) to view or cancel it before it starts. The public write is limited to 20 bookings per hour per address and 3 upcoming bookings per phone, and has a hidden spam field. Resetting the link revokes it. Check-in matches an online booker to an existing customer by phone. |
| Locations & filing | A part can have a kind (`PART` or `CONSUMABLE`), a category, a barcode (unique per garage) and a location (shelf, bay or cabinet). Tools and customer parts use the same locations. |
| Consumables | Bulk supplies (oil, cleaner, fasteners) are used in the workshop with a `WORKSHOP_USE` movement: negative only, no job needed, never below zero. |
| Stocktake | `POST /stock-counts` records what was counted next to what the books expected for each line, and writes a `COUNT` movement for every difference, so history still adds up. Each part can be counted once per stocktake. |
| Purchase orders | `DRAFT → ORDERED → PARTLY_RECEIVED → RECEIVED`, or `CANCELLED` before anything arrives. Numbers (`PO-n`) are per garage and gap-free. Only a draft can be edited. Goods-in books each delivered quantity as a `PURCHASE` from the order's supplier at the order price, and can be done in several deliveries. |
| Tools & equipment | Assets have a location, condition (`GOOD`, `FAIR`, `NEEDS_REPAIR`, `RETIRED`), an optional service interval and next-due date, and a log of check-outs, check-ins, services and condition changes. One mechanic holds an asset at a time (a conditional update stops two people taking it); a tool that needs repair or is retired cannot be handed out. |
| Customer parts held | Parts a customer owns that the garage is holding (`HELD`, then `FITTED` or `RETURNED`). They are separate from the garage's stock: never counted, priced or invoiced as stock. |
| Suppliers | A purchase records the supplier and unit cost on its stock movement, and the unit cost becomes the part's cost price. The first supplier a part is bought from becomes its usual supplier. Job use records the cost at the time, for reports. |
| Reports | Revenue counts paid invoices by the day they were paid, in garage time, using the invoice line snapshots. Parts cost covers only the jobs those invoices paid for. |
| Kaduna import | `POST /job-cards/from-dispatch` checks that the incident was assigned to this provider, and is safe to repeat (the same incident returns the same job card). If the incident's plate matches a vehicle the garage already knows, the job attaches to that vehicle and its owner. |

## Layout

```
prisma/schema.prisma     models + enums (snake_case tables via @map)
prisma/migrations/       applied with `prisma migrate deploy` on container start
src/app.ts               express app; createApp({ authenticate }) so tests can swap sign-in
src/middleware/auth.ts   Supabase JWT + provider link; dev bypass (never in production)
src/validation.ts        zod request schemas (also feed the OpenAPI contract)
src/services/            domain logic, one file per area, no HTTP in here
src/routes/              thin HTTP layer: parse → service (in a transaction) → present
src/services/presenters.ts  rows → API shapes (Decimal → number, internal columns dropped)
src/openapi.ts           builds the contract from the zod schemas
tests/                   integration tests against a real Postgres
```

## Running it

```bash
cp .env.example .env        # set DATABASE_URL (…?schema=garage), SUPABASE_URL, SUPABASE_ANON_KEY
npm install
npx prisma migrate deploy
npm run dev                 # http://localhost:3002/health
```

For local UI work without Supabase, set `DEV_AUTH_BYPASS_USER_ID` and `DEV_AUTH_BYPASS_PROVIDER_ID`. The bypass refuses to work when `NODE_ENV=production`. Point the web app at the service with `NEXT_PUBLIC_GARAGE_URL=http://localhost:3002`.

With Docker, the root `docker-compose.yml` runs it as `garage-management`. It needs `GARAGE_DATABASE_URL` in the root `.env`.

## Tests

```bash
npm test
```

`npm test` starts a throwaway PostgreSQL ([embedded-postgres](https://github.com/leinelissen/embedded-postgres)), so it needs no Docker or database setup. It applies the real migrations to that database and runs the HTTP API through supertest. The suite covers:

- tenancy
- numbering under concurrency
- the job workflow
- stock bookkeeping
- invoice locking
- the dashboard
- the dispatch import
- auth failing closed

It also checks that the contract lists exactly the routes the app serves, and that the committed YAML is current. If that last check fails, run `npm run openapi`.

CI is in `.github/workflows/garage-management.yml`. It type-checks, runs the tests and lints the contract.

## Growing it

The service is built so these can be added without reshaping it:

1. **Outbox relay.** A small worker reads unpublished `outbox_events` (ordered by `created_at`), publishes them to a queue or webhook, and sets `published_at`. Consumers this enables:
   - `job_card.closed` (which carries the plate, make, model and odometer reading) → predictive-maintenance, for real service history per vehicle.
   - `invoice.paid` → provider earnings and reporting.
   - `stock.low` → reorder notifications.
   - `appointment.booked`, `inspection.sent`, `inspection.item_decided` → customer and owner notifications (see 2).
2. **Notifications.** Text or WhatsApp the tracking link automatically when an inspection is sent or a job is ready. The outbox events above carry what is needed.
3. **Driver ownership.** Once dispatch records which user reported an incident, `/repairs` can also return the tracking token, so drivers can approve work inside the Kaduna app.
4. **Scale.** The service is stateless, so it can run several replicas behind Caddy. Every list query is paginated and indexed by `garage_id`. Number allocation is a row lock on one garage, so garages never contend with each other.
