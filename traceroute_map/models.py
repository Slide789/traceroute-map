"""Data structures shared across the package."""

from __future__ import annotations

from dataclasses import asdict, dataclass


@dataclass
class RawHop:
    """One parsed line of traceroute output, before enrichment."""

    index: int
    ip: str | None
    rtts: list[float | None]


@dataclass
class Geo:
    """Approximate location and network owner of an IP address."""

    lat: float
    lon: float
    city: str | None
    country: str | None
    country_code: str | None
    asn: str | None
    isp: str | None


@dataclass
class Hop:
    """A fully enriched hop, ready to be sent to the browser."""

    index: int
    ip: str | None
    rtts: list[float | None]
    kind: str
    avg_rtt: float | None
    hostname: str | None
    geo: Geo | None

    def to_dict(self) -> dict:
        return asdict(self)


def average_rtt(rtts: list[float | None]) -> float | None:
    """Mean of the probes that answered, rounded to 0.1 ms."""
    values = [r for r in rtts if r is not None]
    if not values:
        return None
    return round(sum(values) / len(values), 1)
