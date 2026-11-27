/**
 * Parts Management Service — the spare parts shop system for Kaduna.lk:
 * inventory and stock control, counter sales, purchasing, and trade with
 * garages. Express + Prisma on port 3003, its own Postgres schema.
 */
import { createApp } from './app';
import { config } from './config';
import { retryJobSyncs } from './services/orders';
import { logger } from './utils/logger';
import { prisma } from './utils/prisma';

const server = createApp().listen(config.port, () => {
  logger.info(`parts-management listening on :${config.port}`);
});

// Parts handed over while the garage service was unreachable still reach their job.
const SYNC_EVERY_MS = 60_000;
const sync = setInterval(() => {
  retryJobSyncs(prisma).catch((err) => logger.warn(`Job sync loop: ${(err as Error).message}`));
}, SYNC_EVERY_MS);

for (const signal of ['SIGTERM', 'SIGINT'] as const) {
  process.on(signal, () => {
    logger.info(`${signal} received, shutting down`);
    clearInterval(sync);
    server.close(() => {
      prisma.$disconnect().finally(() => process.exit(0));
    });
  });
}
