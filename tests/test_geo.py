import requests

from traceroute_map.geo import GeoLookup
from traceroute_map.models import Geo

OK = {"status": "success", "lat": 50.1, "lon": 8.7, "city": "Frankfurt am Main", "country": "Germany",
      "countryCode": "DE", "as": "AS3320 Deutsche Telekom AG", "isp": "Deutsche Telekom AG"}


class Resp:
    def __init__(self, data, status_code=200):
        self._data = data
        self.status_code = status_code

    def json(self):
        return self._data


class FakeHttp:
    """Returns the queued responses in order; an Exception in the queue is raised."""

    def __init__(self, *responses):
        self.responses = list(responses)
        self.urls = []

    def __call__(self, url, timeout=None):
        self.urls.append(url)
        r = self.responses.pop(0) if len(self.responses) > 1 else self.responses[0]
        if isinstance(r, Exception):
            raise r
        return r


def test_maps_fields():
    http = FakeHttp(Resp(OK))
    geo = GeoLookup(http_get=http)
    assert geo.lookup("62.155.243.86") == Geo(50.1, 8.7, "Frankfurt am Main", "Germany", "DE",
                                              "AS3320 Deutsche Telekom AG", "Deutsche Telekom AG")
    assert http.urls[0].startswith("http://ip-api.com/json/62.155.243.86?fields=")


def test_cache_hits_http_once():
    http = FakeHttp(Resp(OK))
    geo = GeoLookup(http_get=http)
    geo.lookup("62.155.243.86")
    geo.lookup("62.155.243.86")
    assert len(http.urls) == 1


def test_fail_status_returns_none_and_is_cached():
    http = FakeHttp(Resp({"status": "fail", "message": "reserved range"}))
    geo = GeoLookup(http_get=http)
    assert geo.lookup("10.0.0.1") is None
    assert geo.lookup("10.0.0.1") is None
    assert len(http.urls) == 1


def test_network_error_returns_none_and_is_not_cached():
    http = FakeHttp(requests.ConnectionError("offline"), Resp(OK))
    geo = GeoLookup(http_get=http)
    assert geo.lookup("62.155.243.86") is None
    assert geo.lookup("62.155.243.86") is not None


def test_http_429_returns_none():
    geo = GeoLookup(http_get=FakeHttp(Resp({}, status_code=429)))
    assert geo.lookup("62.155.243.86") is None


def test_rate_limit_sleeps():
    slept = []
    geo = GeoLookup(http_get=FakeHttp(Resp(OK)), clock=lambda: 0.0, sleep=slept.append, max_per_minute=2)
    for ip in ["1.1.1.1", "8.8.8.8", "9.9.9.9"]:
        geo.lookup(ip)
    assert slept == [60.0]
