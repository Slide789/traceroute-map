"""Validate targets and run the operating system's traceroute command."""

from __future__ import annotations

import ipaddress
import platform
import re
import subprocess
from collections.abc import Iterator

from .models import RawHop
from .parser import parse_line

MAX_HOPS = 30

_HOSTNAME = re.compile(
    r"^(?=.{1,253}$)[A-Za-z0-9](?:[A-Za-z0-9-]{0,61}[A-Za-z0-9])?"
    r"(?:\.[A-Za-z0-9](?:[A-Za-z0-9-]{0,61}[A-Za-z0-9])?)*$"
)


class InvalidTarget(ValueError):
    """The target is not a hostname or IP address we are willing to trace."""


def validate_target(target: str) -> str:
    """Return the cleaned target, or raise InvalidTarget.

    Only plain hostnames and IP literals pass, so nothing the user types can be
    read as a command-line option by tracert/traceroute.
    """
    cleaned = target.strip()
    try:
        ipaddress.ip_address(cleaned)
        return cleaned
    except ValueError:
        pass
    if not _HOSTNAME.match(cleaned):
        raise InvalidTarget(f"'{cleaned}' is not a valid hostname or IP address")
    return cleaned


def build_command(ip: str, system: str) -> list[str]:
    """Command line for tracing to `ip` on the given platform.system() value."""
    if system == "Windows":
        return ["tracert", "-4", "-d", "-h", str(MAX_HOPS), "-w", "1000", ip]
    return ["traceroute", "-n", "-m", str(MAX_HOPS), "-w", "1", ip]


def run_trace(ip: str, system: str | None = None, popen=subprocess.Popen) -> Iterator[RawHop]:
    """Run the trace and yield hops as soon as each line is printed.

    Closing the generator (e.g. because the browser went away) kills the process.
    """
    system = system or platform.system()
    proc = popen(
        build_command(ip, system),
        stdout=subprocess.PIPE,
        stderr=subprocess.STDOUT,
        text=True,
        encoding="oem" if system == "Windows" else "utf-8",
        errors="replace",
    )
    try:
        for line in proc.stdout:
            hop = parse_line(line)
            if hop is not None:
                yield hop
    finally:
        if proc.poll() is None:
            proc.kill()
        proc.wait()
