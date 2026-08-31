/**
 * ============================================================================
 * Prisma Client Singleton
 * ============================================================================
 * 
 * Single instance of PrismaClient shared across the application.
 * Prevents multiple connections during development with hot-reloading.
 * 
 * @module utils/prisma
 * @author Janukshan Sivakumar - IT22635266
 */

import { PrismaClient } from '@prisma/client';
import { logger } from './logger';

// Prevent multiple Prisma instances during development hot-reload
const globalForPrisma = globalThis as unknown as {
  prisma: PrismaClient | undefined;
};

export const prisma =
  globalForPrisma.prisma ??
  new PrismaClient({
    log: [
      { emit: 'event', level: 'query' },
      { emit: 'event', level: 'error' },
      { emit: 'event', level: 'warn' },
    ],
  });

if (process.env.NODE_ENV !== 'production') {
  globalForPrisma.prisma = prisma;
}

// Log slow queries in development only. The threshold is generous because
// `e.duration` is wall-clock round-trip through the Supabase pooler, not
// server-side execution time — a trivial `SELECT 1` routinely takes
// 250-700ms cross-region (this project's pooler is ap-northeast-2), so a
// tight threshold just logs network latency as if it were a real slow query.
if (process.env.NODE_ENV !== 'production') {
  prisma.$on('query' as never, (e: any) => {
    if (e.duration > 1000) {
      logger.warn(`Slow query (${e.duration}ms): ${e.query}`);
    }
  });
}

prisma.$on('error' as never, (e: any) => {
  logger.error('Prisma error:', e);
});
