from pathlib import Path

import pytest

from traceroute_map.models import RawHop
from traceroute_map.parser import parse_line

FIXTURES = Path(__file__).parent / "fixtures"


def hops(name):
    text = (FIXTURES / name).read_text(encoding="utf-8")
    return [h for h in map(parse_line, text.splitlines()) if h]


def test_tracert_de():
    hs = hops("tracert_de.txt")
    assert [h.index for h in hs] == [1, 2, 3, 4, 5]
    assert hs[0] == RawHop(1, "192.168.178.1", [1.0, 1.0, 1.0])  # "<1 ms" -> 1.0
    assert hs[2] == RawHop(3, None, [None, None, None])
    assert hs[3] == RawHop(4, "62.155.243.86", [None, 15.0, 14.0])


def test_tracert_en_equals_de():
    assert hops("tracert_en.txt") == hops("tracert_de.txt")


def test_linux():
    hs = hops("traceroute_linux.txt")
    assert hs[0] == RawHop(1, "192.168.178.1", [0.512, 0.48, 0.466])
    assert hs[1] == RawHop(2, None, [None, None, None])
    assert hs[2] == RawHop(3, "62.155.243.86", [14.203, None, 13.95])


def test_ipv6_in_brackets():
    assert parse_line("  1     5 ms     4 ms     4 ms  [2001:db8::1]") == RawHop(1, "2001:db8::1", [5.0, 4.0, 4.0])


@pytest.mark.parametrize("line", [
    "",
    "Ablaufverfolgung beendet.",
    "Routenverfolgung zu x über maximal 30 Hops",
    "  garbage ä ö ü �",
    "traceroute to 142.250.185.78 (142.250.185.78), 30 hops max, 60 byte packets",
])
def test_non_hop_lines(line):
    assert parse_line(line) is None


def test_error_line_with_ip_but_no_rtts_is_kept():
    assert parse_line("  4  62.1.1.1  meldet: Zielnetz nicht erreichbar.") == RawHop(4, "62.1.1.1", [None, None, None])
    assert parse_line("  4  62.1.1.1  reports: Destination net unreachable.") == RawHop(4, "62.1.1.1", [None, None, None])
