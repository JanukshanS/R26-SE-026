/**
 * Who is calling.
 *
 *   authenticate      verifies the Supabase bearer token (ES256, the project's
 *                     JWKS) and sets req.userId.
 *   requireShop       the shop the caller works at: the one they own, or one
 *                     whose staff they're on (req.actor: role and permissions).
 *   allow(...)        the caller's role has one of these permissions.
 *   requireGarage     the garage the caller acts for, asked of the garage
 *                     service with their own token: OWNER (the provider who
 *                     runs it) or MECHANIC. Cached briefly per account.
 */
import { Shop } from '@prisma/client';
import { NextFunction, Request, Response } from 'express';
import jwt, { JwtHeader, SigningKeyCallback } from 'jsonwebtoken';
import jwksClient, { JwksClient } from 'jwks-rsa';

import { config } from '../config';
import { garages } from '../services/garageClient';
import { Actor, Permission, assertCan, resolveShop } from '../services/staff';
import { DomainError } from '../utils/http';
import { logger } from '../utils/logger';
import { prisma } from '../utils/prisma';

export interface GarageContext {
  garageId: string;
  name: string;
  phone: string | null;
  address: string | null;
  role: 'OWNER' | 'MECHANIC';
}

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request {
      userId?: string;
      userEmail?: string | null;
      userName?: string | null;
      authToken?: string;
      shop?: Shop;
      actor?: Actor;
      garage?: GarageContext;
    }
  }
}

function deny(res: Response, status: number, error: string): void {
  const r = status === 401 ? res.set('WWW-Authenticate', 'Bearer') : res;
  r.status(status).json({ success: false, error, timestamp: new Date().toISOString() });
}

let client: JwksClient | null = null;

function getKey(header: JwtHeader, callback: SigningKeyCallback): void {
  client ??= jwksClient({ jwksUri: `${config.supabaseUrl}/auth/v1/.well-known/jwks.json`, cache: true, cacheMaxAge: 60 * 60 * 1000, rateLimit: true });
  client.getSigningKey(header.kid, (err, key) => (err || !key ? callback(err ?? new Error('Signing key not found')) : callback(null, key.getPublicKey())));
}

type Claims = { sub: string; email: string | null; name: string | null };

function verify(token: string): Promise<Claims> {
  return new Promise((resolve, reject) => {
    jwt.verify(token, getKey, { algorithms: ['ES256'], audience: 'authenticated', issuer: `${config.supabaseUrl}/auth/v1`, clockTolerance: 120 }, (err, decoded) => {
      if (err || !decoded || typeof decoded === 'string' || !decoded.sub) {
        reject(err ?? new Error('no subject claim'));
        return;
      }
      const meta = (decoded.user_metadata ?? {}) as Record<string, unknown>;
      const name = [meta.full_name, meta.name].find((x): x is string => typeof x === 'string' && x.trim() !== '') ?? null;
      resolve({ sub: decoded.sub, email: typeof decoded.email === 'string' ? decoded.email : null, name });
    });
  });
}

export async function authenticate(req: Request, res: Response, next: NextFunction): Promise<void> {
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
    const claims = await verify(token);
    req.userId = claims.sub;
    req.userEmail = claims.email;
    req.userName = claims.name ?? claims.email?.split('@')[0] ?? null;
    req.authToken = token;
    next();
  } catch (err) {
    logger.warn(`Bearer token rejected: ${(err as Error).message}`);
    deny(res, 401, 'Invalid or expired token');
  }
}

export async function requireShop(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const found = await resolveShop(prisma, { userId: req.userId!, email: req.userEmail, name: req.userName });
    if (!found) {
      deny(res, 404, 'Set up your parts shop first');
      return;
    }
    req.shop = found.shop;
    req.actor = found.actor;
    next();
  } catch (err) {
    next(err);
  }
}

const GARAGE_TTL_MS = 30_000;
const garageCache = new Map<string, { ctx: GarageContext | null; expiresAt: number }>();

export async function requireGarage(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const cached = garageCache.get(req.userId!);
    let ctx = cached && cached.expiresAt > Date.now() ? cached.ctx : undefined;
    if (ctx === undefined) {
      const me = await garages().me(req.authToken ?? '');
      ctx = me.role && me.garage ? { garageId: me.garage.id, name: me.garage.name, phone: me.garage.phone, address: me.garage.address, role: me.role } : null;
      garageCache.set(req.userId!, { ctx, expiresAt: Date.now() + GARAGE_TTL_MS });
    }
    if (!ctx) {
      deny(res, 403, "This account isn't the owner or a mechanic of a garage");
      return;
    }
    req.garage = ctx;
    next();
  } catch (err) {
    if (err instanceof DomainError) {
      deny(res, err.status === 401 ? 403 : err.status, err.message);
      return;
    }
    next(err);
  }
}

/** The caller's role has at least one of these permissions. */
export const allow =
  (...permissions: Permission[]) =>
  (req: Request, _res: Response, next: NextFunction): void => {
    try {
      assertCan(req.actor, ...permissions);
      next();
    } catch (err) {
      next(err);
    }
  };

/** Spending money with a shop is the garage owner's. */
export function garageOwnerWrites(req: Request, res: Response, next: NextFunction): void {
  if (req.method !== 'GET' && req.garage?.role !== 'OWNER') {
    deny(res, 403, 'Only the garage owner can do that');
    return;
  }
  next();
}

/** For tests: forget cached garage roles. */
export const clearGarageCache = () => garageCache.clear();
