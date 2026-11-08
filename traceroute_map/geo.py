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

    def _reserve_slot(self) -> float:
        """Reserve the next free request slot and return how long to wait for it.

        Must be called with the lock held; the caller sleeps *after* releasing
        the lock so cache hits from other threads are never blocked.
        """
        now = self._clock()
        while self._sent and now - self._sent[0] >= WINDOW_SECONDS:
            self._sent.popleft()
        start = now
        if len(self._sent) >= self._max:
            start = self._sent.popleft() + WINDOW_SECONDS
        self._sent.append(start)
        return start - now

    def lookup(self, ip: str) -> Geo | None:
        """Location for `ip`, or None if unknown or the service is unavailable."""
        with self._lock:
            cached = self._cache.get(ip, _MISSING)
            if cached is not _MISSING:
                return cached
            wait = self._reserve_slot()
        if wait > 0:
            self._sleep(wait)
        try:
            resp = self._http_get(API_URL.format(ip=ip), timeout=5)
            if resp.status_code != 200:
                return None
            data = resp.json()
        except (requests.RequestException, ValueError):
            return None
        try:
            if data.get("status") != "success":
                geo = None
            else:
                geo = Geo(
                    lat=float(data["lat"]), lon=float(data["lon"]), city=data.get("city") or None,
                    country=data.get("country") or None, country_code=data.get("countryCode") or None,
                    asn=data.get("as") or None, isp=data.get("isp") or None,
                )
        except (KeyError, TypeError, ValueError, AttributeError):
            return None
        with self._lock:
            self._cache[ip] = geo
        return geo
