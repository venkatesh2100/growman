"""Where a request came from, for merchant alerts only.

ipwho.is is the same lookup the Go service uses. A hosting, proxy, VPN, or
Tor address is treated as a datacenter and is not worth a "someone is
browsing" ping. The lookup is best-effort: a timeout does not fail the
request that triggered it.
"""

from __future__ import annotations

import logging
from dataclasses import dataclass

import httpx

log = logging.getLogger("growman.visitor")


@dataclass
class Place:
    city: str = ""
    region: str = ""
    country: str = ""
    hosting: bool = False
    proxy: bool = False
    vpn: bool = False
    tor: bool = False

    @property
    def datacenter(self) -> bool:
        return self.hosting or self.proxy or self.vpn or self.tor

    def label(self) -> str:
        return ", ".join(part for part in (self.city, self.region, self.country) if part) or "unknown"


def lookup(ip: str) -> Place | None:
    if not ip or ip in {"127.0.0.1", "::1"}:
        return Place(city="localhost")
    try:
        response = httpx.get(f"https://ipwho.is/{ip}", headers={"User-Agent": "Growman/1.0", "Accept": "application/json"}, timeout=3)
        response.raise_for_status()
        body = response.json()
    except Exception as exc:  # noqa: BLE001
        log.info("place lookup failed: %s", exc)
        return None
    if not body.get("success"):
        return None
    security = body.get("security") or {}
    return Place(
        city=body.get("city") or "",
        region=body.get("region") or "",
        country=body.get("country") or "",
        hosting=bool(security.get("hosting")),
        proxy=bool(security.get("proxy")),
        vpn=bool(security.get("vpn")),
        tor=bool(security.get("tor")),
    )
