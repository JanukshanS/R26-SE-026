# Backend skeleton (Week 2)

Minimal FastAPI service for Week 2 milestone.

## Environment variables

Copy `.env.example` to `.env` in the `backend` directory and fill in values.

| Variable | Purpose |
| --- | --- |
| `DATABASE_URL` | PostgreSQL URL (e.g. `postgresql+asyncpg://user:pass@host:5432/dbname`) |
| `R2_ACCOUNT_ID` | Cloudflare account ID (optional metadata; not required for S3 client) |
| `R2_ACCESS_KEY_ID` | R2 S3 API access key |
| `R2_SECRET_ACCESS_KEY` | R2 S3 API secret |
| `R2_BUCKET_NAME` | Bucket name |
| `R2_ENDPOINT_URL` | S3 endpoint, e.g. `https://<account_id>.r2.cloudflarestorage.com` |
| `R2_PUBLIC_BASE_URL` | Optional public URL for objects if you use a custom domain |
| `MIN_CAPTURE_PHOTOS` | Minimum photo count required to finalize a capture session (default `6`) |

`GET /health/ready` returns `{ "postgres": bool, "r2": bool }` indicating whether each integration is configured (no secrets in the response).

## Capture upload API (Option 2 flow)

1. `POST /captures` -> create a capture session.
2. `POST /captures/{capture_id}/photos` -> upload one photo as multipart form-data with:
   - `photo_index` (int, starts at `0`)
   - `photo` (file)
   - optional: `gps_lat`, `gps_lng`, `gps_alt`, `gps_accuracy`, `captured_at_client`
3. `POST /captures/{capture_id}/complete` -> marks capture as `processing` if enough photos are uploaded.
4. `GET /captures/{capture_id}/status` -> retrieve session status and uploaded photo count.

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

