# Intelligent 3D Accident Claim & Privacy-Enforced Ecosystem

**Owner:** De Silva R K D H — Dilnuk (IT22001252)

## What this component does

Reconstructs accident scenes in 3D from multi-angle smartphone photos for fraud detection on insurance claims, and provides the Privacy-by-Design microservices layer (API Gateway + RBAC) that all other components route through for PDPA-compliant data handling.

## Status

The **capture-upload backend** has been migrated in from `rp-group/Guided-Camera/backend/` and runs here as a FastAPI service (see "Capture-upload backend (live)" below). The remaining scope — 3D reconstruction, low-light enhancement, and the RBAC/privacy gateway — is still **planned**.

The Expo mobile app should land at `apps/mobile/`; the Python backend now lives here at `components/claims-privacy/`.

## Stack (planned)

- Node.js + Python (Keras for low-light enhancement)
- OpenMVG / OpenMVS / AliceVision (3D reconstruction)
- Kubernetes (microservices)
- Azure Service Bus (async messaging)
- JWT + RBAC + AES-256

## Pipeline

1. Guided multi-angle capture (mobile)
2. Low-light enhancement (Zero-DCE, on-device)
3. 3D point cloud + mesh generation
4. Temporal & fraud validation (metadata cross-check)
5. RBAC-masked delivery per stakeholder role

## Cross-cutting role

This component owns the **API Gateway** for the platform. All inter-component traffic flows through it; it enforces JWT authentication and RBAC. Other components publish their APIs as documented in `contracts/`; the gateway routes and masks per role.

---

## Capture-upload backend (live)

Migrated from `rp-group/Guided-Camera/backend/` (which remains in place as the source of truth). This is the FastAPI capture-upload service that backs step 1 of the pipeline: **original** (camera) photos and **enhanced** (e.g. low-light / Zero-DCE) photos are stored separately in PostgreSQL and R2, sharing one capture session.

It **degrades gracefully** when R2/DB are unset: `/health` returns ok, `/health/ready` reports each integration as `false`, and the capture endpoints return a clean `503` instead of crashing.

### Environment variables

Copy `.env.example` to `.env` in `components/claims-privacy/` and fill in values.

| Variable | Purpose |
| --- | --- |
| `DATABASE_URL` | PostgreSQL URL (e.g. `postgresql://user:pass@host:5432/dbname`) |
| `R2_ACCOUNT_ID` | Cloudflare account ID (optional metadata; not required for S3 client) |
| `R2_ACCESS_KEY_ID` | R2 S3 API access key |
| `R2_SECRET_ACCESS_KEY` | R2 S3 API secret |
| `R2_BUCKET_NAME` | Bucket name |
| `R2_ENDPOINT_URL` | S3 endpoint, e.g. `https://<account_id>.r2.cloudflarestorage.com` |
| `R2_PUBLIC_BASE_URL` | Optional public URL for objects if you use a custom domain |
| `MIN_CAPTURE_PHOTOS` | Minimum **original** photos before `POST .../complete` (default `5` in `app.config.Settings`; set in `.env` to override) |

`GET /health/ready` returns `{ "postgres": bool, "r2": bool }` indicating whether each integration is configured (no secrets in the response).

### Pipelines (original vs enhanced)

Two upload tracks share one capture session and the same **`photo_index`** per shot (0, 1, 2, …).

| Track | `asset_kind` | When it is "done" (app UX) | R2 key prefix |
| --- | --- | --- | --- |
| **Originals** | `original` (default) | All camera files uploaded; `GET .../status` → `originals_meet_minimum` | `captures/{id}/original/...` |
| **Low-light / enhanced** | `enhanced` | Every original index has a matching enhanced row; `enhancement_complete` | `captures/{id}/enhanced/...` |

Rules:

- Upload **originals first** for each `photo_index`. **`enhanced` is rejected (400)** if no **original** exists for that index.
- **Retry:** upload again with the same `capture_id`, `photo_index`, and `asset_kind`. The row is **upserted**; the previous R2 object for that row is deleted when the key changes.

**Completing a session:** `POST /captures/{id}/complete` only checks the **original** count against `MIN_CAPTURE_PHOTOS`. Enhanced uploads are **not** required to complete (you can finish the session while enhancement is still in progress, or finish enhancement afterward depending on product rules).

### Endpoints

- `GET  /health` — liveness, always `{"status": "ok"}`.
- `GET  /health/ready` — readiness, `{"postgres": bool, "r2": bool}` (no secrets).
- `POST /captures` — create a capture session. Optional **JSON body**: `claimant_name`, `claimant_nic`, `claimant_licence_number`, `report_captured_at` (ISO-8601), `report_gps_lat`, `report_gps_lng`, `report_location_label`, plus the `insurer_call_*` and `guided_capture_start_*` location-snapshot fields. Those fields are saved on the `captures` row and, on each `POST .../photos`, are written to the object's R2 custom metadata (ASCII-safe user metadata keys such as `claimant-name`, `report-timestamp`, `report-location`).
- `POST /captures/{capture_id}/photos` — upload one photo (multipart form-data):
  - **`photo_index`** (int, ≥ 0)
  - **`asset_kind`** (optional, default `original`): `original` | `enhanced`
  - **`photo`** (file)
  - Optional metadata: `gps_lat`, `gps_lng`, `gps_alt`, `gps_accuracy`, `captured_at_client`
- `POST /captures/{capture_id}/complete` — marks capture as `processing` if enough **original** photos exist. Response includes:
  - **`uploaded_photo_count`** — number of **original** assets
  - **`uploaded_enhanced_count`** — number of **enhanced** assets at completion time
- `GET  /captures/{capture_id}/status` — session status plus:
  - **`uploaded_photo_count`** — total rows (original + enhanced)
  - **`original_photo_count`** / **`enhanced_photo_count`**
  - **`originals_meet_minimum`** — `original_photo_count >= MIN_CAPTURE_PHOTOS`
  - **`enhancement_complete`** — every original has a matching `enhanced` row for the same `photo_index`

### Run locally (monorepo, port 5002)

Python is managed with **uv**. R2/DB are left unconfigured for local boot — the service runs in degraded mode.

```bash
cd components/claims-privacy
uv venv --python 3.12
uv pip install -r requirements.txt
.venv/bin/python -m uvicorn app.main:app --host 0.0.0.0 --port 5002
```

Health checks:

```bash
curl -s localhost:5002/health        # {"status":"ok"}
curl -s localhost:5002/health/ready  # {"postgres":false,"r2":false}
```

Tests:

```bash
.venv/bin/pytest -q
```

### Port

`5002`. (Taken on this box: geo `5001`, predictive `5000`; dispatch `3001`, auth `3002`, dashboard `3000`.)

### Deferred

3D reconstruction (OpenMVG/OpenMVS/AliceVision), low-light enhancement (Zero-DCE/Keras), the RBAC/privacy API gateway, and R2/Postgres provisioning for captures are all out of scope for this boot/integration and remain planned.
