/**
 * Response envelope and error handling, matching dispatch: every body is
 * `{ success, data | error, timestamp }`.
 *
 * Services throw DomainError rather than writing responses, so business rules
 * stay independent of Express; errorHandler turns each kind of failure into
 * the right status.
 */
import { Prisma } from '@prisma/client';
import { NextFunction, Request, RequestHandler, Response } from 'express';
import { z, ZodError } from 'zod';

import { logger } from './logger';

export class DomainError extends Error {
  constructor(public status: number, message: string) {
    super(message);
  }
}

export const notFound = (what: string) => new DomainError(404, `${what} not found`);
export const conflict = (message: string) => new DomainError(409, message);

export function ok(res: Response, data: unknown, status = 200): void {
  res.status(status).json({ success: true, data, timestamp: new Date().toISOString() });
}

/** Lets route handlers be async without a try/catch in each one. */
export const asyncHandler =
  (fn: (req: Request, res: Response) => Promise<void>): RequestHandler =>
  (req, res, next) => {
    fn(req, res).catch(next);
  };

const pageQuery = z.object({
  limit: z.coerce.number().int().min(1).max(200).default(50),
  offset: z.coerce.number().int().min(0).default(0),
});

export function pageParams(query: unknown): { limit: number; offset: number } {
  return pageQuery.parse(query);
}

export function page<T>(items: T[], total: number, limit: number, offset: number) {
  return { items, total, limit, offset };
}

function fail(res: Response, status: number, error: string, details?: unknown): void {
  res.status(status).json({ success: false, error, ...(details ? { details } : {}), timestamp: new Date().toISOString() });
}

export function errorHandler(err: unknown, _req: Request, res: Response, _next: NextFunction): void {
  if (err instanceof ZodError) {
    fail(res, 422, 'Invalid request', err.issues.map((i) => ({ path: i.path.join('.'), message: i.message })));
    return;
  }
  if (err instanceof DomainError) {
    fail(res, err.status, err.message);
    return;
  }
  if (err instanceof Prisma.PrismaClientKnownRequestError) {
    if (err.code === 'P2002') {
      fail(res, 409, 'That already exists');
      return;
    }
    if (err.code === 'P2025') {
      fail(res, 404, 'Not found');
      return;
    }
  }
  if (err instanceof SyntaxError && 'body' in err) {
    fail(res, 400, 'Malformed JSON body');
    return;
  }
  logger.error('Unhandled error', { error: err instanceof Error ? err.stack : String(err) });
  fail(res, 500, 'Something went wrong');
}
