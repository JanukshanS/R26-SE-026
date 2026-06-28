# auth-service

Authentication + user/vehicle persistence for Kaduna.lk. TypeScript + Express + Prisma 5.22, Postgres, port **3002**.

Speaks the same `Authorization: Bearer <token>` model as the rest of the app. Supersedes the throwaway `components/vehicle-service` (Express + sql.js), which is left in place but no longer the source of truth.

## Tokens

- **Access token**: JWT, HS256, ~15min (`ACCESS_TTL`), signed with `JWT_SECRET`, carries `{ sub: userId, role }`. Stateless; verified by `requireAuth`.
- **Refresh token**: opaque random string, ~30d (`REFRESH_TTL`), stored in `refresh_tokens`. Rotated on every `/refresh` (old one marked `revoked`). Revoked on `/logout`.

## Endpoints

| Method | Path | Auth | Notes |
| --- | --- | --- | --- |
| POST | `/api/auth/register` | - | `{name,email,password,phone?,role?}` -> 201 `{user, accessToken, refreshToken}`. Self-register limited to `driver`/`provider`; `ops` is forced to `driver`. |
| POST | `/api/auth/login` | - | `{email,password}` -> `{user, accessToken, refreshToken}`; 401 on bad creds. |
| POST | `/api/auth/refresh` | - | `{refreshToken}` -> rotated `{accessToken, refreshToken}`; 401 if invalid/revoked/expired. |
| GET | `/api/auth/me` | Bearer | -> `{user}`. |
| POST | `/api/auth/logout` | Bearer | `{refreshToken}` -> revoke it. |
| GET | `/api/v1/vehicles` | Bearer | List caller's vehicles. |
| POST | `/api/v1/vehicles` | Bearer | Create (first vehicle becomes default). |
| PUT | `/api/v1/vehicles/:id` | Bearer | Update caller's vehicle. |
| DELETE | `/api/v1/vehicles/:id` | Bearer | Delete; default re-points to oldest remaining. |
| POST | `/api/v1/vehicles/:id/set-default` | Bearer | Make this the caller's default. |
| GET | `/api/v1/admin/users` | Bearer + role `ops` | List users (role-guard demo). |
| GET | `/health` | - | DB ping. |

All responses use the `{ success, data, error, timestamp }` envelope.

## Run

```
npm install
npx prisma generate
npx prisma migrate deploy   # or: npx prisma migrate dev --name init
npm run dev                 # ts-node + nodemon, or: npm run build && npm start
```

Database is separate from dispatch so migrations never collide:
`DATABASE_URL=postgresql://kaduna:kaduna_dev@localhost:5432/kaduna_auth?schema=public`

## Deferred (out of scope, intentionally)

No OAuth/social login, no MFA, no email verification, no password reset. Hooks for later:

- **Password reset / email verification**: add a `VerificationToken` model alongside `RefreshToken` (same opaque-token + expiry + consumed pattern), plus `POST /api/auth/forgot-password` and `POST /api/auth/reset-password`. The bcrypt hashing in `register`/`login` and the token plumbing in `src/services/tokens.ts` are the reuse points.
- **MFA**: add a TOTP secret column on `User` and a verification step between password check and `issueTokenPair` in `/login`.
- **OAuth**: add a provider/account table; mint the same access/refresh pair via `issueTokenPair` after the external callback.
