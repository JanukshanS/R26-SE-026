"""Trouble code decoding and the fault catalogue.

Every case here is a real ELM327 reply shape. The wire format is the risky
part of this feature - the decoding maths is four bit-shifts, but adapters
disagree about framing, padding and whether a count byte is present, and a
mistake there silently produces plausible wrong codes rather than an error.
"""
from __future__ import annotations

from app.services.dtc import decode_dtc, parse_dtc_response, parse_mil_status
from app.services.fault_catalogue import (
    CATALOGUE,
    COMPONENTS,
    SEVERITIES,
    component_for,
    lookup,
    most_severe,
)


# ── Bit layout ────────────────────────────────────────────────────────────

def test_decodes_the_four_systems():
    # Top two bits select P / C / B / U.
    assert decode_dtc(0x03, 0x01) == "P0301"
    assert decode_dtc(0x43, 0x01) == "C0301"
    assert decode_dtc(0x83, 0x01) == "B0301"
    assert decode_dtc(0xC3, 0x01) == "U0301"


def test_decodes_the_first_digit_range():
    assert decode_dtc(0x01, 0x71) == "P0171"
    assert decode_dtc(0x11, 0x71) == "P1171"
    assert decode_dtc(0x21, 0x71) == "P2171"
    assert decode_dtc(0x31, 0x71) == "P3171"


def test_decodes_hex_digits_not_just_decimal():
    # The last three digits are hex - a decoder that formatted them as decimal
    # would produce a code that does not exist.
    assert decode_dtc(0x0A, 0xBC) == "P0ABC"


def test_all_zero_is_padding_not_a_code():
    # Older protocols pad every reply to a fixed length with 0000. Treating
    # that as P0000 would report a fault on every healthy car.
    assert decode_dtc(0x00, 0x00) is None


# ── Wire formats ──────────────────────────────────────────────────────────

def test_older_protocol_reply_with_zero_padding():
    assert parse_dtc_response("43 01 33 00 00 00 00") == ["P0133"]


def test_can_reply_with_leading_count_byte():
    # 43, then a count of 2, then two codes. The count byte makes the payload
    # odd-length, which is how it is detected without knowing the protocol.
    assert parse_dtc_response("43 02 01 33 01 71") == ["P0133", "P0171"]


def test_multi_frame_reply_with_line_prefixes():
    raw = "009\r0: 43 02 01 33 01\r1: 71 00 00 00 00 00\r\r>"
    assert parse_dtc_response(raw) == ["P0133", "P0171"]


def test_reply_without_spaces():
    # ATS0 turns spaces off, which is what the app actually configures.
    assert parse_dtc_response("4301330000") == ["P0133"]


def test_no_data_means_no_codes():
    assert parse_dtc_response("NO DATA") == []
    assert parse_dtc_response("NO DATA\r\r>") == []


def test_protocol_noise_before_the_reply_is_ignored():
    assert parse_dtc_response("SEARCHING...\r43 01 33 00 00") == ["P0133"]


def test_pending_and_permanent_modes_have_their_own_headers():
    # Mode 07 answers 47 and mode 0A answers 4A. Parsing one with another
    # mode's header must find nothing rather than misread the bytes.
    assert parse_dtc_response("47 01 33 00 00", mode="07") == ["P0133"]
    assert parse_dtc_response("4A 01 33 00 00", mode="0A") == ["P0133"]
    assert parse_dtc_response("47 01 33 00 00", mode="03") == []


def test_duplicate_codes_are_reported_once():
    assert parse_dtc_response("43 01 33 01 33 00 00") == ["P0133"]


def test_garbage_never_raises():
    # A dongle answering strangely must not be able to fail a trip upload.
    for raw in ["", "   ", ">", "ZZZZ", "43", "\x00\x01", "?", "STOPPED"]:
        assert parse_dtc_response(raw) == []


def test_unknown_mode_returns_nothing():
    assert parse_dtc_response("43 01 33", mode="99") == []


# ── MIL status ────────────────────────────────────────────────────────────

def test_mil_status_reads_lamp_and_count():
    # Bit 7 set, low bits = 3 stored codes.
    assert parse_mil_status("41 01 83 07 65 04") == {"mil_on": True, "dtc_count": 3}


def test_mil_status_lamp_off():
    assert parse_mil_status("41 01 00 07 65 04") == {"mil_on": False, "dtc_count": 0}


def test_mil_status_returns_none_when_unreadable():
    assert parse_mil_status("NO DATA") is None


# ── Catalogue ─────────────────────────────────────────────────────────────

def test_every_catalogue_entry_is_internally_valid():
    for code, info in CATALOGUE.items():
        assert info.code == code
        assert info.component in COMPONENTS, f"{code} has component {info.component}"
        assert info.severity in SEVERITIES, f"{code} has severity {info.severity}"
        assert info.title.strip()


def test_misfire_predicts_catalytic_converter_damage():
    """The propagation claim is the predictive part of this feature.

    It is data rather than model output precisely so it can be asserted.
    """
    info = lookup("P0301")
    assert info is not None
    assert info.component == "engine"
    assert info.severity == "urgent"
    assert info.leads_to
    assert info.leads_to[0].code == "P0420"
    assert info.leads_to[0].cost_multiplier == 10.0


def test_charging_faults_map_to_battery_not_engine():
    """A driver reading "battery" buys a battery.

    P0562 is usually the alternator, with the battery as the victim, so filing
    it under Battery is what puts the alternator in front of them at all.
    """
    assert component_for("P0562") == "battery"
    assert component_for("P0563") == "battery"
    assert component_for("P0620") == "battery"


def test_trivial_codes_are_not_urgent():
    """Alert fatigue is the failure mode this prevents.

    If a loose fuel cap shouts as loudly as a misfire, drivers stop reading
    alerts and miss the one that mattered.
    """
    for code in ("P0442", "P0455", "P0457"):
        info = lookup(code)
        assert info is not None and info.severity == "monitor"


def test_transmission_faults_are_not_forced_into_a_component():
    # Filing a transmission fault under "Brake Pads" would put a visibly wrong
    # statement on screen, which costs more trust than a fifth bucket does.
    assert component_for("P0700") == "other"


def test_unknown_code_falls_back_to_its_family():
    info = lookup("P0399")
    assert info is not None
    assert info.is_generic is True
    assert info.component == "engine"
    assert info.severity in SEVERITIES
    # No invented cause list - the family knows the area, not the defect.
    assert info.likely_causes == []


def test_family_fallback_prefers_the_most_specific_prefix():
    # P030x is misfire-urgent; the broader P03 family must not shadow it.
    assert lookup("P0309").severity == "urgent"


def test_chassis_codes_fall_back_to_brake():
    info = lookup("C0123")
    assert info is not None and info.component == "brake"


def test_non_codes_return_nothing():
    for value in ("", "hello", "1234", "X0301", "P03"):
        assert lookup(value) is None


def test_most_severe_picks_the_worst():
    assert most_severe(["monitor", "urgent", "soon"]) == "urgent"
    assert most_severe(["monitor", "soon"]) == "soon"
    assert most_severe([]) is None
