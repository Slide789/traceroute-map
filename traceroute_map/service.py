"""Run one trace and describe it as a stream of JSON-ready events."""

from __future__ import annotations

from collections.abc import Callable, Iterator
from concurrent.futures import ThreadPoolExecutor

from .classify import classify
from .models import Geo, Hop, average_rtt
from .resolve import resolve_target, reverse_dns
from .tracer import InvalidTarget, run_trace, validate_target

# Reverse DNS runs here while the GeoIP request runs on the trace's own thread.
_rdns_pool = ThreadPoolExecutor(max_workers=16, thread_name_prefix="hop-rdns")


def trace_events(
    target: str,
    *,
    resolve: Callable[[str], str] = resolve_target,
    tracer: Callable[[str], Iterator] = run_trace,
    geo_lookup: Callable[[str], Geo | None] | None = None,
    rdns: Callable[[str], str | None] = reverse_dns,
) -> Iterator[dict]:
    """Yield start, hop..., done events (or a single error event).

    `geo_lookup` is a callable ip -> Geo | None; with None, no locations are looked up.
    """
    try:
        target = validate_target(target)
        ip = resolve(target)
    except InvalidTarget as exc:
        yield {"type": "error", "target": target.strip(), "message": str(exc)}
        return

    yield {"type": "start", "target": target, "ip": ip}
    reached = False
    hops = tracer(ip)
    try:
        for raw in hops:
            kind = classify(raw.ip)
            pending_name = _rdns_pool.submit(rdns, raw.ip) if kind != "timeout" else None
            geo = geo_lookup(raw.ip) if (kind == "public" and geo_lookup) else None
            hostname = pending_name.result() if pending_name else None
            hop = Hop(raw.index, raw.ip, raw.rtts, kind, average_rtt(raw.rtts), hostname, geo)
            reached = reached or raw.ip == ip
            yield {"type": "hop", "target": target, "hop": hop.to_dict()}
    except FileNotFoundError:
        yield {"type": "error", "target": target, "message": "traceroute command not found on this system"}
        return
    finally:
        close = getattr(hops, "close", None)
        if close:
            close()
    yield {"type": "done", "target": target, "reached": reached}
