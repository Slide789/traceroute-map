import pytest

from traceroute_map.classify import classify
from traceroute_map.models import Hop, average_rtt


@pytest.mark.parametrize("ip,expected", [
    (None, "timeout"),
    ("192.168.178.1", "private"), ("10.0.0.1", "private"), ("172.16.5.4", "private"),
    ("100.64.0.1", "private"),  # CGNAT
    ("127.0.0.1", "private"), ("169.254.1.1", "private"),
    ("8.8.8.8", "public"), ("142.250.185.78", "public"),
    ("2001:4860:4860::8888", "public"), ("fe80::1", "private"),
])
def test_classify(ip, expected):
    assert classify(ip) == expected


def test_average_rtt():
    assert average_rtt([1.0, 2.0, None]) == 1.5
    assert average_rtt([None, None, None]) is None


def test_hop_to_dict_without_geo():
    h = Hop(index=1, ip=None, rtts=[None, None, None], kind="timeout", avg_rtt=None, hostname=None, geo=None)
    assert h.to_dict()["geo"] is None
    assert h.to_dict()["index"] == 1
