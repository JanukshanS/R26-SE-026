"""Run DBSCAN hotspot analysis on scored incidents with the canonical parameters.

HotspotAnalyzer defaults to min_samples=5, but the canonical pipeline uses
eps_km=0.5, min_samples=4 (25 clusters, 356 noise on the 500-incident set).
This runner pins those values; it does not change the class default.
"""
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

import pandas as pd

from src.hotspot_analysis import HotspotAnalyzer

DATA_DIR = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), "data")


def run():
    df = pd.read_csv(os.path.join(DATA_DIR, "scored_incidents.csv"))
    results = HotspotAnalyzer(eps_km=0.5, min_samples=4).analyze(df)
    summary = results["summary"]

    print(f"Total incidents: {summary['total_incidents']}")
    print(f"Clusters found:  {summary['n_clusters']}")
    print(f"In clusters:     {summary['n_clustered']}")
    print(f"Noise:           {summary['n_noise']}")

    print(f"\n{'ID':>4} {'Count':>6} {'Avg Score':>10} {'Risk':>8} {'Road Type':<14} {'Peak Hr':>8}")
    for c in results["clusters"][:10]:
        print(f"{c.cluster_id:>4} {c.incident_count:>6} {c.avg_impact_score:>10.2f} "
              f"{c.composite_risk:>8.1f} {c.dominant_road_type:<14} {c.peak_hour:>5}:00")

    out = os.path.join(DATA_DIR, "hotspot_results.csv")
    results["clustered_df"].to_csv(out, index=False)
    print(f"\nSaved: {out}")
    return summary


if __name__ == "__main__":
    s = run()
    assert s["n_clusters"] == 25, f"expected 25 clusters, got {s['n_clusters']}"
    assert s["n_noise"] == 356, f"expected 356 noise points, got {s['n_noise']}"
    print("[self-check passed] 25 clusters / 356 noise")
