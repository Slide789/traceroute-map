"""Classify hop addresses for display."""

from __future__ import annotations

import ipaddress
from typing import Literal

Kind = Literal["timeout", "private", "public"]


def classify(ip: str | None) -> Kind:
    """Return "timeout" for unanswered hops, "public" for globally routable
    addresses and "private" for everything else (RFC 1918, CGNAT, loopback, ...)."""
    if ip is None:
        return "timeout"
    return "public" if ipaddress.ip_address(ip).is_global else "private"
