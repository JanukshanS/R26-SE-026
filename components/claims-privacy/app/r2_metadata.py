"""S3/R2 user-defined object metadata (ASCII-only values per AWS rules)."""

import re
from datetime import datetime
from typing import Any, Dict, Optional

# Temporary: claimant columns on `captures` may be empty; remove when the app always sends them.
_PLACEHOLDER_CLAIMANT_NAME = "Dilnuk De Silva"
_PLACEHOLDER_CLAIMANT_NIC = "200221301732"
_PLACEHOLDER_CLAIMANT_LICENCE = "B4818153"
_PLACEHOLDER_VEHICLE_MODEL = "Toyota Raize"
_PLACEHOLDER_POLICY_NUMBER = "AL-VIP-00001"


def build_parent_folder_name(name: Optional[str], nic: Optional[str]) -> str:
    """Return the R2 parent folder, e.g. 'Dilnuk De Silva - 200221301732'."""
    resolved_name = name.strip() if name else _PLACEHOLDER_CLAIMANT_NAME
    resolved_nic = nic.strip() if nic else _PLACEHOLDER_CLAIMANT_NIC
    safe_name = re.sub(r"[/\\]", "-", resolved_name)
    safe_nic = re.sub(r"[/\\]", "-", resolved_nic)
    return f"{safe_name} - {safe_nic}"


def _ascii_meta_value(value: Optional[str], max_len: int = 900) -> str:
    if value is None:
        return ""
    text = str(value).replace("\r", " ").replace("\n", " ").strip()
    return text.encode("ascii", errors="replace").decode("ascii")[:max_len]


def _num_str(v: Any) -> str:
    if v is None:
        return ""
    try:
        return str(float(v))
    except (TypeError, ValueError):
        return ""


def build_photo_object_metadata(
    capture: Dict[str, Any],
    *,
    photo_index: int,
    asset_kind: str,
) -> Dict[str, str]:
    """
    Keys become x-amz-meta-* in R2/S3. Values must be ASCII-only for broad compatibility.
    """
    report_at = capture.get("report_captured_at")
    ts = ""
    if isinstance(report_at, datetime):
        ts = report_at.isoformat()
    elif report_at is not None:
        ts = _ascii_meta_value(str(report_at))

    meta: Dict[str, str] = {
        "capture-id": _ascii_meta_value(str(capture.get("id", ""))),
        "photo-index": str(int(photo_index)),
        "asset-kind": _ascii_meta_value(asset_kind),
        "claimant-name": _ascii_meta_value(_PLACEHOLDER_CLAIMANT_NAME),
        "claimant-nic": _ascii_meta_value(_PLACEHOLDER_CLAIMANT_NIC),
        "claimant-licence": _ascii_meta_value(_PLACEHOLDER_CLAIMANT_LICENCE),
        "vehicle-model": _ascii_meta_value(_PLACEHOLDER_VEHICLE_MODEL),
        "policy-number": _ascii_meta_value(_PLACEHOLDER_POLICY_NUMBER),
        "report-timestamp": _ascii_meta_value(ts or None),
        "report-timestamp-local": _ascii_meta_value(capture.get("report_captured_at_display_local")),
        "report-gps-lat": _num_str(capture.get("report_gps_lat")),
        "report-gps-lng": _num_str(capture.get("report_gps_lng")),
        "report-location": _ascii_meta_value(capture.get("report_location_label")),
    }
    return {k: v for k, v in meta.items() if v != ""}
