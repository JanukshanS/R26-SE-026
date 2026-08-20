/**
 * ============================================================================
 * UADO Framework — Supabase bearer-token authentication
 * ============================================================================
 *
 * Callers send the Supabase access token as `Authorization: Bearer <jwt>`.
 * Tokens are ES256-signed and the public half is published at the project's
 * JWKS endpoint, so verification needs no shared secret — only SUPABASE_URL.
 *
 * jsonwebtoken + jwks-rsa rather than jose: this service compiles to CommonJS
 * and jose is ESM-only, so `require()` of it fails at runtime on Node 18.
 *
 * @module middleware/auth
 */

import { NextFunction, Request, Response } from 'express';
import jwt, { JwtHeader, SigningKeyCallback } from 'jsonwebtoken';
import jwksClient, { JwksClient } from 'jwks-rsa';

import { config } from '../config';
import { logger } from '../utils/logger';

/** Supabase user id of the verified caller, set by `requireUser`. */
declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request {
      userId?: string;
    }
  }
}

let client: JwksClient | null = null;

function keyClient(): JwksClient {
  if (!client) {
    client = jwksClient({
      jwksUri: `${config.supabaseUrl}/auth/v1/.well-known/jwks.json`,
      cache: true,
      cacheMaxAge: 60 * 60 * 1000,
      rateLimit: true,
    });
  }
  return client;
}

function getKey(header: JwtHeader, callback: SigningKeyCallback): void {
  keyClient().getSigningKey(header.kid, (err, key) => {
    if (err || !key) {
      callback(err ?? new Error('Signing key not found'));
      return;
    }
    callback(null, key.getPublicKey());
  });
}

function unauthenticated(res: Response, message: string): void {
  res.status(401).set('WWW-Authenticate', 'Bearer').json({
    success: false,
    error: message,
    timestamp: new Date().toISOString(),
  });
}

/**
 * Verifies the bearer token and puts the Supabase user id on `req.userId`.
 * Responds 503 when SUPABASE_URL is unset, so a misconfigured deploy refuses
 * requests instead of serving them unauthenticated.
 */
/**
 * Local development escape hatch. Set DEV_AUTH_BYPASS_USER_ID to run the spine
 * without Supabase tokens; every request is then treated as that user and
 * provider ownership is not checked. Refuses to engage when NODE_ENV is
 * production, so it cannot be switched on by a stray env var in a deploy.
 */
export const devBypassUserId: string | null =
  process.env.NODE_ENV !== 'production' && process.env.DEV_AUTH_BYPASS_USER_ID
    ? process.env.DEV_AUTH_BYPASS_USER_ID
    : null;

export function requireUser(req: Request, res: Response, next: NextFunction): void {
  if (devBypassUserId) {
    req.userId = devBypassUserId;
    next();
    return;
  }

  if (!config.supabaseUrl) {
    res.status(503).json({
      success: false,
      error: 'SUPABASE_URL is not configured',
      timestamp: new Date().toISOString(),
    });
    return;
  }

  const header = req.headers.authorization ?? '';
  const [scheme, token] = header.split(' ');
  if (!token || scheme?.toLowerCase() !== 'bearer') {
    unauthenticated(res, 'Missing bearer token');
    return;
  }

  jwt.verify(
    token,
    getKey,
    {
      algorithms: ['ES256'],
      audience: 'authenticated',
      issuer: `${config.supabaseUrl}/auth/v1`,
    },
    (err, decoded) => {
      if (err || !decoded || typeof decoded === 'string' || !decoded.sub) {
        // Covers both a bad token and an unreachable JWKS endpoint, which the
        // client cannot tell apart. Log the cause so an outage is diagnosable
        // from the container logs rather than looking like bad credentials.
        logger.warn(`Bearer token rejected: ${err?.message ?? 'no subject claim'}`);
        unauthenticated(res, 'Invalid or expired token');
        return;
      }
      req.userId = decoded.sub;
      next();
    }
  );
}

/**
 * Provider ownership.
 *
 * There is no user column on Provider — the link lives in Supabase's
 * `profiles.provider_id`, written by the mobile app. So dispatch reads the
 * caller's own profile row from PostgREST using the caller's own token: RLS
 * then guarantees a user can only ever see their own row, and this service
 * still holds no credentials beyond the public anon key.
 */
const PROFILE_CACHE_TTL_MS = 60_000;

/** userId → provider id, only for successful non-null lookups. */
const profileCache = new Map<string, { providerId: string; expiresAt: number }>();

function deny(res: Response, status: number, error: string): false {
  res.status(status).json({ success: false, error, timestamp: new Date().toISOString() });
  return false;
}

/**
 * Resolves whether `req`'s caller owns `providerId`. Returns true when they do;
 * otherwise it has already written the response and the handler must return.
 *
 * Fails closed at every step: missing config is 503, an unreachable or
 * unhappy PostgREST is 502, and anything else — no profile row, a null
 * provider_id, a different provider — is 403.
 */
export async function assertOwnsProvider(
  req: Request,
  res: Response,
  providerId: string
): Promise<boolean> {
  if (devBypassUserId) return true;

  if (!config.supabaseUrl || !config.supabaseAnonKey) {
    return deny(res, 503, 'SUPABASE_URL and SUPABASE_ANON_KEY must be configured');
  }
  if (!req.userId) return deny(res, 401, 'Missing bearer token');

  const cached = profileCache.get(req.userId);
  if (cached && cached.expiresAt > Date.now()) {
    return cached.providerId === providerId
      ? true
      : deny(res, 403, 'Caller does not own this provider');
  }

  let owned: string | null;
  try {
    const url = `${config.supabaseUrl}/rest/v1/profiles?select=provider_id&id=eq.${encodeURIComponent(req.userId)}`;
    const response = await fetch(url, {
      headers: {
        apikey: config.supabaseAnonKey,
        Authorization: req.headers.authorization ?? '',
      },
      signal: AbortSignal.timeout(2000),
    });
    if (!response.ok) {
      logger.warn(`Profile lookup HTTP ${response.status}; denying provider-scoped request`);
      return deny(res, 502, 'Could not verify provider ownership');
    }
    const rows = (await response.json()) as { provider_id?: string | null }[];
    owned = rows?.[0]?.provider_id ?? null;
  } catch (err: any) {
    logger.warn(`Profile lookup failed (${err?.message ?? err}); denying provider-scoped request`);
    return deny(res, 502, 'Could not verify provider ownership');
  }

  // Only successes are cached: caching the empty result would lock a driver
  // out of their own jobs for a minute after they finish onboarding.
  if (owned) profileCache.set(req.userId, { providerId: owned, expiresAt: Date.now() + PROFILE_CACHE_TTL_MS });

  return owned === providerId ? true : deny(res, 403, 'Caller does not own this provider');
}
