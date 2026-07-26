"""S3/R2 user-defined object metadata (ASCII-only values per AWS rules)."""

import re
from datetime import datetime
from typing import Any, Dict, Optional

# Sentinel values used when the mobile app omits claimant/vehicle fields.
# These must be clearly non-real so they are never mistaken for actual PII.
# TODO: enforce required fields in CreateCaptureRequest so these are never needed.
_PLACEHOLDER_CLAIMANT_NAME = "UNKNOWN"
_PLACEHOLDER_CLAIMANT_NIC = "000000000000"
_PLACEHOLDER_CLAIMANT_LICENCE = "UNKNOWN"
_PLACEHOLDER_VEHICLE_MODEL = "UNKNOWN"
_PLACEHOLDER_POLICY_NUMBER = "UNKNOWN"


def build_parent_folder_name(name: Optional[str], nic: Optional[str]) -> str:
    """Return the R2 parent folder, e.g. 'Jane Doe - 000000000000'."""
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
    gps_lat: Optional[float] = None,
    gps_lng: Optional[float] = None,
    gps_accuracy: Optional[float] = None,
    captured_at_client: Optional[datetime] = None,
) -> Dict[str, str]:
    """
    Keys become x-amz-meta-* in R2/S3. Values must be ASCII-only for broad compatibility.
    """
    photo_ts = ""
    if isinstance(captured_at_client, datetime):
        photo_ts = captured_at_client.isoformat()
    elif captured_at_client is not None:
        photo_ts = _ascii_meta_value(str(captured_at_client))

    meta: Dict[str, str] = {
        "capture-id": _ascii_meta_value(str(capture.get("id", ""))),
        "photo-index": str(int(photo_index)),
        "asset-kind": _ascii_meta_value(asset_kind),
        "claimant-name": _ascii_meta_value(capture.get("claimant_name") or _PLACEHOLDER_CLAIMANT_NAME),
        "claimant-nic": _ascii_meta_value(capture.get("claimant_nic") or _PLACEHOLDER_CLAIMANT_NIC),
        "claimant-licence": _ascii_meta_value(capture.get("claimant_licence_number") or _PLACEHOLDER_CLAIMANT_LICENCE),
        "vehicle-model": _ascii_meta_value(capture.get("vehicle_model") or _PLACEHOLDER_VEHICLE_MODEL),
        "policy-number": _ascii_meta_value(capture.get("policy_number") or _PLACEHOLDER_POLICY_NUMBER),
        # No placeholder fallback here — the Insurer Dashboard only shows this field
        # when the key is present at all (`if metadata.get("vehicle-reg-no")`), and
        # falls back to its own UI placeholder otherwise, so an empty value is
        # correctly dropped by this function's final `!= ""` filter below.
        "vehicle-reg-no": _ascii_meta_value(capture.get("vehicle_reg_no")),
        "photo-gps-lat": _num_str(gps_lat),
        "photo-gps-lng": _num_str(gps_lng),
        "photo-gps-accuracy": _num_str(gps_accuracy),
        "photo-captured-at": _ascii_meta_value(photo_ts or None),
    }
    return {k: v for k, v in meta.items() if v != ""}
