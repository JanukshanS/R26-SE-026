"""Per-user token-bucket rate limit for the authenticated routes.

Keyed on the verified token subject, so it runs after authentication and a
caller cannot dodge it by rotating IPs. Dispatch forwards the end user's own
token to /v1/score, so each driver gets their own bucket rather than dispatch
sharing one.

In-process only: with several workers or replicas each holds its own buckets,
so the effective limit is the configured one times the process count.
"""
from __future__ import annotations

import math
import os
import threading
import time

from fastapi import Depends, HTTPException, status

from .auth import require_user

DEFAULT_PER_MINUTE = 120

_lock = threading.Lock()
# One entry per user subject, never evicted: fine for the platform's user count.
_buckets: dict[str, tuple[float, float]] = {}


def _per_minute() -> int:
    try:
        return int(os.getenv("GEO_RATE_LIMIT_PER_MINUTE", DEFAULT_PER_MINUTE))
    except ValueError:
        return DEFAULT_PER_MINUTE


def rate_limit(user: str = Depends(require_user)) -> str:
    """Allow a burst of the per-minute limit, refilling continuously. 0 disables it."""
    capacity = _per_minute()
    if capacity <= 0:
        return user
    refill_per_s = capacity / 60.0
    now = time.monotonic()
    with _lock:
        tokens, last = _buckets.get(user, (float(capacity), now))
        tokens = min(float(capacity), tokens + (now - last) * refill_per_s)
        if tokens < 1.0:
            _buckets[user] = (tokens, now)
            retry_after = math.ceil((1.0 - tokens) / refill_per_s)
            raise HTTPException(
                status_code=status.HTTP_429_TOO_MANY_REQUESTS,
                detail="Rate limit exceeded.",
                headers={"Retry-After": str(retry_after)},
            )
        _buckets[user] = (tokens - 1.0, now)
    return user
