"""Core navigation logic for Stanton Nav. Pure Python, no UI.

Coordinate frames
-----------------
- Global: system-centered cartesian meters (what /showlocation gives). Each star
  system has its own origin, so every position also carries a system name.
- Local:  body-centered meters that rotate with a planet or moon. Surface places,
  and mission markers from Game.log, are in this frame.

Planet rotation: angle = offset + 360 * hours_since_2020-01-01 / day_length.
The offsets are calibrated by the community per patch and drift; NavDB.calibrate()
fixes a body's offset from one /showlocation taken at a known place.
"""
from __future__ import annotations

import json
import math
import re
import time
from dataclasses import asdict, dataclass, field, fields
from pathlib import Path

Vec = tuple[float, float, float]

_NUM = r"(-?\d+(?:\.\d+)?(?:[eE][-+]?\d+)?)"
COORD_RE = re.compile(rf"x\s*:\s*{_NUM}\s*,?\s*y\s*:\s*{_NUM}\s*,?\s*z\s*:\s*{_NUM}", re.I)

PAD_SIZES = ["unknown", "none", "vehicle", "small", "medium", "large", "xl", "hangar"]
SYSTEMS = ["Stanton", "Pyro", "Nyx"]


# ---------------------------------------------------------------- parsing ---
def parse_showlocation(text: str | None) -> Vec | None:
    """Pull x/y/z out of /showlocation clipboard text. Tolerant of formatting."""
    if not text:
        return None
    m = COORD_RE.search(text)
    return (float(m.group(1)), float(m.group(2)), float(m.group(3))) if m else None


# ----------------------------------------------------------- vector utils ---
def sub(a: Vec, b: Vec) -> Vec:
    return (a[0] - b[0], a[1] - b[1], a[2] - b[2])


def add(a: Vec, b: Vec) -> Vec:
    return (a[0] + b[0], a[1] + b[1], a[2] + b[2])


def norm(a: Vec) -> float:
    return math.sqrt(a[0] ** 2 + a[1] ** 2 + a[2] ** 2)


def dist(a: Vec, b: Vec) -> float:
    return norm(sub(a, b))


def rot_z(v: Vec, angle_rad: float) -> Vec:
    c, s = math.cos(angle_rad), math.sin(angle_rad)
    return (v[0] * c - v[1] * s, v[0] * s + v[1] * c, v[2])


def fmt_distance(m: float) -> str:
    a = abs(m)
    if a < 1_000:
        return f"{m:,.0f} m"
    if a < 1_000_000:
        return f"{m / 1_000:,.1f} km"
    if a < 1_000_000_000:
        return f"{m / 1_000_000:,.2f} Mm"
    return f"{m / 1_000_000_000:,.3f} Gm"


def great_circle(lat1, lon1, lat2, lon2, radius) -> tuple[float, float]:
    """(distance_m, initial_heading_deg) along a sphere. 0 deg = north (+z pole)."""
    p1, p2 = math.radians(lat1), math.radians(lat2)
    dl = math.radians(lon2 - lon1)
    h = math.sin((p2 - p1) / 2) ** 2 + math.cos(p1) * math.cos(p2) * math.sin(dl / 2) ** 2
    d = 2 * radius * math.asin(math.sqrt(min(1.0, h)))
    y = math.sin(dl) * math.cos(p2)
    x = math.cos(p1) * math.sin(p2) - math.sin(p1) * math.cos(p2) * math.cos(dl)
    return d, (math.degrees(math.atan2(y, x)) + 360) % 360


# ------------------------------------------------------------ categories ---
CITIES = {"lorville", "area 18", "area18", "new babbage", "orison", "grimhex", "grim hex"}

# The game data lists Delamar as a planet, but it's a moon-sized asteroid in Nyx's Glaciem Ring.
BODY_KIND = {"Delamar": "asteroid", "Pyro4": "planet"}
# Body centers the community data has wrong. Pyro IV and Fuego lost their Y coordinate (they came out
# ~40 Gm from Pyro V, which Fuego orbits). These are the game-file positions (Star Citizen Wiki
# starmap data) turned into the in-game frame: that data's Pyro is rotated 85.23 deg from the game's,
# checked against a /showlocation at Stanton Gateway and against Pyro I, Monox, Bloom and Pyro V.
BODY_CENTER = {"Pyro4": (-3704137009.2, -43071659047.6, 0.0), "Fuego": (-3780111838.0, -42827195804.3, 0.0)}
# Planets with no surface you can reach in the game yet (all three of Nyx's). With nowhere to land,
# there's no /showlocation to line them up from, so they get no alignment.
NO_LANDING = {"Nyx I", "Nyx II", "Nyx III"}
# Places the data files as cities that are really stations (Levski is built into Delamar).
STATION_NAMES = {"levski"}


def can_align(body) -> bool:
    """A planet or moon you can land on, so a /showlocation there can line up its rotation."""
    return body is not None and body.kind in ("planet", "moon") and body.name not in NO_LANDING


def normalize(db) -> bool:
    """Fix what the community and game data get wrong about Nyx (see BODY_KIND, NO_LANDING,
    STATION_NAMES). Safe to run any number of times; True if anything changed."""
    changed = False
    for b in db.bodies.values():
        kind = BODY_KIND.get(b.name)
        if kind and b.kind != kind:
            b.kind, changed = kind, True
        center = BODY_CENTER.get(b.name)
        if center and dist(tuple(b.center), center) > 1_000_000:
            b.center, changed = center, True
        if not can_align(b) and b.kind != "star" and (b.calibrated or b.calibration_quality):
            if b.community_offset_deg is not None:
                b.rotation_offset_deg = b.community_offset_deg
            b.calibrated, b.calibrated_at, b.calibrated_place, b.calibration_quality = False, 0.0, "", ""
            changed = True
    for loc in db.locations.values():
        if loc.name.split(" (")[0].lower() in STATION_NAMES and loc.category != "station":
            loc.category, changed = "station", True
    return changed
CATEGORY_MAP = {  # community poi_type -> map category
    "Cave": "cave", "Wreck": "wreck", "LandingZone": "city", "Spaceport": "city",
    "OrbitalStation": "station", "CommArray": "comm", "AsteroidBelt": "field", "JumpPoint": "jump",
    **{k: "outpost" for k in ("DerelictOutpost", "Outpost", "ColonialOutpost", "ColonialBunker",
                              "UndergroundFacility", "ForwardOperatingBase", "DistributionCenter",
                              "Druglab", "Scrapyard", "Prison", "StashHouse", "DerelictSettlement",
                              "RacetrackCommunity")},
}


RAW_POI = re.compile(r"^(RastarLocationEntity|Rastar-location|RL_)", re.I)
_TERRAIN = {"rock": "Rocky", "sand": "Sandy", "acidic": "Acidic", "ice": "Icy", "snow": "Snowy"}
_SIZE = {"s": "Small", "m": "Medium", "l": "Large"}


def is_test_poi(name: str) -> bool:
    """Developer test entities the community data picked up (RL_zzz_pu_update_06_06, ..._Test)."""
    return bool(re.match(r"^RL_zzz", name or "", re.I) or re.search(r"_test$", name or "", re.I))


def friendly_poi_name(name: str, poi_type: str = "", body: str = "") -> str:
    """Readable name for places the game files only know by their internal entity name. The game shows
    these as plain markers (a cave, a derelict outpost), so the community data has nothing better:
      RastarLocationEntity-012 (Bloom)          -> Derelict Outpost 012 (Bloom)
      RL_Pyro4_rock01_unoc_001_size04_003_001   -> Rocky Cave 003-001, size 4 (Pyro4)
      RL_col_m_drlct_otpst_occ_002              -> Medium Derelict Outpost 002, occupied (Bloom)
    Names that aren't internal ones come back unchanged."""
    if not name or not RAW_POI.match(name):
        return name
    m = re.match(r"^(.*?)\s*\(([^)]*)\)$", name)              # keep an existing "(Body)" suffix
    base, body = (m.group(1), m.group(2)) if m else (name, body)
    tail = f" ({body})" if body else ""
    kind = {"Cave": "Cave", "DerelictOutpost": "Derelict Outpost"}.get(poi_type or "", "")
    c = re.match(r"^RL_[A-Za-z]+\d*[a-z]?_([a-z]+)\d*_(occ|unoc)_\d+_size(\d+)_(\d+)_(\d+)$", base, re.I)
    if c:                                                        # procedural cave
        terrain = _TERRAIN.get(c.group(1).lower(), c.group(1).title())
        return f"{terrain} Cave {c.group(4)}-{c.group(5)}, size {int(c.group(3))}{tail}"
    d = re.match(r"^RL_(?:[A-Za-z]+\d*_)?col_([sml])_drlct_otpst_(occ|unoc)_(\d+)$", base, re.I)
    if d:                                                        # colonial derelict outpost
        occ = ", occupied" if d.group(2).lower() == "occ" else ""
        return f"{_SIZE[d.group(1).lower()]} Derelict Outpost {d.group(3)}{occ}{tail}"
    n = re.match(r"^Rastar(?:LocationEntity|-location)-?(\d*)$", base, re.I)
    if n:
        return f"{kind or 'Derelict Outpost'}{' ' + n.group(1) if n.group(1) else ''}{tail}"
    return f"{kind or 'Unmarked Site'} {base[3:].replace('_', ' ')}{tail}" if base[:3].upper() == "RL_" else name


def classify(name: str, category: str = "") -> str:
    """Map category used for icons and filters."""
    if category:
        return category
    n = name.lower()
    base = n.split(" (")[0]
    if base in CITIES:
        return "city"
    if re.match(r"^om-\d", n):
        return "om"
    if re.match(r"^(arc|cru|hur|mic)-l\d$|^p\d_l\d$", n):
        return "lpoint"
    if "jump point" in n or "jumppoint" in n or n.endswith(" gateway"):
        return "jump"
    if base in STATION_NAMES or any(k in n for k in ("station", "r&r", "port ", "everus harbor", "baijini point", "seraphim",
                            "port olisar", "port tressler")):
        return "station"
    if "cave" in n:
        return "cave"
    if any(k in n for k in ("wreck", "graveyard", "derelict", "crash")):
        return "wreck"
    if any(k in n for k in ("mining claim", "child cloud", "cluster", "asteroid")):
        return "field"
    if "comm array" in n:
        return "comm"
    if any(k in n for k in ("shelter", "outpost", "facility", "farm", "mine", "research", "datacenter",
                            "securitycenter", "hq", "base", "depot", "processing", "growery", "stash",
                            "distribution", "workcenter")):
        return "outpost"
    return "poi"


# ------------------------------------------------------------ data model ---
@dataclass
class Body:
    """A star, planet, moon or asteroid."""
    name: str
    center: Vec
    radius_m: float
    rotation_period_h: float = 0.0     # day length; 0 = not rotating
    rotation_offset_deg: float = 0.0   # angle at epoch_utc
    epoch_utc: float = 1577836800.0    # 2020-01-01 00:00 UTC, the community convention
    om_radius_m: float = 0.0           # orbital-marker radius; body zone = 3x this
    system: str = "Stanton"
    internal: str = ""                 # game code, e.g. "Stanton4" for microTech
    kind: str = "planet"               # star | planet | moon | asteroid
    calibrated: bool = False
    calibrated_at: float = 0.0         # unix time of the reading used
    calibrated_place: str = ""
    community_offset_deg: float | None = None   # the imported value, for "Reset"
    calibration_quality: str = ""      # "hangar" (a few km) < "station" (~1 km) < "place" (exact spot)

    def angle(self, t: float) -> float:
        deg = self.rotation_offset_deg
        if self.rotation_period_h > 0:
            deg += 360.0 * ((t - self.epoch_utc) / 3600.0) / self.rotation_period_h
        return math.radians(deg % 360.0)

    def to_local(self, global_pos: Vec, t: float) -> Vec:
        return rot_z(sub(global_pos, self.center), -self.angle(t))

    def to_global(self, local_pos: Vec, t: float) -> Vec:
        return add(rot_z(local_pos, self.angle(t)), self.center)

    def lat_lon_alt(self, local_pos: Vec) -> tuple[float, float, float]:
        r = norm(local_pos) or 1e-9
        lat = math.degrees(math.asin(max(-1.0, min(1.0, local_pos[2] / r))))
        lon = -math.degrees(math.atan2(local_pos[0], local_pos[1]))  # community convention
        return lat, lon, r - self.radius_m


@dataclass
class Location:
    name: str
    kind: str                 # "space" (global coords) or "surface" (body-local coords)
    pos: Vec
    body: str | None = None
    pad: str = "unknown"
    notes: str = ""
    source: str = "user"      # user | db | mission
    system: str = "Stanton"
    qt: bool = False          # has a quantum-travel marker
    pinned: bool = False
    category: str = ""
    created: float = 0.0


@dataclass
class LegInfo:
    distance_m: float | None
    heading_deg: float | None = None
    surface_distance_m: float | None = None


def _from_dict(cls, d):
    names = {f.name for f in fields(cls)}
    d = {k: v for k, v in d.items() if k in names}
    for k in ("center", "pos"):
        if k in d:
            d[k] = tuple(d[k])
    return cls(**d)


# -------------------------------------------------------------- database ---
@dataclass
class NavDB:
    bodies: dict[str, Body] = field(default_factory=dict)
    locations: dict[str, Location] = field(default_factory=dict)
    path: Path | None = None

    @classmethod
    def load(cls, path: str | Path) -> "NavDB":
        path = Path(path)
        db = cls(path=path)
        if not path.exists():
            return db
        raw = json.loads(path.read_text(encoding="utf-8"))
        for b in raw.get("bodies", []):
            body = _from_dict(Body, b)
            db.bodies[body.name] = body
        for l in raw.get("locations", []):
            if l.get("source") == "valalol":   # files from the first importer
                l["source"] = "db"
            loc = _from_dict(Location, l)
            db.locations[loc.name] = loc
        normalize(db)
        return db

    def save(self) -> None:
        if not self.path:
            return
        data = {"bodies": [asdict(b) for b in self.bodies.values()],
                "locations": [asdict(l) for l in self.locations.values()]}
        tmp = self.path.with_suffix(".tmp")
        tmp.write_text(json.dumps(data, indent=1), encoding="utf-8")
        tmp.replace(self.path)

    def unique_name(self, name: str) -> str:
        if name not in self.locations:
            return name
        i = 2
        while f"{name} ({i})" in self.locations:
            i += 1
        return f"{name} ({i})"

    # --- frames
    def global_pos(self, loc: Location, t: float) -> Vec:
        if loc.kind == "surface" and loc.body in self.bodies:
            return self.bodies[loc.body].to_global(loc.pos, t)
        return loc.pos

    def body_near(self, pos: Vec, system: str | None = None) -> Body | None:
        """The planet/moon whose rotating zone contains pos (3x OM radius, else 1.5x radius)."""
        best, best_d = None, float("inf")
        for b in self.bodies.values():
            if b.radius_m <= 0 or b.kind == "star" or (system and b.system != system):
                continue
            d = dist(pos, b.center)
            zone = 3 * b.om_radius_m if b.om_radius_m > 0 else max(1.5 * b.radius_m, b.radius_m + 50_000)
            if d <= zone and d < best_d:
                best, best_d = b, d
        return best

    def guess_system(self, pos: Vec, hint: str | None = None) -> str:
        """Which system a /showlocation position is in: the hint (from Game.log) if we have one,
        else the system whose planet zone contains the point."""
        inside = [s for s in SYSTEMS if self.body_near(pos, s)]
        if hint in SYSTEMS and (hint in inside or not inside):
            return hint
        # Inside a planet's zone in one system only, and not the hinted one: the hint is stale
        # (the log doesn't always say when you go through a wormhole).
        if len(inside) == 1:
            return inside[0]
        return hint if hint in SYSTEMS else (inside[0] if inside else "Stanton")

    def capture(self, name: str, pos: Vec, t: float, system: str, pad="unknown", notes="",
                pinned=False) -> Location:
        """Save a /showlocation position. Inside a body's zone it is stored body-local,
        so it stays glued to the ground as the planet turns."""
        name = self.unique_name(name)
        body = self.body_near(pos, system)
        if body:
            loc = Location(name, "surface", body.to_local(pos, t), body.name, pad, notes, "user",
                           system, pinned=pinned, created=time.time())
        else:
            loc = Location(name, "space", pos, None, pad, notes, "user", system, pinned=pinned,
                           created=time.time())
        self.locations[name] = loc
        self.save()
        return loc

    def local_of(self, loc: Location) -> tuple[Body | None, Vec | None]:
        if loc.kind == "surface" and loc.body in self.bodies:
            return self.bodies[loc.body], loc.pos
        return None, None

    # --- calibration
    def calibrate(self, body_name: str, known: Location, player_pos: Vec, t: float) -> dict:
        """The player stands at `known`. Rotate the body's offset so the computed local position
        of the player lines up with the known place. Returns the correction in degrees."""
        b = self.bodies.get(body_name)
        if not b or known.body != body_name or known.kind != "surface":
            return {"ok": False, "error": "Pick a place on the planet you're on"}
        computed = b.to_local(player_pos, t)
        lat_c = b.lat_lon_alt(computed)[0]
        lat_k = b.lat_lon_alt(known.pos)[0]
        if abs(lat_c - lat_k) > 1.0:
            return {"ok": False, "error": f"You don't seem to be at {known.name} "
                                          f"(latitude is off by {abs(lat_c - lat_k):.1f} degrees)"}
        err = math.degrees(math.atan2(known.pos[1], known.pos[0]) - math.atan2(computed[1], computed[0]))
        err = (err + 180) % 360 - 180
        b.rotation_offset_deg = (b.rotation_offset_deg - err) % 360
        b.calibrated, b.calibrated_at, b.calibrated_place = True, t, known.name
        b.calibration_quality = "place"
        self.save()
        return {"ok": True, "correction": err}

    def angle_error(self, body: Body, known: Location, player_pos: Vec, t: float) -> float:
        """How far (degrees of rotation) the map is from putting the player at `known`."""
        computed = body.to_local(player_pos, t)
        err = math.degrees(math.atan2(known.pos[1], known.pos[0]) - math.atan2(computed[1], computed[0]))
        return (err + 180) % 360 - 180

    def auto_calibrate(self, body_name: str, known: Location, player_pos: Vec, t: float,
                       lat_tol: float = 0.3, alt_tol: float = 15_000, quality: str = "place") -> dict:
        """Like calibrate(), but only when the reading clearly is at `known`: latitude and height don't
        depend on the rotation angle, so both must match (within the tolerances) before correcting."""
        b = self.bodies.get(body_name)
        if not b or known.kind != "surface" or known.body != body_name:
            return {"ok": False}
        lat_c, _, alt_c = b.lat_lon_alt(b.to_local(player_pos, t))
        lat_k, _, alt_k = b.lat_lon_alt(known.pos)
        if abs(lat_c - lat_k) > lat_tol or abs(alt_c - alt_k) > alt_tol:
            return {"ok": False, "reason": "not there"}
        err = self.angle_error(b, known, player_pos, t)
        b.rotation_offset_deg = (b.rotation_offset_deg - err) % 360
        b.calibrated, b.calibrated_at, b.calibrated_place = True, t, known.name
        b.calibration_quality = quality
        self.save()
        return {"ok": True, "correction": err}

    # --- navigation
    def leg(self, player: Vec, player_system: str, target: Location, t: float) -> LegInfo:
        if target.system != player_system:
            return LegInfo(None)
        tgt_global = self.global_pos(target, t)
        info = LegInfo(distance_m=dist(player, tgt_global))
        body, local = self.local_of(target)
        if body and self.body_near(player, player_system) is body:
            plat, plon, _ = body.lat_lon_alt(body.to_local(player, t))
            tlat, tlon, _ = body.lat_lon_alt(local)
            info.surface_distance_m, info.heading_deg = great_circle(plat, plon, tlat, tlon, body.radius_m)
        return info

    def route_length(self, start: Vec | None, start_system: str | None, stops: list[str], t: float,
                     arrive=None) -> list:
        """Per-leg distances; None where the leg crosses systems (a jump) or has no start.
        arrive(previous stop, system): where you come out in that system after jumping from the previous
        stop (a gateway), so the leg after a jump is measured from the far side; None if unknown."""
        legs, cur, cur_sys, prev = [], start, start_system, None
        for name in stops:
            loc = self.locations[name]
            g = self.global_pos(loc, t)
            if cur is not None and cur_sys == loc.system:
                legs.append(dist(cur, g))
            else:
                came = arrive(prev, loc.system) if arrive and prev and cur_sys != loc.system else None
                legs.append(dist(came, g) if came is not None else None)
            cur, cur_sys, prev = g, loc.system, name
        return legs

    def optimize(self, start: Vec, start_system: str, stops: list[str], t: float,
                 precedence=(), place_of: dict | None = None) -> list[str]:
        """Shortest order through the stops. Systems are visited one at a time, starting with yours.
        `precedence` is a list of (a, b) pairs where a must come before b, e.g. pickup before drop-off."""
        must_before: dict[str, set] = {}
        for a, b in precedence:
            if a in stops and b in stops and a != b:
                must_before.setdefault(b, set()).add(a)

        def valid(order):
            pos = {n: i for i, n in enumerate(order)}
            return all(pos[a] < pos[b] for b, s in must_before.items() if b in pos for a in s if a in pos)

        place = (lambda n: place_of[n]) if place_of else (lambda n: n)   # stops may be task keys
        by_sys: dict[str, list[str]] = {}
        for n in stops:
            by_sys.setdefault(self.locations[place(n)].system, []).append(n)
        order_sys = sorted(by_sys, key=lambda s: (s != start_system, list(by_sys).index(s)))
        out, cur = [], start
        for s in order_sys:
            names = by_sys[s]
            pts = {n: self.global_pos(self.locations[place(n)], t) for n in names}
            origin = cur if s == start_system and cur is not None else pts[names[0]]
            remaining, order, p = list(names), [], origin
            while remaining:  # nearest stop whose prerequisites are already visited
                ready = [n for n in remaining if not (must_before.get(n, set()) & set(remaining))] or remaining
                nxt = min(ready, key=lambda n: dist(p, pts[n]))
                order.append(nxt)
                remaining.remove(nxt)
                p = pts[nxt]

            def length(o):
                total, q = 0.0, origin
                for n in o:
                    total += dist(q, pts[n])
                    q = pts[n]
                return total

            best = length(order)
            improved = True
            while improved:
                improved = False
                cands = []
                for i in range(len(order) - 1):          # 2-opt reversals
                    for j in range(i + 1, len(order)):
                        cands.append(order[:i] + order[i:j + 1][::-1] + order[j + 1:])
                for i in range(len(order)):              # move one stop elsewhere
                    rest = order[:i] + order[i + 1:]
                    for j in range(len(order)):
                        if j != i:
                            cands.append(rest[:j] + [order[i]] + rest[j:])
                for cand in cands:
                    L = length(cand)
                    if L < best - 1e-6 and valid(cand):
                        order, best, improved = cand, L, True
                        break
            out += order
            cur = pts[order[-1]]
        return out

    # --- guidance back to a place
    def guidance(self, target: Location, player: Vec | None, player_system: str | None, t: float) -> dict:
        """How to get to `target`: straight/ground distance and heading from the player, plus the
        nearest quantum-travel markers to jump to first."""
        out = {"name": target.name, "system": target.system, "body": target.body, "approach": []}
        body, local = self.local_of(target)
        if body:
            lat, lon, alt = body.lat_lon_alt(local)
            out.update(lat=lat, lon=lon, alt=alt)
        # From the player.
        if player is not None and player_system == target.system:
            leg = self.leg(player, player_system, target, t)
            out["distance"] = leg.distance_m
            if leg.heading_deg is not None:
                out["heading"] = leg.heading_deg
                out["ground"] = leg.surface_distance_m
                p_alt = body.lat_lon_alt(body.to_local(player, t))[2]
                out["climb"] = alt - p_alt
        elif player is not None:
            out["other_system"] = True
        # Quantum approach: the QT markers closest to the target.
        cands = []
        for loc in self.locations.values():
            if loc is target or not loc.qt or loc.system != target.system:
                continue
            if body:
                if loc.body != body.name:
                    continue
                clat, clon, calt = body.lat_lon_alt(loc.pos)
                ground, heading = great_circle(clat, clon, lat, lon, body.radius_m)
                cands.append({"name": loc.name, "ground": ground, "heading": heading,
                              "straight": dist(loc.pos, local), "alt": calt,
                              "orbit": calt > 20_000})
            elif target.kind == "space":
                d = dist(self.global_pos(loc, t), target.pos)
                cands.append({"name": loc.name, "straight": d})
        cands.sort(key=lambda c: c.get("ground", c["straight"]))
        out["approach"] = cands[:3]
        out["target_is_qt"] = target.qt
        return out
