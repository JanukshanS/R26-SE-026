"""Shared mapping logic for parts and garages catalogue data."""
from __future__ import annotations

from typing import Dict, List, Optional

VALID_COMPONENTS = frozenset({"engine", "brake", "tire", "battery"})

CATEGORY_TO_COMPONENT: Dict[str, str] = {
    "brakes": "brake",
    "batteries": "battery",
    "engine parts": "engine",
    "lubricants": "engine",
    "tyres": "tire",
    "tires": "tire",
}

NAME_OVERRIDES: List[tuple[str, Optional[str]]] = [
    ("cabin air filter", None),
    ("cabin filter", None),
    ("oil filter", "engine"),
    ("air filter", "engine"),
    ("spark plug", "engine"),
    ("engine oil", "engine"),
    ("alternator", "battery"),
]

SERVICE_TO_COMPONENT: Dict[str, List[str]] = {
    "oil change": ["engine"],
    "engine repair": ["engine"],
    "engine service": ["engine"],
    "engine overhaul": ["engine"],
    "diesel repair": ["engine"],
    "general repair": ["engine"],
    "brake service": ["brake"],
    "brake repair": ["brake"],
    "tyre service": ["tire"],
    "tire service": ["tire"],
    "battery service": ["battery"],
    "battery repair": ["battery"],
    "ev diagnostics": ["battery"],
    "hybrid diagnostics": ["battery"],
    "hybrid repair": ["battery", "engine"],
    "electrical repair": ["battery"],
    "electrical service": ["battery"],
}

# Suburb-level positions, checked BEFORE the city table below.
#
# WHY THIS MATTERS MORE THAN IT LOOKS: every Colombo garage used to be stored
# at the single Colombo city centroid, so a driver in Malabe was told that a
# workshop in Moratuwa and one in Rajagiriya were both "0.0 km away". Distance
# then carried no information at all, and the recommendation had nothing real
# to weigh against rating - while still presenting the result as a distance.
#
# Greater Colombo is roughly 30 km across, so suburb resolution turns that from
# noise into a genuine signal. Anything outside this table still falls back to
# the city centroid and is flagged approximate, which the UI and the prompt
# both respect.
AREA_COORDS: Dict[str, tuple[float, float]] = {
    # Colombo city
    "colombo 01": (6.9355, 79.8487),
    "pettah": (6.9355, 79.8487),
    "fort": (6.9344, 79.8428),
    "slave island": (6.9244, 79.8500),
    "borella": (6.9147, 79.8778),
    "maradana": (6.9294, 79.8664),
    "dematagoda": (6.9331, 79.8767),
    "kirulapone": (6.8797, 79.8747),
    "narahenpita": (6.8919, 79.8778),
    "kollupitiya": (6.9111, 79.8503),
    "bambalapitiya": (6.8931, 79.8564),
    "wellawatte": (6.8747, 79.8608),
    # Eastern suburbs
    "rajagiriya": (6.9097, 79.8947),
    "nawala": (6.8964, 79.8817),
    "battaramulla": (6.8983, 79.9186),
    "pelawatte": (6.8878, 79.9256),
    "thalawathugoda": (6.8767, 79.9394),
    "malabe": (6.9061, 79.9553),
    "kaduwela": (6.9333, 79.9833),
    "athurugiriya": (6.8747, 79.9636),
    "kotte": (6.8875, 79.9019),
    "kolonnawa": (6.9333, 79.8917),
    "welivita": (6.9258, 79.9694),
    # Southern suburbs
    "nugegoda": (6.8649, 79.8997),
    "kohuwala": (6.8656, 79.8836),
    "maharagama": (6.8481, 79.9267),
    "kottawa": (6.8408, 79.9647),
    "homagama": (6.8441, 80.0022),
    "piliyandala": (6.8018, 79.9223),
    "dehiwala": (6.8511, 79.8653),
    "mount lavinia": (6.8389, 79.8653),
    "ratmalana": (6.8189, 79.8861),
    "moratuwa": (6.7730, 79.8816),
    "boralesgamuwa": (6.8397, 79.9036),
    # Northern suburbs
    "kelaniya": (6.9553, 79.9219),
    "kiribathgoda": (6.9789, 79.9297),
    "wattala": (6.9897, 79.8917),
    "ja-ela": (7.0744, 79.8919),
    "peliyagoda": (6.9603, 79.8842),
}

CITY_COORDS: Dict[str, tuple[float, float]] = {
    "colombo": (6.9271, 79.8612),
    "matara": (5.9485, 80.5353),
    "kandy": (7.2906, 80.6337),
    "galle": (6.0535, 80.2210),
    "hambantota": (6.1241, 81.1185),
    "nuwara eliya": (6.9497, 80.7891),
    "negombo": (7.2083, 79.8358),
    "matale": (7.4675, 80.6234),
}


def resolve_coords(
    city: Optional[str], area: Optional[str]
) -> tuple[Optional[tuple[float, float]], bool]:
    """Best known position for a garage, and whether it is only city-level.

    Returns (coords, is_city_level). A city-level position can be tens of
    kilometres from the actual workshop, so callers must mark the distance
    approximate rather than printing it as a measurement.
    """
    if area:
        coords = AREA_COORDS.get(area.strip().lower())
        if coords is not None:
            return coords, False
    if city:
        coords = CITY_COORDS.get(city.strip().lower())
        if coords is not None:
            return coords, True
    return None, False


def resolve_component(name: str, category: str) -> Optional[str]:
    lowered = name.lower()
    for needle, component in NAME_OVERRIDES:
        if needle in lowered:
            return component
    return CATEGORY_TO_COMPONENT.get(category.strip().lower())


def parse_fitment(entries: List[str]) -> tuple[str, bool]:
    models: List[str] = []
    any_model = False
    for raw in entries or []:
        value = raw.strip().lower()
        if not value:
            continue
        if value.endswith(" vehicles") or "compatible" in value:
            any_model = True
            models.append(value.replace(" vehicles", "").strip())
        else:
            models.append(value)
    return ",".join(models), any_model


def map_garage_services(names: List[str]) -> List[str]:
    out: List[str] = []
    for raw in names:
        for key in SERVICE_TO_COMPONENT.get(raw.strip().lower(), []):
            if key not in out:
                out.append(key)
    return out


def split_csv(raw: Optional[str]) -> List[str]:
    if not raw:
        return []
    return [s.strip() for s in raw.split(",") if s.strip()]
