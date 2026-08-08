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
export function requireUser(req: Request, res: Response, next: NextFunction): void {
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
