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

// Log slow queries in development
prisma.$on('query' as never, (e: any) => {
  if (e.duration > 100) {
    logger.warn(`Slow query (${e.duration}ms): ${e.query}`);
  }
});

prisma.$on('error' as never, (e: any) => {
  logger.error('Prisma error:', e);
});
