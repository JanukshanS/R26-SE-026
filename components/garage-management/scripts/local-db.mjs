/**
 * A local PostgreSQL for development, no Docker or install needed:
 *   npm run db:local
 * Data persists in .pg-local/ between runs (delete the folder to start over).
 * Leave it running; Ctrl+C stops it cleanly.
 */
import { existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

// Plain JS (not ts-node): embedded-postgres ships ES modules only.
import EmbeddedPostgres from 'embedded-postgres';

const PORT = Number(process.env.LOCAL_DB_PORT ?? 5434);
const DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '.pg-local');
const DB = 'garage_dev';

async function main() {
  const pg = new EmbeddedPostgres({ databaseDir: DIR, user: 'postgres', password: 'postgres', port: PORT, persistent: true });
  const fresh = !existsSync(path.join(DIR, 'PG_VERSION'));
  if (fresh) await pg.initialise();
  await pg.start();
  if (fresh) await pg.createDatabase(DB);

  console.log(`\nLocal Postgres is running on port ${PORT}.`);
  console.log(`DATABASE_URL=postgresql://postgres:postgres@localhost:${PORT}/${DB}?schema=garage\n`);
  console.log('Press Ctrl+C to stop.');

  const stop = async () => {
    await pg.stop().catch(() => {});
    process.exit(0);
  };
  process.on('SIGINT', stop);
  process.on('SIGTERM', stop);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
