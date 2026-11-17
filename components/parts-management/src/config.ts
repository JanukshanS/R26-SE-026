import dotenv from 'dotenv';

dotenv.config();

export const config = {
  port: Number(process.env.PORT ?? 3003),
  nodeEnv: process.env.NODE_ENV ?? 'development',
  supabaseUrl: (process.env.SUPABASE_URL ?? '').trim().replace(/\/+$/, ''),
  supabaseAnonKey: (process.env.SUPABASE_ANON_KEY ?? '').trim(),
  // The garage service: who a caller is to a garage (with their own token), and
  // its internal API (shared secret) for mechanics, jobs and adding received parts.
  garageUrl: (process.env.GARAGE_URL ?? 'http://garage-management:3002').replace(/\/+$/, ''),
  internalToken: (process.env.INTERNAL_API_TOKEN ?? '').trim(),
  // Day boundaries for "today" and reports follow Sri Lanka time, not the server's.
  timeZoneOffsetMinutes: Number(process.env.SHOP_TZ_OFFSET_MINUTES ?? 330),
  logLevel: process.env.LOG_LEVEL ?? 'info',
  // Where this service is reached from browsers (for the local file store's signed links).
  publicUrl: (process.env.PUBLIC_URL ?? `http://localhost:${process.env.PORT ?? 3003}`).replace(/\/+$/, ''),
  // Part photos and documents: local disk (default) or an S3 bucket. See services/storage.ts.
  filesDir: process.env.FILES_DIR ?? '.files',
  filesSecret: (process.env.FILES_SECRET ?? '').trim(),
  files: {
    driver: (process.env.FILES_DRIVER ?? 'local').trim() as 'local' | 's3',
    s3: {
      bucket: (process.env.S3_BUCKET ?? '').trim(),
      region: (process.env.S3_REGION ?? '').trim(),
      endpoint: (process.env.S3_ENDPOINT ?? '').trim() || null,
      accessKeyId: (process.env.S3_ACCESS_KEY_ID ?? '').trim(),
      secretAccessKey: (process.env.S3_SECRET_ACCESS_KEY ?? '').trim(),
      forcePathStyle: process.env.S3_FORCE_PATH_STYLE ? process.env.S3_FORCE_PATH_STYLE === 'true' : undefined,
    },
  },
};
