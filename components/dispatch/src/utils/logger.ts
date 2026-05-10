/**
 * ============================================================================
 * Winston Logger — Structured Logging for Dispatch Decisions
 * ============================================================================
 * 
 * Every dispatch decision, triage result, and Bayesian update is logged
 * with structured metadata. This creates an audit trail for:
 * - Viva demonstrations (show decision rationale)
 * - Debugging dispatch accuracy issues
 * - PDPA compliance (decision transparency)
 * 
 * @module utils/logger
 * @author Janukshan Sivakumar - IT22635266
 */

import winston from 'winston';
import { config } from '../config';

const logFormat = winston.format.combine(
  winston.format.timestamp({ format: 'YYYY-MM-DD HH:mm:ss.SSS' }),
  winston.format.errors({ stack: true }),
  config.nodeEnv === 'development'
    ? winston.format.combine(
        winston.format.colorize(),
        winston.format.printf(({ timestamp, level, message, ...meta }) => {
          const metaStr = Object.keys(meta).length ? `\n  ${JSON.stringify(meta, null, 2)}` : '';
          return `[${timestamp}] ${level}: ${message}${metaStr}`;
        })
      )
    : winston.format.json()
);

export const logger = winston.createLogger({
  level: config.logLevel,
  format: logFormat,
  defaultMeta: { service: 'dispatch-service' },
  transports: [
    new winston.transports.Console(),
    // In production, add file transports:
    // new winston.transports.File({ filename: 'logs/error.log', level: 'error' }),
    // new winston.transports.File({ filename: 'logs/combined.log' }),
  ],
});
