/**
 * Starts a real, throwaway Postgres for the test run and applies the real
 * migrations to it with `prisma migrate deploy`, the same command the
 * container runs on start. So the tests also prove the migrations work.
 */
import { execSync } from 'node:child_process';
import { rmSync } from 'node:fs';
import path from 'node:path';

import EmbeddedPostgres from 'embedded-postgres';

const PORT = 54329;
const DIR = path.resolve(__dirname, '..', '.pg-test');

export default async function setup() {
  rmSync(DIR, { recursive: true, force: true });
  const pg = new EmbeddedPostgres({ databaseDir: DIR, user: 'postgres', password: 'test', port: PORT, persistent: false });
  await pg.initialise();
  await pg.start();
  await pg.createDatabase('garage_test');

  const url = `postgresql://postgres:test@localhost:${PORT}/garage_test?schema=garage`;
  process.env.DATABASE_URL = url;
  process.env.DISPATCH_URL = 'http://localhost:54401';
  execSync('npx prisma migrate deploy', { cwd: path.resolve(__dirname, '..'), env: { ...process.env, DATABASE_URL: url }, stdio: 'pipe' });

  return async () => {
    await pg.stop();
    rmSync(DIR, { recursive: true, force: true });
  };
}
