#!/usr/bin/env bash
# One-time, lossless copy of captures/capture_photos from Neon into the new Supabase
# tables (see apps/mobile/supabase/migrations/20260815000000_captures_schema.sql —
# run that migration against Supabase FIRST, this script assumes both tables already
# exist there and are empty).
#
# Both sides are plain Postgres, so this is a straight pg_dump/psql data copy, not an
# app-level transform: no Neon-specific features are in use, and the schema is
# byte-for-byte identical on both sides.
#
# Usage:
#   NEON_DATABASE_URL="postgresql://...neon.tech/neondb?sslmode=require" \
#   SUPABASE_DB_URL="postgresql://postgres:[password]@db.[project-ref].supabase.co:5432/postgres" \
#   ./scripts/migrate_to_supabase.sh
#
# SUPABASE_DB_URL is Supabase's *direct Postgres* connection string (Project Settings
# -> Database -> Connection string -> "URI", NOT the REST API URL/key used elsewhere
# in this codebase for PostgREST). Use the direct connection (not the pooler) for this
# one-off script — pgbouncer transaction-mode pooling can be awkward for pg_dump/psql.

set -euo pipefail

: "${NEON_DATABASE_URL:?Set NEON_DATABASE_URL (source, the claims-privacy DB)}"
: "${SUPABASE_DB_URL:?Set SUPABASE_DB_URL (destination, direct Postgres connection string)}"

DUMP_FILE="$(mktemp -t captures_migration.XXXXXX.sql)"
trap 'rm -f "$DUMP_FILE"' EXIT

echo "==> Checking destination tables are empty before copying (this script is not idempotent — COPY will duplicate/conflict on a second run)"
existing_captures=$(psql "$SUPABASE_DB_URL" -tAc "select count(*) from captures")
existing_photos=$(psql "$SUPABASE_DB_URL" -tAc "select count(*) from capture_photos")
if [ "$existing_captures" != "0" ] || [ "$existing_photos" != "0" ]; then
  echo "ERROR: destination already has data (captures=$existing_captures, capture_photos=$existing_photos)." >&2
  echo "This script is meant for a single initial copy into empty tables. Investigate before re-running." >&2
  exit 1
fi

echo "==> Dumping captures + capture_photos from Neon"
pg_dump "$NEON_DATABASE_URL" \
  --data-only \
  --table=captures \
  --table=capture_photos \
  --file="$DUMP_FILE"

echo "==> Restoring into Supabase"
psql "$SUPABASE_DB_URL" -f "$DUMP_FILE"

echo "==> Verifying row counts match"
for table in captures capture_photos; do
  src=$(psql "$NEON_DATABASE_URL" -tAc "select count(*) from $table")
  dst=$(psql "$SUPABASE_DB_URL" -tAc "select count(*) from $table")
  echo "$table: neon=$src supabase=$dst"
  if [ "$src" != "$dst" ]; then
    echo "ERROR: row count mismatch on $table" >&2
    exit 1
  fi
done

echo "==> Done. Spot-check a few capture_photos.r2_key values still resolve in R2 (they will — R2 wasn't touched by this script)."
