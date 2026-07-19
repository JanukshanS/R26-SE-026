"""
SUMO Traffic Simulation Module for Kaduna.lk
Simulates vehicle incidents on road networks and measures congestion metrics
to validate the Impact Scoring Model.

Author: Asath M M (IT22633422)
Component: Geo-Intelligence & Traffic Impact Analysis
"""
import os
import sys
import subprocess
import xml.etree.ElementTree as ET
import tempfile
import shutil
import numpy as np
import pandas as pd
from dataclasses import dataclass


@dataclass
class SimulationScenario:
    scenario_id: str
    road_type: str
    num_lanes: int
    lanes_blocked: int
    speed_limit_kmh: int
    traffic_volume_vph: int
    incident_duration_sec: int
    incident_type: str


@dataclass
class SimulationResult:
    scenario_id: str
    avg_speed_during: float
    avg_speed_baseline: float
    speed_reduction_pct: float
    max_queue_vehicles: int
    total_delay_sec: float
    total_vehicle_hours_lost: float
    throughput_during: int
    throughput_baseline: int
    congestion_severity: float  # normalised 0-1


def _find_sumo_tool(name: str) -> str:
    """Locate a SUMO helper tool (netgenerate, randomTrips, etc.)."""
    try:
        import sumo
        base = os.path.dirname(sumo.__file__)
        for sub in ["bin", "tools", "share/sumo/tools", ""]:
            candidate = os.path.join(base, sub, name)
            if os.path.isfile(candidate):
                return candidate
            candidate_py = candidate + ".py"
            if os.path.isfile(candidate_py):
                return candidate_py
        bin_path = shutil.which(name)
        if bin_path:
            return bin_path
    except ImportError:
        pass
    bin_path = shutil.which(name)
    if bin_path:
        return bin_path
    raise FileNotFoundError(f"Cannot find SUMO tool: {name}")


class SUMOSimulator:
    """
    Runs headless SUMO simulations to measure congestion from incidents.
    Uses synthetic road corridors for reproducibility.
    """

    ROAD_PARAMS = {
        "motorway":    {"speed": 33.3, "lanes": 4, "capacity_vph": 2200},
        "trunk":       {"speed": 22.2, "lanes": 2, "capacity_vph": 1800},
        "primary":     {"speed": 16.7, "lanes": 2, "capacity_vph": 1200},
        "secondary":   {"speed": 13.9, "lanes": 2, "capacity_vph": 800},
        "tertiary":    {"speed": 11.1, "lanes": 2, "capacity_vph": 600},
        "residential": {"speed": 8.3,  "lanes": 2, "capacity_vph": 300},
    }

    def __init__(self, work_dir: str | None = None):
        self.work_dir = work_dir or tempfile.mkdtemp(prefix="sumo_kaduna_")
        os.makedirs(self.work_dir, exist_ok=True)

    def _build_network(self, scenario: SimulationScenario) -> str:
        """Create a simple 3-edge corridor network for the scenario."""
        net_file = os.path.join(self.work_dir, f"{scenario.scenario_id}.net.xml")
        speed = self.ROAD_PARAMS.get(scenario.road_type, {}).get("speed", 13.9)

        nod_xml = f"""<?xml version="1.0" encoding="UTF-8"?>
<nodes>
    <node id="A" x="0" y="0"/>
    <node id="B" x="1000" y="0"/>
    <node id="C" x="2000" y="0"/>
    <node id="D" x="3000" y="0"/>
</nodes>"""

        edge_xml = f"""<?xml version="1.0" encoding="UTF-8"?>
<edges>
    <edge id="AB" from="A" to="B" numLanes="{scenario.num_lanes}" speed="{speed}"/>
    <edge id="BC" from="B" to="C" numLanes="{scenario.num_lanes}" speed="{speed}"/>
    <edge id="CD" from="C" to="D" numLanes="{scenario.num_lanes}" speed="{speed}"/>
</edges>"""

        nod_path = os.path.join(self.work_dir, f"{scenario.scenario_id}.nod.xml")
        edg_path = os.path.join(self.work_dir, f"{scenario.scenario_id}.edg.xml")
        with open(nod_path, "w") as f:
            f.write(nod_xml)
        with open(edg_path, "w") as f:
            f.write(edge_xml)

        netconvert = _find_sumo_tool("netconvert")
        subprocess.run(
            [netconvert, "-n", nod_path, "-e", edg_path, "-o", net_file,
             "--no-turnarounds", "true"],
            capture_output=True, check=True,
        )
        return net_file

    def _build_demand(self, scenario: SimulationScenario, net_file: str,
                      sim_seconds: int) -> str:
        """Generate vehicle demand (route file) for the corridor."""
        rou_file = os.path.join(self.work_dir, f"{scenario.scenario_id}.rou.xml")
        vph = scenario.traffic_volume_vph
        interval = 3600.0 / max(vph, 1)

        root = ET.Element("routes")
        ET.SubElement(root, "route", id="main", edges="AB BC CD")

        veh_id = 0
        for t in np.arange(0, sim_seconds, interval):
            ET.SubElement(root, "vehicle", id=f"v{veh_id}", route="main",
                          depart=f"{t:.1f}", departSpeed="max")
            veh_id += 1

        tree = ET.ElementTree(root)
        ET.indent(tree, space="    ")
        tree.write(rou_file, xml_declaration=True, encoding="UTF-8")
        return rou_file

    def _build_incident(self, scenario: SimulationScenario,
                        start_sec: int) -> str | None:
        """Create an additional file that restricts lanes on edge BC using maxspeed."""
        if scenario.lanes_blocked <= 0:
            return None
        add_file = os.path.join(self.work_dir, f"{scenario.scenario_id}.add.xml")
        end_sec = start_sec + scenario.incident_duration_sec

        # Use variableSpeedSign to reduce blocked lanes to near-zero speed
        vss_entries = []
        for i in range(scenario.lanes_blocked):
            vss_entries.append(
                f'    <variableSpeedSign id="vss_{i}" lanes="BC_{i}">'
                f'\n        <step time="{start_sec}" speed="0.1"/>'
                f'\n        <step time="{end_sec}" speed="-1"/>'
                f'\n    </variableSpeedSign>'
            )
        vss_xml = "\n".join(vss_entries)
        xml = f"""<?xml version="1.0" encoding="UTF-8"?>
<additional>
{vss_xml}
</additional>"""

        with open(add_file, "w") as f:
            f.write(xml)
        return add_file

    def _run_sumo(self, net_file: str, rou_file: str,
                  add_file: str | None, sim_seconds: int,
                  scenario_id: str) -> str:
        """Execute SUMO in headless mode and collect edge-level output."""
        out_file = os.path.join(self.work_dir, f"{scenario_id}_edge.xml")
        stats_file = os.path.join(self.work_dir, f"{scenario_id}_stats.xml")

        # Build a SUMO config file with edgeData collection via additional file
        measure_add = os.path.join(self.work_dir, f"{scenario_id}_measure.add.xml")
        measure_xml = f"""<?xml version="1.0" encoding="UTF-8"?>
<additional>
    <edgeData id="ed" file="{out_file}" freq="60"/>
</additional>"""
        with open(measure_add, "w") as f:
            f.write(measure_xml)

        add_files = [measure_add]
        if add_file:
            add_files.append(add_file)

        cfg = [
            "sumo",
            "-n", net_file,
            "-r", rou_file,
            "-a", ",".join(add_files),
            "--end", str(sim_seconds),
            "--no-step-log", "true",
            "--statistic-output", stats_file,
            "--no-warnings", "true",
        ]

        result = subprocess.run(cfg, capture_output=True, text=True)
        if result.returncode != 0 and "Error" in (result.stderr or ""):
            raise RuntimeError(f"SUMO failed: {result.stderr[:500]}")
        return out_file

    def _parse_edge_data(self, xml_path: str, edge_id: str = "BC") -> pd.DataFrame:
        """Parse SUMO edge-data output into a DataFrame."""
        if not os.path.exists(xml_path):
            return pd.DataFrame()
        tree = ET.parse(xml_path)
        rows = []
        for interval in tree.getroot():
            begin = float(interval.get("begin", 0))
            for edge in interval:
                if edge.get("id") == edge_id:
                    rows.append({
                        "time": begin,
                        "speed": float(edge.get("speed", 0)),
                        "density": float(edge.get("density", 0)),
                        "occupancy": float(edge.get("occupancy", 0)),
                        "entered": int(edge.get("entered", 0)),
                        "left": int(edge.get("left", 0)),
                        "waitingTime": float(edge.get("waitingTime", 0)),
                        "timeLoss": float(edge.get("timeLoss", 0)),
                    })
        return pd.DataFrame(rows)

    def run_scenario(self, scenario: SimulationScenario,
                     sim_minutes: int = 60,
                     incident_start_min: int = 10) -> SimulationResult:
        """Run a single scenario and return congestion metrics."""
        sim_sec = sim_minutes * 60
        incident_start_sec = incident_start_min * 60

        net_file = self._build_network(scenario)
        rou_file = self._build_demand(scenario, net_file, sim_sec)

        # Baseline run (no incident)
        baseline_out = self._run_sumo(net_file, rou_file, None, sim_sec,
                                       f"{scenario.scenario_id}_baseline")
        baseline_df = self._parse_edge_data(baseline_out)

        # Incident run
        add_file = self._build_incident(scenario, incident_start_sec)
        incident_out = self._run_sumo(net_file, rou_file, add_file, sim_sec,
                                       scenario.scenario_id)
        incident_df = self._parse_edge_data(incident_out)

        if baseline_df.empty or incident_df.empty:
            return SimulationResult(
                scenario_id=scenario.scenario_id,
                avg_speed_during=0, avg_speed_baseline=0, speed_reduction_pct=0,
                max_queue_vehicles=0, total_delay_sec=0, total_vehicle_hours_lost=0,
                throughput_during=0, throughput_baseline=0, congestion_severity=0,
            )

        avg_speed_base = baseline_df["speed"].mean()
        inc_end_sec = incident_start_sec + scenario.incident_duration_sec
        during = incident_df[
            (incident_df["time"] >= incident_start_sec) &
            (incident_df["time"] <= inc_end_sec)
        ]
        avg_speed_inc = during["speed"].mean() if len(during) > 0 else avg_speed_base

        speed_red = (1 - avg_speed_inc / max(avg_speed_base, 0.1)) * 100
        total_delay = incident_df["timeLoss"].sum() - baseline_df["timeLoss"].sum()
        total_delay = max(total_delay, 0)
        vhl = total_delay / 3600.0

        max_queue = int(during["density"].max() * 1.0) if len(during) > 0 else 0
        tp_base = int(baseline_df["left"].sum())
        tp_inc = int(incident_df["left"].sum())

        max_possible_delay = scenario.traffic_volume_vph * (scenario.incident_duration_sec / 3600)
        severity = min(vhl / max(max_possible_delay * 0.5, 1), 1.0)

        return SimulationResult(
            scenario_id=scenario.scenario_id,
            avg_speed_during=round(avg_speed_inc, 2),
            avg_speed_baseline=round(avg_speed_base, 2),
            speed_reduction_pct=round(max(speed_red, 0), 1),
            max_queue_vehicles=max_queue,
            total_delay_sec=round(total_delay, 1),
            total_vehicle_hours_lost=round(vhl, 2),
            throughput_during=tp_inc,
            throughput_baseline=tp_base,
            congestion_severity=round(severity, 4),
        )

    def run_batch(self, scenarios: list[SimulationScenario],
                  sim_minutes: int = 60) -> pd.DataFrame:
        """Run multiple scenarios and return a results DataFrame."""
        results = []
        for i, sc in enumerate(scenarios):
            print(f"  [{i+1}/{len(scenarios)}] {sc.scenario_id}: "
                  f"{sc.road_type} {sc.num_lanes}L, {sc.lanes_blocked} blocked, "
                  f"{sc.traffic_volume_vph} vph, {sc.incident_duration_sec}s ... ",
                  end="", flush=True)
            try:
                r = self.run_scenario(sc, sim_minutes=sim_minutes)
                results.append(r)
                print(f"VHL={r.total_vehicle_hours_lost:.2f}, "
                      f"speed_drop={r.speed_reduction_pct:.0f}%")
            except Exception as e:
                print(f"FAILED: {e}")
                results.append(SimulationResult(
                    scenario_id=sc.scenario_id,
                    avg_speed_during=0, avg_speed_baseline=0, speed_reduction_pct=0,
                    max_queue_vehicles=0, total_delay_sec=0, total_vehicle_hours_lost=0,
                    throughput_during=0, throughput_baseline=0, congestion_severity=0,
                ))

        rows = [vars(r) for r in results]
        return pd.DataFrame(rows)
