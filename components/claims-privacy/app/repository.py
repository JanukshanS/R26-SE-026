from contextlib import contextmanager
from datetime import datetime
from typing import Any, Dict, Generator, Optional, cast
from uuid import UUID as PyUUID
from uuid import uuid4

import psycopg
from psycopg.rows import dict_row

ASSET_KIND_ORIGINAL = "original"
ASSET_KIND_ENHANCED = "enhanced"


def _serialize_db_row(row: Optional[Dict[str, Any]]) -> Optional[Dict[str, Any]]:
    """psycopg returns UUID columns as uuid.UUID; Pydantic API models expect str."""
    if row is None:
        return None
    out = dict(row)
    for key, value in list(out.items()):
        if isinstance(value, PyUUID):
            out[key] = str(value)
    return out


class CaptureRepository:
    def __init__(self, database_url: str) -> None:
        self.database_url = database_url

    @contextmanager
    def _connect(self) -> Generator[psycopg.Connection[Any], None, None]:
        with psycopg.connect(self.database_url, row_factory=dict_row) as conn:
            yield conn

    def ensure_schema(self) -> None:
        with self._connect() as conn:
            with conn.cursor() as cur:
                cur.execute(
                    """
                    CREATE TABLE IF NOT EXISTS captures (
                        id UUID PRIMARY KEY,
                        status TEXT NOT NULL,
                        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
                        completed_at TIMESTAMPTZ NULL
                    )
                    """
                )
                for ddl in (
                    "ALTER TABLE captures ADD COLUMN IF NOT EXISTS claimant_name TEXT NULL",
                    "ALTER TABLE captures ADD COLUMN IF NOT EXISTS claimant_nic TEXT NULL",
                    "ALTER TABLE captures ADD COLUMN IF NOT EXISTS claimant_licence_number TEXT NULL",
                    "ALTER TABLE captures ADD COLUMN IF NOT EXISTS report_captured_at TIMESTAMPTZ NULL",
                    "ALTER TABLE captures ADD COLUMN IF NOT EXISTS report_gps_lat DOUBLE PRECISION NULL",
                    "ALTER TABLE captures ADD COLUMN IF NOT EXISTS report_gps_lng DOUBLE PRECISION NULL",
                    "ALTER TABLE captures ADD COLUMN IF NOT EXISTS report_location_label TEXT NULL",
                    "ALTER TABLE captures ADD COLUMN IF NOT EXISTS report_captured_at_display_local TEXT NULL",
                ):
                    cur.execute(ddl)
                cur.execute(
                    """
                    CREATE TABLE IF NOT EXISTS capture_photos (
                        id UUID PRIMARY KEY,
                        capture_id UUID NOT NULL REFERENCES captures(id) ON DELETE CASCADE,
                        photo_index INTEGER NOT NULL,
                        asset_kind TEXT NOT NULL DEFAULT 'original',
                        r2_key TEXT NOT NULL UNIQUE,
                        content_type TEXT NOT NULL,
                        byte_size BIGINT NOT NULL,
                        gps_lat DOUBLE PRECISION NULL,
                        gps_lng DOUBLE PRECISION NULL,
                        gps_alt DOUBLE PRECISION NULL,
                        gps_accuracy DOUBLE PRECISION NULL,
                        captured_at_client TIMESTAMPTZ NULL,
                        received_at_server TIMESTAMPTZ NOT NULL DEFAULT NOW(),
                        UNIQUE (capture_id, photo_index, asset_kind)
                    )
                    """
                )
                cur.execute(
                    """
                    ALTER TABLE capture_photos
                    ADD COLUMN IF NOT EXISTS asset_kind TEXT NOT NULL DEFAULT 'original'
                    """
                )
                cur.execute(
                    """
                    ALTER TABLE capture_photos
                    DROP CONSTRAINT IF EXISTS capture_photos_capture_id_photo_index_key
                    """
                )
                # CREATE TABLE already adds UNIQUE (capture_id, photo_index, asset_kind) with a
                # generated name; only add the explicit constraint if it is missing (legacy DBs).
                cur.execute(
                    """
                    DO $$
                    BEGIN
                        IF NOT EXISTS (
                            SELECT 1
                            FROM pg_constraint c
                            JOIN pg_class t ON c.conrelid = t.oid
                            WHERE t.relname = 'capture_photos'
                              AND c.conname = 'capture_photos_capture_id_photo_index_asset_kind_key'
                        ) THEN
                            ALTER TABLE capture_photos
                            ADD CONSTRAINT capture_photos_capture_id_photo_index_asset_kind_key
                            UNIQUE (capture_id, photo_index, asset_kind);
                        END IF;
                    END $$
                    """
                )
            conn.commit()

    def create_capture(
        self,
        *,
        claimant_name: Optional[str] = None,
        claimant_nic: Optional[str] = None,
        claimant_licence_number: Optional[str] = None,
        report_captured_at: Optional[datetime] = None,
        report_captured_at_display_local: Optional[str] = None,
        report_gps_lat: Optional[float] = None,
        report_gps_lng: Optional[float] = None,
        report_location_label: Optional[str] = None,
    ) -> Dict[str, object]:
        capture_id = str(uuid4())
        with self._connect() as conn:
            with conn.cursor() as cur:
                cur.execute(
                    """
                    INSERT INTO captures (
                        id,
                        status,
                        claimant_name,
                        claimant_nic,
                        claimant_licence_number,
                        report_captured_at,
                        report_captured_at_display_local,
                        report_gps_lat,
                        report_gps_lng,
                        report_location_label
                    )
                    VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s)
                    RETURNING id, status, created_at, completed_at,
                              claimant_name, claimant_nic, claimant_licence_number,
                              report_captured_at, report_captured_at_display_local,
                              report_gps_lat, report_gps_lng, report_location_label
                    """,
                    (
                        capture_id,
                        "uploading",
                        claimant_name,
                        claimant_nic,
                        claimant_licence_number,
                        report_captured_at,
                        report_captured_at_display_local,
                        report_gps_lat,
                        report_gps_lng,
                        report_location_label,
                    ),
                )
                row = cur.fetchone()
            conn.commit()
        assert row is not None
        return cast(Dict[str, Any], _serialize_db_row(row))

    def get_capture(self, capture_id: str) -> Optional[Dict[str, object]]:
        with self._connect() as conn:
            with conn.cursor() as cur:
                cur.execute(
                    """
                    SELECT id, status, created_at, completed_at,
                           claimant_name, claimant_nic, claimant_licence_number,
                           report_captured_at, report_captured_at_display_local,
                           report_gps_lat, report_gps_lng, report_location_label
                    FROM captures
                    WHERE id = %s
                    """,
                    (capture_id,),
                )
                return cast(Optional[Dict[str, Any]], _serialize_db_row(cur.fetchone()))

    def get_photo_row(
        self,
        capture_id: str,
        photo_index: int,
        asset_kind: str,
    ) -> Optional[Dict[str, object]]:
        with self._connect() as conn:
            with conn.cursor() as cur:
                cur.execute(
                    """
                    SELECT id, capture_id, photo_index, asset_kind, r2_key,
                           content_type, byte_size, received_at_server
                    FROM capture_photos
                    WHERE capture_id = %s AND photo_index = %s AND asset_kind = %s
                    """,
                    (capture_id, photo_index, asset_kind),
                )
                return cast(Optional[Dict[str, Any]], _serialize_db_row(cur.fetchone()))

    def upsert_photo(
        self,
        capture_id: str,
        photo_index: int,
        asset_kind: str,
        r2_key: str,
        content_type: str,
        byte_size: int,
        gps_lat: Optional[float],
        gps_lng: Optional[float],
        gps_alt: Optional[float],
        gps_accuracy: Optional[float],
        captured_at_client: Optional[datetime],
    ) -> Dict[str, object]:
        photo_id = str(uuid4())
        with self._connect() as conn:
            with conn.cursor() as cur:
                cur.execute(
                    """
                    INSERT INTO capture_photos (
                        id,
                        capture_id,
                        photo_index,
                        asset_kind,
                        r2_key,
                        content_type,
                        byte_size,
                        gps_lat,
                        gps_lng,
                        gps_alt,
                        gps_accuracy,
                        captured_at_client
                    )
                    VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s)
                    ON CONFLICT (capture_id, photo_index, asset_kind)
                    DO UPDATE SET
                        r2_key = EXCLUDED.r2_key,
                        content_type = EXCLUDED.content_type,
                        byte_size = EXCLUDED.byte_size,
                        gps_lat = EXCLUDED.gps_lat,
                        gps_lng = EXCLUDED.gps_lng,
                        gps_alt = EXCLUDED.gps_alt,
                        gps_accuracy = EXCLUDED.gps_accuracy,
                        captured_at_client = EXCLUDED.captured_at_client,
                        received_at_server = NOW()
                    RETURNING id, capture_id, photo_index, asset_kind, r2_key,
                              content_type, byte_size, received_at_server
                    """,
                    (
                        photo_id,
                        capture_id,
                        photo_index,
                        asset_kind,
                        r2_key,
                        content_type,
                        byte_size,
                        gps_lat,
                        gps_lng,
                        gps_alt,
                        gps_accuracy,
                        captured_at_client,
                    ),
                )
                row = cur.fetchone()
            conn.commit()
        assert row is not None
        return cast(Dict[str, Any], _serialize_db_row(row))

    def count_photos(self, capture_id: str) -> int:
        with self._connect() as conn:
            with conn.cursor() as cur:
                cur.execute(
                    "SELECT COUNT(*) AS count FROM capture_photos WHERE capture_id = %s",
                    (capture_id,),
                )
                row = cur.fetchone()
                return int(row["count"]) if row else 0

    def count_photos_by_kind(self, capture_id: str, asset_kind: str) -> int:
        with self._connect() as conn:
            with conn.cursor() as cur:
                cur.execute(
                    """
                    SELECT COUNT(*) AS count FROM capture_photos
                    WHERE capture_id = %s AND asset_kind = %s
                    """,
                    (capture_id, asset_kind),
                )
                row = cur.fetchone()
                return int(row["count"]) if row else 0

    def count_originals_missing_enhancement(self, capture_id: str) -> int:
        with self._connect() as conn:
            with conn.cursor() as cur:
                cur.execute(
                    """
                    SELECT COUNT(*) AS count
                    FROM capture_photos o
                    WHERE o.capture_id = %s
                      AND o.asset_kind = %s
                      AND NOT EXISTS (
                        SELECT 1 FROM capture_photos e
                        WHERE e.capture_id = o.capture_id
                          AND e.photo_index = o.photo_index
                          AND e.asset_kind = %s
                      )
                    """,
                    (capture_id, ASSET_KIND_ORIGINAL, ASSET_KIND_ENHANCED),
                )
                row = cur.fetchone()
                return int(row["count"]) if row else 0

    def mark_capture_processing(self, capture_id: str) -> Optional[Dict[str, object]]:
        with self._connect() as conn:
            with conn.cursor() as cur:
                cur.execute(
                    """
                    UPDATE captures
                    SET status = 'processing', completed_at = NOW()
                    WHERE id = %s AND status = 'uploading'
                    RETURNING id, status, created_at, completed_at
                    """,
                    (capture_id,),
                )
                row = cur.fetchone()
            conn.commit()
        return cast(Optional[Dict[str, Any]], _serialize_db_row(row))
