"""Decoding OBD-II diagnostic trouble codes off the wire.

WHAT THIS IS FOR. The wear model answers "how much life is left?". It cannot
answer "what is wrong?", because nothing in it represents a fault - only
consumption. That is why every component produced the same shape of advice:
four components, five urgency levels, and one repair ("replace it"). A trouble
code is the first thing in this system that names an actual defect.

THE WIRE FORMAT IS MESSIER THAN THE SPEC SUGGESTS, and that is most of what
this module deals with. An ELM327 answering mode 03 can return any of:

    43 01 33 00 00 00 00          older protocols, zero-padded
    43 02 01 33 01 71             CAN, with a leading count byte
    009\r0: 43 02 01 33 01\r1: 71 00 00 00 00 00
                                  CAN multi-frame, line-prefixed
    NO DATA                       no codes stored
    SEARCHING...\r43 00           protocol negotiation echoed first

So parsing is deliberately tolerant: strip everything that is not payload,
find the mode response byte, and read pairs. Anything unrecognised yields an
empty list rather than an exception - a dongle that answers strangely must not
be able to crash a trip upload.

THE COUNT-BYTE PROBLEM. CAN replies carry a DTC count byte after the header;
older protocols do not. Getting this wrong shifts every byte boundary and
yields plausible-looking codes that are entirely fictional, with no error to
say so - so it is decided from two independent signals:

  1. Framing. A line-prefixed or length-headed reply is CAN, and CAN always
     sends the count.
  2. Arithmetic, for unframed replies. With a count byte the payload is
     1 + 2n bytes and therefore odd; without one it is 2n and even.

Signal 2 alone is not enough, which is what the multi-frame test caught: ISO-TP
pads the final frame back to an even length, so a framed reply that does carry
a count byte still looks even. Hence the framing check first.
"""
from __future__ import annotations

import re
from typing import List, Optional

# Mode request -> the byte that begins its positive response.
MODE_RESPONSE = {
    "03": 0x43,  # confirmed / stored
    "07": 0x47,  # pending - failed once, not yet confirmed
    "0A": 0x4A,  # permanent - survive a battery disconnect
}

# Top two bits of the first byte select the system.
_SYSTEM = {0b00: "P", 0b01: "C", 0b10: "B", 0b11: "U"}

# Answers that mean "nothing stored" or "I could not do that", never payload.
_NON_PAYLOAD = re.compile(
    r"NO\s*DATA|SEARCHING|UNABLE\s*TO\s*CONNECT|BUS\s*INIT|STOPPED|ERROR|\?",
    re.IGNORECASE,
)


_FRAME_PREFIX = re.compile(r"(?m)^[ \t]*[0-9A-Fa-f][ \t]*:")


def _clean(raw: str) -> tuple[str, bool]:
    """Reduce a raw ELM327 reply to bare hex, and say whether it was framed.

    Returns (hex, saw_multiframe). The second value matters because it is the
    only reliable evidence of which framing produced the reply, and framing
    decides whether a DTC count byte is present. See parse_dtc_response.

    Adapters separate lines with CR, not LF, so the line anchors have to be
    normalised first - without that the ``0:`` and ``1:`` frame numbers are
    never at a line start, survive into the payload, and shift every byte
    boundary after them.
    """
    text = raw.replace(">", " ").replace("\r", "\n")

    multiframe = bool(_FRAME_PREFIX.search(text))
    text = _FRAME_PREFIX.sub(" ", text)
    text = re.sub(r"\n+", " ", text)

    tokens: List[str] = []
    for token in text.split():
        if _NON_PAYLOAD.search(token):
            continue
        if re.fullmatch(r"[0-9A-Fa-f]+", token):
            tokens.append(token.upper())

    # A multi-frame reply is preceded by a total-length header such as "009".
    # It is odd-length, which is how it is told apart from a data byte, and it
    # is a second signal that this reply was framed.
    if tokens and len(tokens[0]) % 2 == 1:
        multiframe = True
        tokens = tokens[1:]

    joined = "".join(tokens)
    if len(joined) % 2 == 1:
        joined = joined[1:]
    return joined, multiframe


def decode_dtc(byte1: int, byte2: int) -> Optional[str]:
    """Two bytes into a code such as ``P0301``.

    Layout, most significant bit first:
        bits 15-14  system     P / C / B / U
        bits 13-12  first digit 0-3
        bits 11-0   three hex digits

    ``0000`` is padding, not a code, and is the single most common value on the
    wire - older protocols pad every reply out to a fixed length.
    """
    if byte1 == 0 and byte2 == 0:
        return None
    system = _SYSTEM[(byte1 >> 6) & 0b11]
    first = (byte1 >> 4) & 0b11
    return f"{system}{first}{byte1 & 0x0F:X}{byte2 >> 4:X}{byte2 & 0x0F:X}"


def parse_dtc_response(raw: str, mode: str = "03") -> List[str]:
    """Every code in one adapter reply, in order, without duplicates.

    Returns an empty list for "no codes", for an unreadable reply, and for a
    reply to a different mode. The CALLER must therefore never treat an empty
    list as proof the vehicle is fault-free - that is what the ``dtc_read_ok``
    flag on the trip exists to distinguish.
    """
    header = MODE_RESPONSE.get(mode.upper().strip())
    if header is None:
        return []

    hex_text, multiframe = _clean(raw)
    if len(hex_text) < 2:
        return []

    try:
        data = bytes.fromhex(hex_text)
    except ValueError:
        return []

    # Skip anything before the response header: some adapters echo the request,
    # and protocol negotiation can prepend bytes.
    try:
        start = data.index(header) + 1
    except ValueError:
        return []

    payload = data[start:]
    # Is the first byte a DTC count, or the first half of a code?
    #
    # Two signals, because neither alone is enough. A framed reply is always
    # CAN and CAN always sends the count. An unframed reply is ambiguous, so
    # fall back to arithmetic: with a count byte the payload is 1 + 2n and
    # therefore odd. That rule alone was wrong for framed replies, where
    # ISO-TP pads the final frame back to an even length and hides the tell.
    if multiframe or len(payload) % 2 == 1:
        payload = payload[1:]

    codes: List[str] = []
    for i in range(0, len(payload) - 1, 2):
        code = decode_dtc(payload[i], payload[i + 1])
        if code and code not in codes:
            codes.append(code)
    return codes


def parse_mil_status(raw: str) -> Optional[dict]:
    """Mode 01 PID 01: is the dashboard light on, and how many codes are stored.

    Cheaper than reading the codes themselves and answers the question the
    driver actually asks first. Byte A bit 7 is the lamp; the low seven bits
    are the stored-code count.
    """
    hex_text, _ = _clean(raw)
    try:
        data = bytes.fromhex(hex_text)
    except ValueError:
        return None

    # Response is 41 01 A B C D.
    for i in range(len(data) - 2):
        if data[i] == 0x41 and data[i + 1] == 0x01:
            a = data[i + 2]
            return {"mil_on": bool(a & 0x80), "dtc_count": a & 0x7F}
    return None
