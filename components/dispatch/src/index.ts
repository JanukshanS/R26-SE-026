/**
 * ============================================================================
 * UADO Dispatch Service — Express Server Entry Point
 * ============================================================================
 * 
 * Main entry point for the Uncertainty-Aware Dispatch Optimization service.
 * This service handles the complete dispatch lifecycle:
 * 
 * 1. Incident creation and management
 * 2. Diagnostic triage (questionnaire + OBD-II → probability distributions)
 * 3. ECM dispatch optimization (provider selection under uncertainty)
 * 4. Provider management and availability tracking
 * 5. Resolution feedback and Bayesian learning
 * 
 * Part of the Kaduna.lk platform — R26-SE-026
 * 
 * @module index
 * @author Janukshan Sivakumar - IT22635266
 */

import express, { Request, Response, NextFunction } from 'express';
import cors from 'cors';
import helmet from 'helmet';
import { config } from './config';
import { logger } from './utils/logger';
import { prisma } from './utils/prisma';

// ── Import Routes ──
import { incidentRouter } from './routes/incident.routes';
import { triageRouter } from './routes/triage.routes';
import { providerRouter } from './routes/provider.routes';
import { dispatchRouter } from './routes/dispatch.routes';

// ── Create Express App ──
const app = express();

// ── Middleware ──
app.use(helmet());
app.use(cors());
app.use(express.json({ limit: '1mb' }));

// Request logging
app.use((req: Request, _res: Response, next: NextFunction) => {
  logger.debug(`${req.method} ${req.path}`, {
    query: req.query,
    ip: req.ip,
  });
  next();
});

// ── Health Check ──
app.get('/health', async (_req: Request, res: Response) => {
  try {
    // Verify database connection
    await prisma.$queryRaw`SELECT 1`;
    
    res.json({
      success: true,
      data: {
        service: 'dispatch-service',
        status: 'healthy',
        version: '1.0.0',
        uptime: process.uptime(),
        timestamp: new Date().toISOString(),
        database: 'connected',
        framework: 'UADO (Uncertainty-Aware Dispatch Optimization)',
      },
      timestamp: new Date().toISOString(),
    });
  } catch (error) {
    res.status(503).json({
      success: false,
      error: 'Database connection failed',
      timestamp: new Date().toISOString(),
    });
  }
});

// ── API Routes ──
app.use('/api/v1/incidents', incidentRouter);
app.use('/api/v1/triage', triageRouter);
app.use('/api/v1/providers', providerRouter);
app.use('/api/v1/dispatch', dispatchRouter);

// ── 404 Handler ──
app.use((_req: Request, res: Response) => {
  res.status(404).json({
    success: false,
    error: 'Endpoint not found',
    timestamp: new Date().toISOString(),
  });
});

// ── Global Error Handler ──
app.use((err: Error, _req: Request, res: Response, _next: NextFunction) => {
  logger.error('Unhandled error:', { message: err.message, stack: err.stack });
  res.status(500).json({
    success: false,
    error: config.nodeEnv === 'development' ? err.message : 'Internal server error',
    timestamp: new Date().toISOString(),
  });
});

// ── Start Server ──
async function main() {
  try {
    // Connect to database
    await prisma.$connect();
    logger.info('✅ Database connected');

    // Start Express server
    app.listen(config.port, () => {
      logger.info(`🚀 Dispatch Service running on port ${config.port}`);
      logger.info(`📋 Environment: ${config.nodeEnv}`);
      logger.info(`🔗 Health check: http://localhost:${config.port}/health`);
      logger.info(`📡 API base: http://localhost:${config.port}/api/v1`);
      logger.info('─────────────────────────────────────');
      logger.info('UADO Framework — Dispatch Optimization');
      logger.info('Kaduna.lk | R26-SE-026 | IT22635266');
      logger.info('─────────────────────────────────────');
    });
  } catch (error) {
    logger.error('Failed to start server:', error);
    process.exit(1);
  }
}

// Graceful shutdown
process.on('SIGINT', async () => {
  logger.info('Shutting down gracefully...');
  await prisma.$disconnect();
  process.exit(0);
});

process.on('SIGTERM', async () => {
  logger.info('SIGTERM received, shutting down...');
  await prisma.$disconnect();
  process.exit(0);
});

main();

export default app;
