import winston from 'winston';

import { config } from '../config';

export const logger = winston.createLogger({
  level: config.logLevel,
  format: winston.format.combine(winston.format.timestamp(), winston.format.errors({ stack: true }), winston.format.json()),
  defaultMeta: { service: 'garage-management' },
  transports: [new winston.transports.Console({ silent: process.env.NODE_ENV === 'test' })],
});
