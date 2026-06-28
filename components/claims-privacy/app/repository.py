from contextlib import contextmanager
from datetime import datetime
from typing import Dict, Generator, Optional
from uuid import uuid4

import psycopg
from psycopg.rows import dict_row


class CaptureRepository:
    def __init__(self, database_url: str) -> None:
        self.database_url = database_url

    @contextmanager
    def _connect(self) -> Generator[psycopg.Connection, None, None]:
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
                cur.execute(
                    """
                    CREATE TABLE IF NOT EXISTS capture_photos (
                        id UUID PRIMARY KEY,
                        capture_id UUID NOT NULL REFERENCES captures(id) ON DELETE CASCADE,
                        photo_index INTEGER NOT NULL,
                        r2_key TEXT NOT NULL UNIQUE,
                        content_type TEXT NOT NULL,
                        byte_size BIGINT NOT NULL,
                        gps_lat DOUBLE PRECISION NULL,
                        gps_lng DOUBLE PRECISION NULL,
                        gps_alt DOUBLE PRECISION NULL,
                        gps_accuracy DOUBLE PRECISION NULL,
                        captured_at_client TIMESTAMPTZ NULL,
                        received_at_server TIMESTAMPTZ NOT NULL DEFAULT NOW(),
                        UNIQUE (capture_id, photo_index)
                    )
                    """
                )
            conn.commit()

    def create_capture(self) -> Dict[str, object]:
        capture_id = str(uuid4())
        with self._connect() as conn:
            with conn.cursor() as cur:
                cur.execute(
                    """
                    INSERT INTO captures (id, status)
                    VALUES (%s, %s)
                    RETURNING id, status, created_at, completed_at
                    """,
                    (capture_id, "uploading"),
                )
                row = cur.fetchone()
            conn.commit()
        return row

    def get_capture(self, capture_id: str) -> Optional[Dict[str, object]]:
        with self._connect() as conn:
            with conn.cursor() as cur:
                cur.execute(
                    """
                    SELECT id, status, created_at, completed_at
                    FROM captures
                    WHERE id = %s
                    """,
                    (capture_id,),
                )
                return cur.fetchone()

    def insert_photo(
        self,
        capture_id: str,
        photo_index: int,
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
                        r2_key,
                        content_type,
                        byte_size,
                        gps_lat,
                        gps_lng,
                        gps_alt,
                        gps_accuracy,
                        captured_at_client
                    )
                    VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s)
                    RETURNING id, capture_id, photo_index, r2_key, content_type, byte_size, received_at_server
                    """,
                    (
                        photo_id,
                        capture_id,
                        photo_index,
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
        return row

    def count_photos(self, capture_id: str) -> int:
        with self._connect() as conn:
            with conn.cursor() as cur:
                cur.execute(
                    "SELECT COUNT(*) AS count FROM capture_photos WHERE capture_id = %s",
                    (capture_id,),
                )
                row = cur.fetchone()
                return int(row["count"])

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
        return row
