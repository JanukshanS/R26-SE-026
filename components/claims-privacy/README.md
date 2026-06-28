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

Migrated from `rp-group/Guided-Camera/backend/` (which remains in place as the source of truth). This is the FastAPI capture-upload service that backs step 1 of the pipeline. It uses psycopg (PostgreSQL) for capture/photo metadata and boto3 against Cloudflare R2 (S3-compatible) for photo blobs.

It **degrades gracefully** when R2/DB are unset: `/health` returns ok, `/health/ready` reports each integration as `false`, and the capture endpoints return a clean `503` instead of crashing. Full backend-specific docs (env vars, endpoint contract) are in [`BACKEND_README.md`](./BACKEND_README.md).

### Endpoints

- `GET  /health` — liveness, always `{"status": "ok"}`.
- `GET  /health/ready` — readiness, `{"postgres": bool, "r2": bool}` (no secrets).
- `POST /captures` — create a capture session.
- `POST /captures/{capture_id}/photos` — upload one photo (multipart).
- `POST /captures/{capture_id}/complete` — finalize once enough photos uploaded.
- `GET  /captures/{capture_id}/status` — session status + uploaded photo count.

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
