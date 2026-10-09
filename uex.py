"""UEX Corp API 2.0 (https://uexcorp.space/api/documentation): commodity prices, trade routes and
fuel prices, crowdsourced by the Star Citizen community. Needs your own access token (Settings).

Everything is cached in uex_cache/ next to the app: the place lists for a day, prices and routes for
30 minutes (UEX itself refreshes routes hourly). Requests are spaced out to stay far under UEX's limit
of 120 a minute.

UEX has no coordinates, so each terminal is tied to a Quantum place by name (its station, city or
outpost). Terminals that don't match still show, just without "add to route".
"""
import difflib
import html
import json
import re
import threading
import time
import urllib.error
import urllib.parse
import urllib.request
from pathlib import Path

from services import _key

BASE = "https://api.uexcorp.uk/2.0/"
TTL = {"terminals": 86400, "outposts": 86400, "categories": 86400, "items": 86400, "items_prices_all": 3600, "space_stations": 86400, "vehicles": 86400, "vehicles_purchases_prices_all": 3600,
       "vehicles_rentals_prices_all": 3600, "commodities": 86400, "planets": 86400,
       "commodities_prices_all": 1800, "fuel_prices_all": 1800, "commodities_routes": 1800,
       "game_versions": 3600, "data_parameters": 3600}
SYSTEMS = ("Stanton", "Pyro", "Nyx")           # what Quantum maps


class UexError(Exception):
    pass


def _unescape(rows):
    """UEX sends some text HTML-escaped ("Grey&apos;s Market"): turn it back into plain text. Quantum's
    page escapes everything it shows itself, so plain text is what it needs."""
    for r in rows:
        if isinstance(r, dict):
            for k, v in r.items():
                if isinstance(v, str) and "&" in v and ";" in v:
                    r[k] = html.unescape(v)
    return rows


class Uex:
    def __init__(self, cache_dir, token=""):
        self.dir = Path(cache_dir)
        self.token = token or ""
        self._lock = threading.Lock()
        self._last = 0.0
        self._mem = {}
        self._places = None                     # id_terminal -> Quantum place name (or None)
        self.aliases = {}                       # UEX station name -> Quantum place it matched another way

    # ---------------------------------------------------------------- fetching
    def _file(self, resource, params):
        tag = resource + ("_" + "_".join(f"{k}-{v}" for k, v in sorted(params.items())) if params else "")
        return self.dir / f"{tag}.json"

    def get(self, resource, params=None, fresh=False, offline=False):
        """Rows of a UEX resource, from the cache while it's fresh. On a network error, stale cache
        beats nothing. offline: cache only, however old."""
        params = params or {}
        f = self._file(resource, params)
        ttl = TTL.get(resource, 1800)
        cached = self._mem.get(f)
        if cached is None and f.exists():
            try:
                cached = json.loads(f.read_text(encoding="utf-8"))
                _unescape(cached.get("rows") or [])         # caches saved before this was done
                self._mem[f] = cached
            except Exception:
                cached = None
        if cached and (offline or (not fresh and time.time() - cached["at"] < ttl)):
            return cached["rows"], cached["at"]
        if offline:
            raise UexError("Not downloaded yet")
        if not self.token:
            if cached:
                return cached["rows"], cached["at"]
            raise UexError("Add your UEX token in Settings to load trade data")
        try:
            rows = self._fetch(resource, params)
        except UexError:
            if cached:
                return cached["rows"], cached["at"]
            raise
        entry = {"at": time.time(), "rows": rows}
        self._mem[f] = entry
        self.dir.mkdir(exist_ok=True)
        f.write_text(json.dumps(entry), encoding="utf-8")
        if resource == "terminals":
            self._places = None
        return rows, entry["at"]

    def _fetch(self, resource, params, headers=None, timeout=40):
        """One GET. headers: extra ones, e.g. the datarunner's secret-key for their own reports."""
        with self._lock:
            wait = 0.6 - (time.time() - self._last)
            if wait > 0:
                time.sleep(wait)
            self._last = time.time()
        url = BASE + resource + "/" + ("?" + urllib.parse.urlencode(params) if params else "")
        req = urllib.request.Request(url, headers={"Authorization": f"Bearer {self.token}",
                                                   "Accept": "application/json", "User-Agent": "Quantum",
                                                   **(headers or {})})
        try:
            with urllib.request.urlopen(req, timeout=timeout) as r:
                body = json.loads(r.read().decode("utf-8"))
        except urllib.error.HTTPError as e:
            raise UexError("UEX rejected the token" if e.code in (401, 403) else f"UEX error {e.code}")
        except Exception:
            raise UexError("Couldn't reach UEX")
        if body.get("status") != "ok":
            raise UexError({"requests_limit_reached": "UEX request limit reached, try again in a minute"}
                           .get(body.get("status"), f"UEX: {body.get('message') or body.get('status')}"))
        data = body.get("data")
        return _unescape(data if isinstance(data, list) else [data] if data else [])

    def test(self, token):
        """Check a token without adopting it a wrong one never replaces the one that works."""
        saved, self.token = self.token, token
        try:
            self._fetch("star_systems", {})
        finally:
            self.token = saved
        return True

    # ---------------------------------------------------------------- places
    def terminals(self, offline=False):
        rows, _ = self.get("terminals", offline=offline)
        return {t["id"]: t for t in rows if t.get("star_system_name") in SYSTEMS and t.get("is_visible", 1)}

    def place_map(self, locations, offline=False):
        """id_terminal -> Quantum place name, matched on the terminal's station, city or outpost name."""
        if self._places is not None:
            return self._places
        terms = self.terminals(offline=offline)
        index = {}
        for name, loc in locations.items():
            if loc.source != "db" or loc.category in ("lpoint", "om"):
                continue
            index.setdefault((_key(name), loc.system), name)
        for alias, name in self.aliases.items():
            loc = locations.get(name)
            if loc:
                index.setdefault((_key(alias), loc.system), name)
        out = {}
        for tid, t in terms.items():
            sys_ = t.get("star_system_name")
            found = None
            for cand in (t.get("space_station_name"), t.get("city_name"), t.get("outpost_name"),
                         t.get("displayname"), t.get("nickname")):
                k = _key(cand) if cand else ""
                hit = index.get((k, sys_)) or index.get((k + "station", sys_)) if k else None
                if hit:
                    found = hit
                    break
            out[tid] = found or _similar(t, locations)
        self._places = out
        return out

    def forget_places(self):
        self._places = None

    def status(self, locations):
        try:
            places = self.place_map(locations)
        except UexError as e:
            return {"ok": False, "error": str(e)}
        terms = self.terminals()
        missing, retired = {}, 0
        for i, p in places.items():
            if p:
                continue
            # UEX keeps some terminals that aren't in the live game (retired, unreleased): not counted
            if not is_live(terms[i]):
                retired += 1
                continue
            n = place_name(terms[i]) or "?"
            missing[n] = missing.get(n, 0) + 1
        return {"ok": True, "terminals": len(places) - retired, "matched": sum(1 for p in places.values() if p),
                "unmatched": sorted(missing)[:80], "unmatched_terms": missing}


REASON_FIELDS = ("decline_reason", "declined_reason", "reason", "status_reason", "review_comment",
                 "moderator_comment", "comment", "comments")


def decline_reason(row):
    """Why UEX declined a report, when its /data_info row says (UEX doesn't always give one)."""
    for k in REASON_FIELDS:
        v = row.get(k)
        if isinstance(v, str) and v.strip():
            return v.strip()[:300]
    return None


def is_live(t):
    """Is this terminal in the live game, as far as UEX knows?"""
    return bool(t.get("is_available_live", 1)) and bool(t.get("is_visible", 1)) and not t.get("is_decommissioned")


def place_name(t):
    """The place a terminal is at, by the name Quantum uses for it everywhere (the map's "not placed
    yet" list, the Jobs, Settings): station, else outpost, else city, else its own name."""
    return (t.get("space_station_name") or t.get("outpost_name") or t.get("city_name") or t.get("displayname")
            or t.get("name") or "").strip()


def where(t):
    """Short human location of a terminal 'Area 18, ArcCorp' / 'Port Tressler, microTech'."""
    spot = t.get("space_station_name") or t.get("city_name") or t.get("outpost_name") or t.get("displayname")
    body = t.get("moon_name") or t.get("planet_name")
    return f"{spot}, {body}" if spot and body and body not in spot else spot or t.get("name") or "?"


# ---------------------------------------------------------------- stations Quantum's data lacks
# UEX lists every station with the Lagrange point or planet it sits at. Quantum's community data has
# the L-points' positions but misses many stations (most of Pyro's), so those are added at their
# L-point (approximate: stations sit near it), and placeholder names are swapped for the real ones.
LP_PREFIX = {"hurston": "HUR", "crusader": "CRU", "arccorp": "ARC", "microtech": "MIC"}
PYRO_NUM = {"pyro i": 1, "pyro 1": 1, "pyro1": 1, "monox": 2, "pyro ii": 2, "bloom": 3, "pyro iii": 3,
            "pyro iv": 4, "pyro4": 4, "pyro v": 5, "pyro5": 5, "terminus": 6, "pyro vi": 6}
FLAG_AMENITIES = [("has_trade_terminal", "Commodity Trading"), ("has_freight_elevator", "Freight Elevator"),
                  ("has_refuel", "Refuel"), ("has_repair", "Repair"), ("has_refinery", "Refinery"),
                  ("has_clinic", "Clinic"), ("has_shops", "Shops"), ("has_food", "Food"),
                  ("has_habitation", "Habitation"), ("has_cargo_center", "Cargo Center")]


def lpoint_name(st):
    """Quantum's name for the L-point a UEX station sits at ('ARC-L1', 'P2-L4'), else None."""
    m = re.match(r"(.+?)\s+lagrange\s+point\s+(\d)", (st.get("orbit_name") or "").lower())
    if m:
        body, n = m.group(1).strip(), m.group(2)
        if body in LP_PREFIX:
            return f"{LP_PREFIX[body]}-L{n}"
        if body in PYRO_NUM:
            return f"P{PYRO_NUM[body]}-L{n}"
    m = re.search(r"\b(HUR|CRU|ARC|MIC)-L(\d)\b", st.get("nickname") or "", re.I)
    if m:
        return f"{m.group(1).upper()}-L{m.group(2)}"
    m = re.search(r"\bP(?:YR)?(\d)-L(\d)\b", st.get("nickname") or "", re.I)
    return f"P{m.group(1)}-L{m.group(2)}" if m else None


def amenities(st):
    out = [label for flag, label in FLAG_AMENITIES if st.get(flag)]
    pads = [p.strip().upper() for p in (st.get("pad_types") or "").replace(";", ",").split(",") if p.strip()]
    size = next((s for s in ("XL", "L", "M", "S", "XS") if s in pads), None)
    if size:
        out.insert(0, f"Landing Pad {size}")
    return out


def _similar(t, locations):
    """Second chance for a terminal whose name doesn't match exactly: the same place under a slightly
    different name ("Samson & Son's Salvage Center" / "...Salvage Yard", "Deakins Research" /
    "Deakins Research Outpost"). Same system, same planet or moon when both are known."""
    names = [n for n in (t.get("space_station_name"), t.get("city_name"), t.get("outpost_name"),
                         t.get("displayname")) if n]
    if not names:
        return None
    sys_ = t.get("star_system_name")
    bodies = {_key(b) for b in (t.get("moon_name"), t.get("planet_name")) if b}
    best = (0.0, None)
    for name, loc in locations.items():
        if loc.system != sys_ or loc.source != "db" or loc.category in ("lpoint", "om", "cave", "wreck"):
            continue
        if bodies and loc.body and _key(loc.body) not in bodies:
            continue
        lk = _key(name)
        for cand in names:
            ck = _key(cand)
            if len(ck) < 8:
                continue
            score = 0.95 if (lk.startswith(ck) or ck.startswith(lk)) and min(len(lk), len(ck)) >= 10 else \
                difflib.SequenceMatcher(None, ck, lk).ratio()
            if score > best[0]:
                best = (score, name)
    return best[1] if best[0] >= 0.84 else None


ROMAN_NUM = {"I": 1, "II": 2, "III": 3, "IV": 4, "V": 5, "VI": 6, "VII": 7, "VIII": 8}


def body_name(name, bodies):
    """UEX's planet/moon name -> Quantum's body name ('Pyro I' -> 'Pyro1'), or None if Quantum lacks it."""
    if not name:
        return None
    if name in bodies:
        return name
    m = re.fullmatch(r"(\w+)\s+([IVX]+)", name.strip())
    if m and m.group(2) in ROMAN_NUM and f"{m.group(1)}{ROMAN_NUM[m.group(2)]}" in bodies:
        return f"{m.group(1)}{ROMAN_NUM[m.group(2)]}"
    low = {b.lower(): b for b in bodies}
    return low.get(name.lower())
