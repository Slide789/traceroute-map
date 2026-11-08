"""Name resolution: target -> IPv4 address, and IP -> hostname."""

from __future__ import annotations

import ipaddress
import socket
from concurrent.futures import ThreadPoolExecutor
from concurrent.futures import TimeoutError as FutureTimeout

from .tracer import InvalidTarget

_pool = ThreadPoolExecutor(max_workers=8, thread_name_prefix="rdns")


def resolve_target(target: str) -> str:
    """IPv4 address to trace to. v1 only supports IPv4."""
    try:
        addr = ipaddress.ip_address(target)
    except ValueError:
        addr = None
    if addr is not None:
        if addr.version == 6:
            raise InvalidTarget("IPv6 targets are not supported yet")
        return str(addr)
    try:
        infos = socket.getaddrinfo(target, None, family=socket.AF_INET)
    except (socket.gaierror, UnicodeError):
        raise InvalidTarget(f"Could not resolve {target}") from None
    return infos[0][4][0]


def reverse_dns(ip: str, timeout: float = 2.0) -> str | None:
    """Hostname for `ip`, or None if there is none or it takes too long."""
    future = _pool.submit(socket.gethostbyaddr, ip)
    try:
        return future.result(timeout=timeout)[0]
    except (FutureTimeout, OSError):
        return None
