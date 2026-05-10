# Mobile App (React Native / Expo)

Cross-platform mobile app for the Kaduna.lk platform. Serves stranded drivers, fleet managers, and assistance providers. Also hosts the guided multi-angle photo capture used by the claims-privacy component for 3D accident reconstruction.

## Status

Skeleton — to be migrated from `rp-group/Guided-Camera/frontend/`. The Guided-Camera workspace was Dilnuk's prototype for the photo-capture flow; once migrated here, the same Expo app houses all consumer-facing flows for the team.

## Stack

- Expo (React Native)
- TypeScript

## Roles to host (post-migration)

- **Driver flow** — request roadside assistance, see ETA, see provider details
- **Provider flow** — receive dispatches, mark on-scene / resolved
- **Capture flow** — guided 3D accident photo capture (current Guided-Camera prototype)

## Run (after migration)

```bash
cd apps/mobile
npm install
npx expo start
```
