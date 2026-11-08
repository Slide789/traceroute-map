"""Approximate location and AS lookup via the free ip-api.com service.

Free tier terms: non-commercial use only, HTTP only, at most 45 requests per
minute per client IP. Results are cached for the lifetime of the process.
"""

from __future__ import annotations

import threading
import time
from collections import deque

import requests

from .models import Geo

API_URL = "http://ip-api.com/json/{ip}?fields=status,message,lat,lon,city,country,countryCode,as,isp"
WINDOW_SECONDS = 60.0
_MISSING = object()


class GeoLookup:
    def __init__(self, http_get=requests.get, clock=time.monotonic, sleep=time.sleep, max_per_minute: int = 45):
        self._http_get = http_get
        self._clock = clock
        self._sleep = sleep
        self._max = max_per_minute
        self._cache: dict[str, Geo | None] = {}
        self._sent: deque[float] = deque()
        self._lock = threading.Lock()

    def _wait_for_slot(self) -> None:
        """Sliding-window rate limit. Must be called with the lock held."""
        now = self._clock()
        while self._sent and now - self._sent[0] >= WINDOW_SECONDS:
            self._sent.popleft()
        if len(self._sent) >= self._max:
            self._sleep(WINDOW_SECONDS - (now - self._sent[0]))
            self._sent.popleft()
        self._sent.append(self._clock())

    def lookup(self, ip: str) -> Geo | None:
        """Location for `ip`, or None if unknown or the service is unavailable."""
        with self._lock:
            cached = self._cache.get(ip, _MISSING)
            if cached is not _MISSING:
                return cached
            self._wait_for_slot()
        try:
            resp = self._http_get(API_URL.format(ip=ip), timeout=5)
            if resp.status_code != 200:
                return None
            data = resp.json()
        except (requests.RequestException, ValueError):
            return None
        if data.get("status") != "success":
            geo = None
        else:
            geo = Geo(
                lat=data["lat"], lon=data["lon"], city=data.get("city") or None,
                country=data.get("country") or None, country_code=data.get("countryCode") or None,
                asn=data.get("as") or None, isp=data.get("isp") or None,
            )
        with self._lock:
            self._cache[ip] = geo
        return geo
