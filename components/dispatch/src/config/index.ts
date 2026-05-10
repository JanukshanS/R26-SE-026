/**
 * ============================================================================
 * UADO Framework — Configuration
 * ============================================================================
 * 
 * Centralized configuration loaded from environment variables.
 * All defaults are designed for local development.
 * 
 * @module config
 * @author Janukshan Sivakumar - IT22635266
 */

import dotenv from 'dotenv';
dotenv.config();

export const config = {
  // ── Server ──
  port: parseInt(process.env.PORT || '3001', 10),
  nodeEnv: process.env.NODE_ENV || 'development',

  // ── Database ──
  databaseUrl: process.env.DATABASE_URL || 'postgresql://kaduna:kaduna_dev@localhost:5432/dispatch_db?schema=public',

  // ── Redis ──
  redisUrl: process.env.REDIS_URL || 'redis://localhost:6379',

  // ── Google Maps ──
  googleMapsApiKey: process.env.GOOGLE_MAPS_API_KEY || '',

  // ── External Services ──
  geoIntelligenceUrl: process.env.GEO_INTELLIGENCE_URL || 'http://localhost:5001',
  predictiveMaintenanceUrl: process.env.PREDICTIVE_MAINTENANCE_URL || 'http://localhost:5003',

  // ── Dispatch Parameters ──
  dispatch: {
    /** Provider acceptance timeout in seconds */
    timeoutSeconds: parseInt(process.env.DISPATCH_TIMEOUT_SECONDS || '120', 10),

    /** Traffic externality weight (λ) in ECM cost function */
    trafficLambda: parseFloat(process.env.TRAFFIC_LAMBDA || '0.3'),

    /** Re-dispatch penalty in minutes (added when mismatch occurs) */
    reDispatchPenaltyMinutes: parseInt(process.env.RE_DISPATCH_PENALTY_MINUTES || '45', 10),

    /** Assessment delay in minutes (time wasted before realizing mismatch) */
    assessmentDelayMinutes: 10,

    /** Average service times by service type (minutes) */
    averageServiceTimes: {
      BATTERY_JUMP: 15,
      BATTERY_REPLACE: 30,
      STARTER_MOTOR: 45,
      FUEL_DELIVERY: 20,
      FLAT_TIRE: 25,
      LOCKOUT: 20,
      MECHANIC_FIX: 60,
      TOW_LIGHT: 30,
      TOW_HEAVY: 45,
    } as Record<string, number>,
  },

  // ── Bayesian Learning ──
  bayesian: {
    /** Starting learning rate for Bayesian updates */
    initialLearningRate: parseFloat(process.env.INITIAL_LEARNING_RATE || '0.1'),

    /** Minimum learning rate (learning rate decays to this floor) */
    minLearningRate: parseFloat(process.env.MIN_LEARNING_RATE || '0.01'),

    /** Rolling window size for accuracy tracking */
    windowSize: parseInt(process.env.LEARNING_WINDOW_SIZE || '100', 10),
  },

  // ── Logging ──
  logLevel: process.env.LOG_LEVEL || 'debug',
} as const;
