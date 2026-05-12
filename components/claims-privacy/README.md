# Guided Camera API (FastAPI)

FastAPI service for capture sessions: **original** (camera) photos and **enhanced** (e.g. low-light / Zero-DCE) photos are stored separately in PostgreSQL and R2.

## Environment variables

Copy `.env.example` to `.env` in the `backend` directory and fill in values.

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

---

## Pipelines (original vs enhanced)

Two upload tracks share one capture session and the same **`photo_index`** per shot (0, 1, 2, …).

| Track | `asset_kind` | When it is “done” (app UX) | R2 key prefix |
| --- | --- | --- | --- |
| **Originals** | `original` (default) | All camera files uploaded; `GET .../status` → `originals_meet_minimum` | `captures/{id}/original/...` |
| **Low-light / enhanced** | `enhanced` | Every original index has a matching enhanced row; `enhancement_complete` | `captures/{id}/enhanced/...` |

Rules:

- Upload **originals first** for each `photo_index`. **`enhanced` is rejected (400)** if no **original** exists for that index.
- **Retry:** upload again with the same `capture_id`, `photo_index`, and `asset_kind`. The row is **upserted**; the previous R2 object for that row is deleted when the key changes.

**Completing a session:** `POST /captures/{id}/complete` only checks the **original** count against `MIN_CAPTURE_PHOTOS`. Enhanced uploads are **not** required to complete (you can finish the session while enhancement is still in progress, or finish enhancement afterward depending on product rules).

---

## Capture upload API

1. **`POST /captures`** — Create a capture session (`status`: `uploading`). Optional **JSON body**: `claimant_name`, `claimant_nic`, `claimant_licence_number`, `report_captured_at` (ISO-8601), `report_gps_lat`, `report_gps_lng`, `report_location_label`. Those fields are saved on the `captures` row and, on each **`POST .../photos`**, are written to the object’s **R2 custom metadata** (ASCII-safe user metadata keys such as `claimant-name`, `report-timestamp`, `report-location`).

2. **`POST /captures/{capture_id}/photos`** — Multipart form-data:
   - **`photo_index`** (int, ≥ 0)
   - **`asset_kind`** (optional, default `original`): `original` | `enhanced`
   - **`photo`** (file)
   - Optional metadata: `gps_lat`, `gps_lng`, `gps_alt`, `gps_accuracy`, `captured_at_client`

3. **`POST /captures/{capture_id}/complete`** — Marks capture as `processing` if enough **original** photos exist. Response includes:
   - **`uploaded_photo_count`** — number of **original** assets
   - **`uploaded_enhanced_count`** — number of **enhanced** assets at completion time

4. **`GET /captures/{capture_id}/status`** — Session metadata plus:
   - **`uploaded_photo_count`** — total rows (original + enhanced)
   - **`original_photo_count`** / **`enhanced_photo_count`**
   - **`originals_meet_minimum`** — `original_photo_count >= MIN_CAPTURE_PHOTOS`
   - **`enhancement_complete`** — every original has a matching `enhanced` row for the same `photo_index`

---

## Run locally

```bash
cd backend
python3 -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt
uvicorn app.main:app --reload
```

Health checks:

```bash
curl http://127.0.0.1:8000/health
curl http://127.0.0.1:8000/health/ready
```

## Run tests

```bash
cd backend
source .venv/bin/activate
pytest -q
```
