# Intelligent 3D Accident Claim & Privacy-Enforced Ecosystem

**Owner:** De Silva R K D H — Dilnuk (IT22001252)

## What this component does

Reconstructs accident scenes in 3D from multi-angle smartphone photos for fraud detection on insurance claims, and provides the Privacy-by-Design microservices layer (API Gateway + RBAC) that all other components route through for PDPA-compliant data handling.

## Status

Skeleton — backend and frontend code to be migrated from the existing `rp-group/Guided-Camera/` workspace. The Expo mobile app should land at `apps/mobile/`; the Python backend should land here at `components/claims-privacy/`.

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
