/**
 * Garage Management Service — simple workshop management for Kaduna.lk
 * service providers: customers and vehicles, job cards, parts inventory and
 * invoices. Express + Prisma on port 3002, its own Postgres schema.
 */
import { createApp } from './app';
import { config } from './config';
import { logger } from './utils/logger';
import { prisma } from './utils/prisma';

const server = createApp().listen(config.port, () => {
  logger.info(`garage-management listening on :${config.port}`);
});

// Finish in-flight requests and release database connections when Docker stops the container.
for (const signal of ['SIGTERM', 'SIGINT'] as const) {
  process.on(signal, () => {
    logger.info(`${signal} received, shutting down`);
    server.close(() => {
      prisma.$disconnect().finally(() => process.exit(0));
    });
  });
}
