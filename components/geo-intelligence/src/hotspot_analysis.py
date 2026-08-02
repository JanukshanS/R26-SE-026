"""
Hotspot Analysis Module for Kaduna.lk
Identifies spatial clusters of vehicle incidents and correlates them
with road characteristics to find high-risk zones.

Author: Asath M M (IT22633422)
Component: Geo-Intelligence & Traffic Impact Analysis
"""
import numpy as np
import pandas as pd
import geopandas as gpd
from scipy.stats import gaussian_kde
from sklearn.cluster import DBSCAN
from sklearn.preprocessing import StandardScaler
from shapely.geometry import Point, MultiPoint
from dataclasses import dataclass
from typing import Optional


@dataclass
class HotspotCluster:
    cluster_id: int
    center_lat: float
    center_lon: float
    incident_count: int
    avg_impact_score: float
    composite_risk: float
    dominant_road_type: str
    dominant_incident_type: str
    peak_hour: int
    radius_m: float


class HotspotAnalyzer:
    """
    Performs spatial hotspot analysis on incident data using KDE and DBSCAN.
    Produces impact-weighted hotspot rankings and road-feature correlations.
    """

    def __init__(self, eps_km: float = 0.5, min_samples: int = 5):
        """
        Args:
            eps_km: DBSCAN neighbourhood radius in kilometres.
            min_samples: Minimum incidents to form a cluster.
        """
        self.eps_rad = eps_km / 6371.0  # convert km to radians for haversine
        self.min_samples = min_samples

    def run_kde(self, df: pd.DataFrame) -> np.ndarray:
        """Compute Kernel Density Estimation over incident locations."""
        coords = np.vstack([df["longitude"].values, df["latitude"].values])
        kde = gaussian_kde(coords, bw_method="scott")

        lon_grid = np.linspace(coords[0].min() - 0.01, coords[0].max() + 0.01, 200)
        lat_grid = np.linspace(coords[1].min() - 0.01, coords[1].max() + 0.01, 200)
        lon_mesh, lat_mesh = np.meshgrid(lon_grid, lat_grid)
        grid_coords = np.vstack([lon_mesh.ravel(), lat_mesh.ravel()])
        density = kde(grid_coords).reshape(lon_mesh.shape)

        return lon_grid, lat_grid, density

    def run_dbscan(self, df: pd.DataFrame) -> pd.DataFrame:
        """Cluster incidents using DBSCAN on geographic coordinates."""
        coords = df[["latitude", "longitude"]].values
        coords_rad = np.radians(coords)
        clustering = DBSCAN(
            eps=self.eps_rad, min_samples=self.min_samples, metric="haversine"
        )
        labels = clustering.fit_predict(coords_rad)
        df = df.copy()
        df["cluster"] = labels
        return df

    def compute_cluster_stats(self, df: pd.DataFrame) -> list[HotspotCluster]:
        """Compute statistics for each DBSCAN cluster."""
        clusters = []
        for cid in sorted(df["cluster"].unique()):
            if cid == -1:
                continue
            subset = df[df["cluster"] == cid]
            center_lat = subset["latitude"].mean()
            center_lon = subset["longitude"].mean()

            max_dist_deg = np.sqrt(
                (subset["latitude"] - center_lat).pow(2)
                + (subset["longitude"] - center_lon).pow(2)
            ).max()
            radius_m = max_dist_deg * 111_000

            clusters.append(HotspotCluster(
                cluster_id=cid,
                center_lat=round(center_lat, 6),
                center_lon=round(center_lon, 6),
                incident_count=len(subset),
                avg_impact_score=round(subset["impact_score"].mean(), 2),
                composite_risk=round(len(subset) * subset["impact_score"].mean(), 1),
                dominant_road_type=subset["road_type"].mode().iloc[0],
                dominant_incident_type=subset["incident_type"].mode().iloc[0],
                peak_hour=int(subset["hour"].mode().iloc[0]),
                radius_m=round(radius_m, 1),
            ))
        clusters.sort(key=lambda c: c.composite_risk, reverse=True)
        return clusters

    def correlate_road_features(self, df: pd.DataFrame) -> pd.DataFrame:
        """Correlate incident frequency and impact with road features."""
        road_stats = df.groupby("road_type").agg(
            incident_count=("incident_id", "count"),
            avg_score=("impact_score", "mean"),
            avg_queue_km=("predicted_queue_km", "mean"),
            avg_vhl=("predicted_vhl", "mean"),
            avg_lanes=("total_lanes", "mean"),
            pct_peak_hour=("hour", lambda x: ((x >= 7) & (x <= 9) | (x >= 17) & (x <= 19)).mean() * 100),
        ).round(2)
        road_stats["composite_risk"] = (
            road_stats["incident_count"] * road_stats["avg_score"]
        ).round(1)
        return road_stats.sort_values("composite_risk", ascending=False)

    def analyze(self, df: pd.DataFrame) -> dict:
        """Run the full hotspot analysis pipeline."""
        clustered = self.run_dbscan(df)
        lon_grid, lat_grid, density = self.run_kde(df)
        clusters = self.compute_cluster_stats(clustered)
        road_corr = self.correlate_road_features(df)

        n_clustered = (clustered["cluster"] != -1).sum()
        n_noise = (clustered["cluster"] == -1).sum()
        n_clusters = len(clusters)

        return {
            "clustered_df": clustered,
            "kde_grid": (lon_grid, lat_grid, density),
            "clusters": clusters,
            "road_correlation": road_corr,
            "summary": {
                "total_incidents": len(df),
                "n_clusters": n_clusters,
                "n_clustered": n_clustered,
                "n_noise": n_noise,
                "top_cluster_risk": clusters[0].composite_risk if clusters else 0,
            },
        }
