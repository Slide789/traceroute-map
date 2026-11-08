"""Parse lines of `tracert` (Windows) and `traceroute` (Linux/macOS) output.

The parser only looks at numbers, `*` and IP addresses, never at words, so it
works no matter which language the operating system prints its messages in.
"""

from __future__ import annotations

import ipaddress
import re

from .models import RawHop

_HOP_START = re.compile(r"^\s*(\d{1,3})\s+(.*)$")
_TOKEN = re.compile(r"(<?\d+(?:\.\d+)?)\s*ms\b|(\*)|(\S+)")
PROBES = 3


def _as_ip(token: str) -> str | None:
    try:
        return str(ipaddress.ip_address(token.strip("[]()")))
    except ValueError:
        return None


def parse_line(line: str) -> RawHop | None:
    """Turn one output line into a RawHop, or return None if it is not a hop line."""
    match = _HOP_START.match(line)
    if not match:
        return None
    index = int(match.group(1))
    rtts: list[float | None] = []
    ip: str | None = None
    for rtt, star, other in _TOKEN.findall(match.group(2)):
        if rtt:
            rtts.append(float(rtt.lstrip("<")))
        elif star:
            rtts.append(None)
        elif ip is None:
            ip = _as_ip(other)
    if not rtts:
        return None
    rtts = (rtts + [None] * PROBES)[:PROBES]
    return RawHop(index, ip, rtts)
