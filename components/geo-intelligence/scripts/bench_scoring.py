"""Time the scoring path itself, with no network, TLS, proxy or auth in the way.

FR-01 and NFR-01 in the proposal set a 500 ms budget for "calculate an impact
score for any reported incident". Timing that over HTTP against the deployed
service measures the VPS and the reverse proxy as much as the model: an
unauthenticated health check on the same box varies by half a second. This
calls the request handler directly so the number is the component's own.

    .venv/bin/python scripts/bench_scoring.py
"""
import os
import statistics
import sys
import time

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from src.api import ScoreRequest, score

N = 1000

# Colombo Fort at evening peak, two lanes blocked: the road resolver has to scan
# the OSM ways for this one rather than falling through to the default, so it is
# the expensive path rather than the flattering one.
REQ = ScoreRequest(
    latitude=6.9344,
    longitude=79.8428,
    incident_type="accident_major",
    lanes_blocked=2,
    hour=17,
    day_of_week=4,
)


def main() -> None:
    score(REQ)  # warm the road index and the holiday table

    samples = []
    for _ in range(N):
        t = time.perf_counter()
        score(REQ)
        samples.append((time.perf_counter() - t) * 1000.0)

    samples.sort()
    p = lambda q: samples[int(q * (len(samples) - 1))]
    print(f"n = {N} calls to the /v1/score handler, in process")
    print(f"  mean   {statistics.mean(samples):7.2f} ms")
    print(f"  p50    {p(0.50):7.2f} ms")
    print(f"  p95    {p(0.95):7.2f} ms")
    print(f"  p99    {p(0.99):7.2f} ms")
    print(f"  max    {samples[-1]:7.2f} ms")
    print(f"  budget  500.00 ms  ->  {'PASS' if p(0.95) < 500 else 'MISS'} at p95")


if __name__ == "__main__":
    main()
