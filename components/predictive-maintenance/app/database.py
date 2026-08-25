import os

from dotenv import load_dotenv
from sqlalchemy import create_engine, event, text
from sqlalchemy.orm import sessionmaker, declarative_base

load_dotenv()

# Postgres (Supabase) in every deployed environment; SQLite only as a zero-setup
# local default and for tests.
#
# The move off SQLite was about durability: it lived on a Docker volume, and
# because raw OBD/IMU readings are discarded after each trip is summarised, a
# lost volume meant trip history that could never be reconstructed.
#
# Use the DIRECT connection (port 5432), not the pooled one (6543) - schema
# creation and DDL do not work reliably through pgbouncer.
DATABASE_URL = os.getenv("PREDICTIVE_DATABASE_URL", "sqlite:///./predictive.db")

IS_SQLITE = DATABASE_URL.startswith("sqlite")

# Own schema so this service can never collide with the app's tables (profiles,
# vehicles) or with dispatch, which share the same Supabase project.
PG_SCHEMA = os.getenv("PREDICTIVE_DB_SCHEMA", "predictive")

if IS_SQLITE:
    # check_same_thread is a SQLITE-ONLY argument. Passing it to psycopg2 raises
    # a TypeError at connect time, so it has to be conditional rather than a
    # constant - that was the single line most likely to break this migration.
    engine = create_engine(DATABASE_URL, connect_args={"check_same_thread": False})
else:
    engine = create_engine(
        DATABASE_URL,
        # Supabase closes idle connections; without pre-ping the first query
        # after a quiet spell fails with a stale-connection error instead of
        # transparently reconnecting.
        pool_pre_ping=True,
        pool_size=5,
        max_overflow=5,
    )

    @event.listens_for(engine, "connect", insert=True)
    def _ensure_schema(dbapi_conn, _record):
        """Create the schema and select it, on every new connection.

        search_path is set with an explicit SET rather than the libpq "options"
        startup parameter, because Supabase's connection pooler SILENTLY DROPS
        options. That failure is nasty: the connection succeeds, search_path
        quietly falls back to public, and create_all cheerfully builds a second
        copy of every table in the wrong schema - which is exactly what happened
        the first time this ran through the pooler.

        create_all makes TABLES but never the SCHEMA that holds them, so the
        CREATE SCHEMA has to happen here too, before anything else runs.
        """
        cur = dbapi_conn.cursor()
        cur.execute(f'CREATE SCHEMA IF NOT EXISTS "{PG_SCHEMA}"')
        cur.execute(f'SET search_path TO "{PG_SCHEMA}", public')
        dbapi_conn.commit()
        cur.close()

SessionLocal = sessionmaker(autocommit=False, autoflush=False, bind=engine)
Base = declarative_base()


def get_db():
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()
