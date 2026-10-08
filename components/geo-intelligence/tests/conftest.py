import pytest

from src import ratelimit


@pytest.fixture(autouse=True)
def _fresh_rate_limit_buckets():
    """Every test client shares one subject, so the suite would trip the limit."""
    ratelimit._buckets.clear()
