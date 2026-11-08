import pytest

from traceroute_map.models import Geo, RawHop
from traceroute_map.resolve import resolve_target
from traceroute_map.service import trace_events
from traceroute_map.tracer import InvalidTarget

HOPS = [
    RawHop(1, "192.168.178.1", [1.0, 1.0, 1.0]),
    RawHop(2, "100.64.0.1", [8.0, 7.0, 9.0]),
    RawHop(3, None, [None, None, None]),
    RawHop(4, "62.155.243.86", [None, 15.0, 14.0]),
    RawHop(5, "142.250.185.78", [16.0, 15.0, 17.0]),
]
GEO = Geo(50.1, 8.7, "Frankfurt am Main", "Germany", "DE", "AS3320", "DTAG")


class FakeTracer:
    def __init__(self, hops=HOPS):
        self.hops = hops
        self.called = False
        self.closed = False

    def __call__(self, ip):
        self.called = True
        try:
            yield from self.hops
        finally:
            self.closed = True


def run(target="google.com", tracer=None, geo=lambda ip: GEO, resolve=lambda t: "142.250.185.78"):
    return trace_events(target, resolve=resolve, tracer=tracer or FakeTracer(), geo_lookup=geo, rdns=lambda ip: "host")


def test_happy_path_event_sequence():
    events = list(run())
    assert [e["type"] for e in events] == ["start", "hop", "hop", "hop", "hop", "hop", "done"]
    assert events[0] == {"type": "start", "target": "google.com", "ip": "142.250.185.78"}
    assert events[-1]["reached"] is True
    assert events[1]["hop"]["kind"] == "private" and events[1]["hop"]["geo"] is None
    assert events[3]["hop"]["kind"] == "timeout" and events[3]["hop"]["hostname"] is None
    assert events[4]["hop"]["geo"]["city"] == "Frankfurt am Main"
    assert events[4]["hop"]["avg_rtt"] == 14.5


def test_geo_none_still_emits_hop():
    events = list(run(geo=lambda ip: None))
    assert events[5]["type"] == "hop" and events[5]["hop"]["geo"] is None


def test_not_reached():
    events = list(run(tracer=FakeTracer(HOPS[:4])))
    assert events[-1] == {"type": "done", "target": "google.com", "reached": False}


def test_invalid_target_yields_single_error():
    events = list(run(target="-h"))
    assert len(events) == 1 and events[0]["type"] == "error"


def test_unresolvable_yields_error():
    def bad_resolve(t):
        raise InvalidTarget("Could not resolve nope.invalid")
    tracer = FakeTracer()
    events = list(run(target="nope.invalid", tracer=tracer, resolve=bad_resolve))
    assert events == [{"type": "error", "target": "nope.invalid", "message": "Could not resolve nope.invalid"}]
    assert tracer.called is False


def test_missing_traceroute_command_yields_error():
    def missing(ip):
        raise FileNotFoundError("tracert")
        yield
    events = list(run(tracer=missing))
    assert events[-1] == {"type": "error", "target": "google.com", "message": "traceroute command not found on this system"}


def test_close_propagates_to_tracer():
    tracer = FakeTracer()
    gen = run(tracer=tracer)
    next(gen)
    next(gen)
    gen.close()
    assert tracer.closed is True


def test_resolve_ipv4_literal():
    assert resolve_target("8.8.8.8") == "8.8.8.8"


def test_resolve_ipv6_rejected():
    with pytest.raises(InvalidTarget):
        resolve_target("2001:4860:4860::8888")
