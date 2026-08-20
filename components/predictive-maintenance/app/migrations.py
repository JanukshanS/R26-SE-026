"""Additive, idempotent SQLite column guard.

``Base.metadata.create_all()`` creates MISSING TABLES but never adds columns to
a table that already exists. The deployed database lives in a named Docker
volume (``predictive-data``) holding real ingested trips that cannot be
regenerated — raw OBD/IMU readings are never persisted, only the computed
aggregates, so nothing can be backfilled. Doing nothing means the first query
after a model gains a column dies with ``OperationalError: no such column``.

Full Alembic is disproportionate for a single-table service, and carries a live
footgun here: the deployed database was created by ``create_all`` and therefore
has no ``alembic_version`` row, so a first ``upgrade head`` would try to
``CREATE TABLE trip_metrics`` again unless someone remembered to
``alembic stamp head`` against the volume first.

So: ``ALTER TABLE ... ADD COLUMN`` for any model-declared column the live table
is missing. SQLite's ADD COLUMN is metadata-only — it rewrites the table header,
not the rows, so it is O(1) whether there are 3 rows or 3 million. Every column
added this way must be NULLable with no default, which is the one form SQLite
accepts unconditionally and the form that leaves every existing row valid.

Deliberately does NOT drop, rename, retype or reorder anything. This is an
ADDITIVE guard, not a migration framework. THE FIRST CHANGE THAT NEEDS MORE THAN
A NULLABLE COLUMN IS THE MOMENT TO ADOPT ALEMBIC PROPERLY — don't grow this file
into a half-migration-tool.
"""
from __future__ import annotations

from typing import List

from sqlalchemy import inspect, text
from sqlalchemy.engine import Engine


def ensure_columns(engine: Engine, *models) -> List[str]:
    """Add any model-declared column missing from the live table.

    Returns the ``table.column`` names added, for startup logging. Returns an
    empty list when everything already matches, which is the steady state — the
    guard is safe to run on every boot.

    No-ops on non-SQLite dialects: a real database should be migrated with a
    proper tool, and emitting dialect-specific DDL here would be worse than
    doing nothing loudly.
    """
    if engine.dialect.name != "sqlite":
        print(
            f"[migrations] dialect is '{engine.dialect.name}', not sqlite — "
            f"skipping the additive column guard (migrate with a real tool)"
        )
        return []

    added: List[str] = []
    inspector = inspect(engine)

    for model in models:
        table = model.__table__
        if not inspector.has_table(table.name):
            # create_all will make it; nothing to patch.
            continue

        existing = {c["name"] for c in inspector.get_columns(table.name)}

        for column in table.columns:
            if column.name in existing:
                continue

            if not column.nullable:
                # Refuse rather than fail halfway: SQLite cannot add a NOT NULL
                # column without a default, and inventing one would silently
                # fabricate data for every existing row.
                print(
                    f"[migrations] REFUSING to add {table.name}.{column.name}: "
                    f"declared NOT NULL. New columns must be nullable - see this "
                    f"module's docstring."
                )
                continue

            ddl = column.type.compile(engine.dialect)
            with engine.begin() as conn:
                conn.execute(text(f'ALTER TABLE {table.name} ADD COLUMN {column.name} {ddl}'))
            added.append(f"{table.name}.{column.name}")
            print(f"[migrations] added {table.name}.{column.name} {ddl}")

    return added
