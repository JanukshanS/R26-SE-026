import dotenv from 'dotenv';

dotenv.config();

export const config = {
  port: Number(process.env.PORT ?? 3002),
  nodeEnv: process.env.NODE_ENV ?? 'development',
  supabaseUrl: (process.env.SUPABASE_URL ?? '').trim().replace(/\/+$/, ''),
  supabaseAnonKey: (process.env.SUPABASE_ANON_KEY ?? '').trim(),
  // Only used to import a Kaduna dispatch job into a job card.
  // Shared secret for /internal (the parts service calls it); empty turns /internal off.
  internalToken: (process.env.INTERNAL_API_TOKEN ?? '').trim(),
  dispatchUrl: (process.env.DISPATCH_URL ?? 'http://dispatch:3001').replace(/\/+$/, ''),
  // Day boundaries for "due today" and "this month" follow the garages' clock, not the server's.
  timeZoneOffsetMinutes: Number(process.env.GARAGE_TZ_OFFSET_MINUTES ?? 330),
  logLevel: process.env.LOG_LEVEL ?? 'info',
};
