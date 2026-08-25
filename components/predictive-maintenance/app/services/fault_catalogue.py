"""What each trouble code means, how urgent it is, and what it damages next.

WHY THIS IS A HAND-WRITTEN TABLE AND NOT A MODEL. Two of these fields decide
what a driver spends money on, so neither may be generated:

  * `severity` sets how loudly the app shouts. If it came from "a code is
    present" then a loose fuel cap (P0457) would shout as loudly as a misfire,
    and once a driver learns the alerts are noise they stop reading the one
    that mattered.

  * `leads_to` is the predictive part - the claim that THIS fault causes THAT
    failure later. A language model asked "what will this damage?" will answer
    fluently every time, including when it is wrong, and the driver has no way
    to check. So the consequence is looked up here and the model is only ever
    asked to phrase it.

This is the same split as app/advice.py: the decision is computed, the wording
is generated.

COVERAGE IS HONEST, NOT COMPLETE. There are thousands of manufacturer-specific
codes. This table holds the common generic ones, and `lookup()` falls back to
the code family so an unknown code still resolves to a component and sensible
generic handling rather than vanishing.

A NOTE ON BRAKES AND TYRES. Generic OBD-II mode 03 is powertrain and
emissions. ABS faults are C-codes and tyre pressure faults are usually
manufacturer-specific, and most dongles cannot read either through a generic
request. The few C-codes here are included because they map cleanly when a
vehicle does expose them - but trouble codes will improve engine and charging
diagnosis far more than they improve brakes and tyres. That gap is closed by
the wear model, not by this table.
"""
from __future__ import annotations

from dataclasses import dataclass, field
from typing import Dict, List, Optional

# Which of the app's four components a fault belongs to. `other` exists
# because forcing a transmission fault into "Brake Pads" to avoid a fifth
# bucket would put a visibly wrong statement on the screen, and one of those
# costs more trust than a hundred correct ones earn.
COMPONENTS = ("engine", "brake", "tire", "battery", "other")

# Mirrors the urgency vocabulary in app/advice.py so the two can be compared
# directly when a fault escalates a component.
SEVERITIES = ("urgent", "soon", "monitor")


@dataclass(frozen=True)
class Consequence:
    """What this fault damages if it is left alone."""

    damage: str
    # The code the secondary failure will itself set, when there is one. Lets
    # the app say "this is why P0420 appeared" if it later does.
    code: Optional[str] = None
    # Roughly how much more the secondary repair costs than fixing the cause.
    # Deliberately a multiplier, not a price: it stays true as prices move.
    cost_multiplier: Optional[float] = None


@dataclass(frozen=True)
class FaultInfo:
    code: str
    title: str
    component: str
    severity: str
    likely_causes: List[str] = field(default_factory=list)
    leads_to: List[Consequence] = field(default_factory=list)
    parts: List[str] = field(default_factory=list)
    # True when this came from a family fallback rather than an exact entry,
    # so the UI can hedge its wording instead of asserting a specific fault.
    is_generic: bool = False


def _misfire(cylinder: int) -> FaultInfo:
    """P0301-P0308 differ only by cylinder number."""
    return FaultInfo(
        code=f"P030{cylinder}",
        title=f"Cylinder {cylinder} misfire detected",
        component="engine",
        severity="urgent",
        likely_causes=[
            f"ignition coil on cylinder {cylinder}",
            f"spark plug on cylinder {cylinder}",
            f"fuel injector on cylinder {cylinder}",
            "low compression on that cylinder",
        ],
        leads_to=[
            Consequence(
                damage="unburnt fuel reaches the catalytic converter and overheats it",
                code="P0420",
                cost_multiplier=10.0,
            )
        ],
        parts=["ignition coil", "spark plug"],
    )


_ENTRIES: List[FaultInfo] = [
    # ── Misfires ─────────────────────────────────────────────────────────
    # Urgent across the board. A misfire is the textbook case for this whole
    # feature: cheap to fix, and expensive to ignore, in a way a driver cannot
    # possibly infer from a flashing light.
    FaultInfo(
        code="P0300",
        title="Random or multiple cylinder misfire",
        component="engine",
        severity="urgent",
        likely_causes=[
            "worn spark plugs across several cylinders",
            "vacuum leak",
            "low fuel pressure",
            "faulty ignition coils",
        ],
        leads_to=[
            Consequence(
                damage="unburnt fuel reaches the catalytic converter and overheats it",
                code="P0420",
                cost_multiplier=10.0,
            )
        ],
        parts=["spark plug", "ignition coil"],
    ),
    *[_misfire(n) for n in range(1, 9)],

    # ── Fuel mixture ─────────────────────────────────────────────────────
    FaultInfo(
        code="P0171",
        title="Engine running lean (too much air, too little fuel)",
        component="engine",
        severity="soon",
        likely_causes=[
            "vacuum or intake air leak",
            "dirty mass airflow sensor",
            "weak fuel pump or blocked filter",
            "tiring oxygen sensor",
        ],
        leads_to=[
            Consequence(
                damage="higher combustion temperatures, which shorten catalytic converter life",
                code="P0420",
                cost_multiplier=8.0,
            )
        ],
        parts=["air filter", "oxygen sensor"],
    ),
    FaultInfo(
        code="P0172",
        title="Engine running rich (too much fuel)",
        component="engine",
        severity="soon",
        likely_causes=[
            "clogged air filter",
            "leaking fuel injector",
            "faulty coolant temperature sensor",
            "failing oxygen sensor",
        ],
        leads_to=[
            Consequence(
                damage="excess fuel contaminates the catalytic converter and dilutes engine oil",
                code="P0420",
                cost_multiplier=8.0,
            )
        ],
        parts=["air filter", "oxygen sensor"],
    ),

    # ── Cooling ──────────────────────────────────────────────────────────
    FaultInfo(
        code="P0128",
        title="Engine not reaching normal operating temperature",
        component="engine",
        severity="soon",
        likely_causes=["thermostat stuck open", "faulty coolant temperature sensor"],
        leads_to=[
            Consequence(
                damage="the engine runs cold, so water and fuel stay in the oil and wear increases",
                cost_multiplier=6.0,
            )
        ],
        parts=["thermostat"],
    ),
    FaultInfo(
        code="P0217",
        title="Engine overheating",
        component="engine",
        severity="urgent",
        likely_causes=[
            "low coolant level or a leak",
            "failed water pump",
            "blocked radiator",
            "thermostat stuck closed",
        ],
        leads_to=[
            Consequence(
                damage="a warped cylinder head or blown head gasket, which means engine rebuild work",
                cost_multiplier=20.0,
            )
        ],
        parts=["thermostat", "coolant"],
    ),

    # ── Catalyst and oxygen sensors ──────────────────────────────────────
    # Note these are usually the CONSEQUENCE of a fault above, which is why
    # they carry no leads_to of their own.
    FaultInfo(
        code="P0420",
        title="Catalytic converter below efficiency threshold",
        component="engine",
        severity="soon",
        likely_causes=[
            "worn catalytic converter",
            "faulty oxygen sensor reading",
            "an untreated misfire or mixture fault that damaged it",
        ],
        parts=["oxygen sensor"],
    ),
    FaultInfo(
        code="P0430",
        title="Catalytic converter below efficiency threshold (bank 2)",
        component="engine",
        severity="soon",
        likely_causes=["worn catalytic converter", "faulty oxygen sensor reading"],
        parts=["oxygen sensor"],
    ),
    FaultInfo(
        code="P0135",
        title="Oxygen sensor heater fault",
        component="engine",
        severity="monitor",
        likely_causes=["failed oxygen sensor heater element", "blown fuse or wiring fault"],
        parts=["oxygen sensor"],
    ),

    # ── Charging system: the codes that map to Battery ───────────────────
    # These matter because a driver reads "battery" and buys a battery, when
    # the battery is often the victim rather than the fault.
    FaultInfo(
        code="P0562",
        title="Charging system voltage too low",
        component="battery",
        severity="urgent",
        likely_causes=[
            "failing alternator",
            "loose or corroded battery terminals",
            "worn drive belt",
            "battery at the end of its life",
        ],
        leads_to=[
            Consequence(
                damage="the battery is never fully recharged and fails early, and the car eventually will not start",
                cost_multiplier=3.0,
            )
        ],
        parts=["battery", "alternator"],
    ),
    FaultInfo(
        code="P0563",
        title="Charging system voltage too high",
        component="battery",
        severity="urgent",
        likely_causes=["faulty voltage regulator", "failing alternator"],
        leads_to=[
            Consequence(
                damage="overcharging boils the battery dry and can damage electronics",
                cost_multiplier=4.0,
            )
        ],
        parts=["battery", "alternator"],
    ),
    FaultInfo(
        code="P0620",
        title="Generator (alternator) control circuit fault",
        component="battery",
        severity="urgent",
        likely_causes=["failing alternator", "wiring or connector fault"],
        leads_to=[
            Consequence(
                damage="the battery stops being charged and the car will not restart",
                cost_multiplier=3.0,
            )
        ],
        parts=["alternator"],
    ),

    # ── Emissions and evaporative: real, but rarely urgent ───────────────
    # Included mainly so they are correctly filed as low priority. Treating
    # these as alarms is exactly how alert fatigue starts.
    FaultInfo(
        code="P0442",
        title="Small leak in the fuel vapour system",
        component="other",
        severity="monitor",
        likely_causes=["loose or worn fuel cap", "perished vapour hose"],
    ),
    FaultInfo(
        code="P0455",
        title="Large leak in the fuel vapour system",
        component="other",
        severity="monitor",
        likely_causes=["missing or unsealed fuel cap", "disconnected vapour hose"],
    ),
    FaultInfo(
        code="P0457",
        title="Fuel cap loose or missing",
        component="other",
        severity="monitor",
        likely_causes=["fuel cap not tightened after refuelling"],
    ),
    FaultInfo(
        code="P0401",
        title="Exhaust gas recirculation flow insufficient",
        component="engine",
        severity="monitor",
        likely_causes=["carbon-blocked EGR passage", "faulty EGR valve"],
    ),

    # ── Transmission: maps to no component we model ──────────────────────
    FaultInfo(
        code="P0700",
        title="Transmission control system fault",
        component="other",
        severity="urgent",
        likely_causes=["a transmission fault stored in a separate controller"],
        leads_to=[
            Consequence(
                damage="continued driving on a slipping or overheating transmission causes internal damage",
                cost_multiplier=15.0,
            )
        ],
    ),

    # ── Chassis codes: brakes, when a vehicle exposes them ───────────────
    FaultInfo(
        code="C0035",
        title="Left front wheel speed sensor fault",
        component="brake",
        severity="urgent",
        likely_causes=["damaged wheel speed sensor", "corroded connector", "damaged wiring"],
        leads_to=[
            Consequence(
                damage="ABS and stability control are disabled, so the car may not stop straight in an emergency",
                cost_multiplier=1.0,
            )
        ],
    ),
    FaultInfo(
        code="C0040",
        title="Right front wheel speed sensor fault",
        component="brake",
        severity="urgent",
        likely_causes=["damaged wheel speed sensor", "corroded connector", "damaged wiring"],
        leads_to=[
            Consequence(
                damage="ABS and stability control are disabled, so the car may not stop straight in an emergency",
                cost_multiplier=1.0,
            )
        ],
    ),
]

CATALOGUE: Dict[str, FaultInfo] = {entry.code: entry for entry in _ENTRIES}


# Family fallbacks, most specific prefix first. An unknown code must still
# reach a component and a defensible severity: silently dropping it would mean
# a dashboard light with nothing on screen to explain it, which is worse than
# a general description.
_FAMILIES: List[tuple[str, str, str, str]] = [
    # (prefix, component, severity, description)
    ("P030", "engine", "urgent", "Engine misfire"),
    ("P00", "engine", "soon", "Fuel or air metering fault"),
    ("P01", "engine", "soon", "Fuel or air metering fault"),
    ("P02", "engine", "soon", "Fuel injector circuit fault"),
    ("P03", "engine", "urgent", "Ignition system or misfire fault"),
    ("P04", "engine", "monitor", "Emissions control fault"),
    ("P05", "engine", "soon", "Vehicle speed or idle control fault"),
    ("P06", "other", "soon", "Engine computer or output circuit fault"),
    ("P07", "other", "urgent", "Transmission fault"),
    ("P08", "other", "soon", "Transmission fault"),
    ("P09", "other", "soon", "Transmission fault"),
    ("C", "brake", "urgent", "Chassis fault, often ABS or braking related"),
    ("B", "other", "monitor", "Body system fault"),
    ("U", "other", "soon", "Network communication fault between control units"),
]


def lookup(code: str) -> Optional[FaultInfo]:
    """Everything known about a code, exact entry first, then its family.

    Returns None only for something that is not a trouble code at all. A real
    but uncatalogued code always resolves, with `is_generic` set so the caller
    can say "an ignition system fault" instead of asserting a specific defect
    it cannot actually name.
    """
    if not code:
        return None
    key = code.strip().upper()

    exact = CATALOGUE.get(key)
    if exact is not None:
        return exact

    if len(key) < 5 or key[0] not in "PCBU" or not key[1:].isalnum():
        return None

    for prefix, component, severity, description in _FAMILIES:
        if key.startswith(prefix):
            return FaultInfo(
                code=key,
                title=f"{description} ({key})",
                component=component,
                severity=severity,
                likely_causes=[],
                is_generic=True,
            )
    return None


def component_for(code: str) -> str:
    """Which of the four components a code belongs to, or 'other'."""
    info = lookup(code)
    return info.component if info else "other"


def most_severe(severities: List[str]) -> Optional[str]:
    """The highest severity in a set, using the catalogue's ordering."""
    for level in SEVERITIES:
        if level in severities:
            return level
    return None
