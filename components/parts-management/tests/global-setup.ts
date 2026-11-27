/**
 * Starts a real, throwaway Postgres for the test run and applies the real
 * migrations to it with `prisma migrate deploy`, the same command the
 * container runs on start. So the tests also prove the migrations work.
 */
import { execSync } from 'node:child_process';
import { rmSync } from 'node:fs';
import path from 'node:path';

import EmbeddedPostgres from 'embedded-postgres';

const PORT = 54339;
const DIR = path.resolve(__dirname, '..', '.pg-test');

export default async function setup() {
  rmSync(DIR, { recursive: true, force: true });
  const pg = new EmbeddedPostgres({ databaseDir: DIR, user: 'postgres', password: 'test', port: PORT, persistent: false, initdbFlags: ['--encoding=UTF8', '--locale=C'] });
  await pg.initialise();
  await pg.start();
  await pg.createDatabase('parts_test');

  const url = `postgresql://postgres:test@localhost:${PORT}/parts_test?schema=parts`;
  process.env.DATABASE_URL = url;
  execSync('npx prisma migrate deploy', { cwd: path.resolve(__dirname, '..'), env: { ...process.env, DATABASE_URL: url }, stdio: 'pipe' });

  return async () => {
    await pg.stop();
    rmSync(DIR, { recursive: true, force: true });
  };
}
