/**
 * Who is calling, and which garage they may act for.
 *
 * Token verification is the same as dispatch's: Supabase access tokens are
 * ES256-signed and checked against the project's JWKS, so only SUPABASE_URL
 * is needed. jsonwebtoken + jwks-rsa rather than jose because this service
 * compiles to CommonJS and jose is ESM-only.
 *
 * A garage belongs to a dispatch Provider. The link lives in Supabase's
 * profiles.provider_id, so it is read with the caller's own token (RLS lets a
 * user see only their own row) and cached briefly. A hit is cached for a
 * minute; a miss for only a few seconds, so a provider who has just finished
 * onboarding is not locked out, while mechanics (who have no provider link)
 * don't cost a Supabase round trip on every request.
 *
 * Who may act for a garage:
 *   OWNER     the provider the garage belongs to: everything.
 *   MECHANIC  an active StaffMember linked to the user: workshop work (job
 *             cards, lines, inspections, the timeline), never money,
 *             settings or staff.
 */
import { Garage, StaffMember } from '@prisma/client';
import { NextFunction, Request, Response } from 'express';
import jwt, { JwtHeader, SigningKeyCallback } from 'jsonwebtoken';
import jwksClient, { JwksClient } from 'jwks-rsa';

import { config } from '../config';
import { logger } from '../utils/logger';
import { prisma } from '../utils/prisma';

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request {
      userId?: string;
      providerId?: string;
      authToken?: string;
      garage?: Garage;
      role?: 'OWNER' | 'MECHANIC';
      staff?: StaffMember;
    }
  }
}

function deny(res: Response, status: number, error: string): void {
  const r = status === 401 ? res.set('WWW-Authenticate', 'Bearer') : res;
  r.status(status).json({ success: false, error, timestamp: new Date().toISOString() });
}

/**
 * Local development escape hatch, as in dispatch. Refuses to engage in
 * production, so a stray env var on the server cannot switch auth off.
 */
const devBypass =
  process.env.NODE_ENV !== 'production' && process.env.DEV_AUTH_BYPASS_USER_ID && process.env.DEV_AUTH_BYPASS_PROVIDER_ID
    ? { userId: process.env.DEV_AUTH_BYPASS_USER_ID, providerId: process.env.DEV_AUTH_BYPASS_PROVIDER_ID }
    : null;

let client: JwksClient | null = null;

function getKey(header: JwtHeader, callback: SigningKeyCallback): void {
  client ??= jwksClient({
    jwksUri: `${config.supabaseUrl}/auth/v1/.well-known/jwks.json`,
    cache: true,
    cacheMaxAge: 60 * 60 * 1000,
    rateLimit: true,
  });
  client.getSigningKey(header.kid, (err, key) => (err || !key ? callback(err ?? new Error('Signing key not found')) : callback(null, key.getPublicKey())));
}

function verify(token: string): Promise<string> {
  return new Promise((resolve, reject) => {
    jwt.verify(
      token,
      getKey,
      { algorithms: ['ES256'], audience: 'authenticated', issuer: `${config.supabaseUrl}/auth/v1`, clockTolerance: 120 },
      (err, decoded) => {
        if (err || !decoded || typeof decoded === 'string' || !decoded.sub) reject(err ?? new Error('no subject claim'));
        else resolve(decoded.sub);
      },
    );
  });
}

const PROVIDER_CACHE_TTL_MS = 60_000;
const NO_PROVIDER_CACHE_TTL_MS = 10_000;
const providerCache = new Map<string, { providerId: string | null; expiresAt: number }>();

async function lookupProviderId(userId: string, token: string): Promise<string | null> {
  const cached = providerCache.get(userId);
  if (cached && cached.expiresAt > Date.now()) return cached.providerId;
  const url = `${config.supabaseUrl}/rest/v1/profiles?select=provider_id&id=eq.${encodeURIComponent(userId)}`;
  const response = await fetch(url, {
    headers: { apikey: config.supabaseAnonKey, Authorization: `Bearer ${token}` },
    signal: AbortSignal.timeout(3000),
  });
  if (!response.ok) throw new Error(`profile lookup HTTP ${response.status}`);
  const rows = (await response.json()) as { provider_id?: string | null }[];
  const providerId = rows?.[0]?.provider_id ?? null;
  providerCache.set(userId, { providerId, expiresAt: Date.now() + (providerId ? PROVIDER_CACHE_TTL_MS : NO_PROVIDER_CACHE_TTL_MS) });
  return providerId;
}

/**
 * Verifies the bearer token and sets req.userId, plus req.providerId when the
 * account is linked to a service provider. Accounts without a provider link
 * get through as well: they may be mechanics, or about to join a garage.
 */
export async function authenticate(req: Request, res: Response, next: NextFunction): Promise<void> {
  if (devBypass) {
    req.userId = devBypass.userId;
    req.providerId = devBypass.providerId;
    next();
    return;
  }
  if (!config.supabaseUrl || !config.supabaseAnonKey) {
    deny(res, 503, 'SUPABASE_URL and SUPABASE_ANON_KEY must be configured');
    return;
  }
  const [scheme, token] = (req.headers.authorization ?? '').split(' ');
  if (!token || scheme?.toLowerCase() !== 'bearer') {
    deny(res, 401, 'Missing bearer token');
    return;
  }
  try {
    req.userId = await verify(token);
  } catch (err) {
    // Covers a bad token and an unreachable JWKS endpoint alike; log which.
    logger.warn(`Bearer token rejected: ${(err as Error).message}`);
    deny(res, 401, 'Invalid or expired token');
    return;
  }
  let providerId: string | null;
  try {
    providerId = await lookupProviderId(req.userId, token);
  } catch (err) {
    logger.warn(`Provider lookup failed: ${(err as Error).message}`);
    deny(res, 502, 'Could not verify your provider account');
    return;
  }
  req.providerId = providerId ?? undefined;
  req.authToken = token;
  next();
}

/** Setting up and changing the garage itself is for the provider who owns it. */
export function requireProviderAccount(req: Request, res: Response, next: NextFunction): void {
  if (!req.providerId) {
    deny(res, 403, "This account isn't linked to a service provider");
    return;
  }
  next();
}

/**
 * Puts the caller's garage on req.garage, with req.role: OWNER through the
 * provider link, or MECHANIC through an active StaffMember row.
 */
export async function requireGarage(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    if (req.providerId) {
      const garage = await prisma.garage.findUnique({ where: { providerId: req.providerId } });
      if (!garage) {
        deny(res, 404, 'Set up your garage first');
        return;
      }
      req.garage = garage;
      req.role = 'OWNER';
      next();
      return;
    }
    const staff = req.userId ? await prisma.staffMember.findUnique({ where: { userId: req.userId }, include: { garage: true } }) : null;
    if (!staff || !staff.active) {
      deny(res, 403, "This account isn't linked to a service provider or a garage");
      return;
    }
    const { garage, ...member } = staff;
    req.garage = garage;
    req.staff = member;
    req.role = 'MECHANIC';
    next();
  } catch (err) {
    next(err);
  }
}

/** Money, settings, staff and the records only the owner manages. */
export function ownerOnly(req: Request, res: Response, next: NextFunction): void {
  if (req.role !== 'OWNER') {
    deny(res, 403, 'Only the garage owner can do that');
    return;
  }
  next();
}

/** For mixed routers: reads are open to the whole workshop, changes are the owner's. */
export function ownerWrites(req: Request, res: Response, next: NextFunction): void {
  if (req.method === 'GET') next();
  else ownerOnly(req, res, next);
}

/** Who to credit on the job timeline: the mechanic's name, or null for the owner ("the workshop"). */
export const authorOf = (req: Request): string | null => (req.role === 'MECHANIC' ? req.staff?.name ?? null : null);
