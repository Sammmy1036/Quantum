"""Positions from the game files for systems the community map data doesn't cover yet (Nyx).

Source: starmap_positions.json in the Star Citizen Wiki's data dump (github.com/StarCitizenWiki/
scunpacked-data), extracted from the game's own system files by ScDataDumper. Please credit them.

What's taken, and why only that:
  - the star and the planets, so the system gets its sun and orbit rings;
  - stations and transit points placed directly in the system (shown on the in-game starmap).
The extractor adds up nested positions without their rotation, so anything inside a rotated
container (a moon's outposts, objects inside an asteroid) can be thousands of km off. Those are
left out. Station positions are the station's map marker; docking spots can be tens of km away,
which is fine for routes. A /showlocation you or other datarunners take always wins.

Stanton and Pyro have the community map data, but it's missing places the game files have: Platform
Alignment Facilities (PAFs) and OLPs, security posts, data centres, depots, Wikelo's emporiums... and
Pyro's stations only had a rough spot (their Lagrange point). From the same file:
  - "sites": places on a planet or moon. Their position minus their planet's is the spot in the planet's
    own frame (no rotation is missing at that level), which is exactly how Quantum stores surface
    places: it matches the community data to the metre for the places both have.
  - "stations": stations placed in the system itself. Pyro's file frame is turned 85.23° from the
    game's (gateways.PYRO_FILE_ROTATION_DEG), so those are turned to match; Stanton's aren't turned.
Only places the map doesn't have get added; a station whose position was only approximate is moved.
A /showlocation you or other datarunners take always wins.

Quantum ships a small snapshot (nyx_starmap.json) so this works offline. A newer copy is downloaded
in the background about once a week and used from the next start.
"""
import json
import math
import re
import time
import urllib.request
from pathlib import Path

from nav_core import Body, Location

SOURCE_URL = "https://raw.githubusercontent.com/StarCitizenWiki/scunpacked-data/HEAD/starmap_positions.json"
UA = {"User-Agent": "Quantum (Star Citizen route planner; github.com/Sammmy1036/Quantum)"}
SYSTEMS = {"nyx": "Nyx"}                 # systems taken whole from this source (Stanton and Pyro have better data)
EXTRA = {"stanton": "Stanton", "pyro": "Pyro"}   # systems only the missing sites and stations are taken from
FORMAT = 2                                # snapshots older than this have no sites/stations
TURN_DEG = {"pyro": -85.22993}            # the file's frame -> the game's (gateways.PYRO_FILE_ROTATION_DEG)
SITE_TYPES = ("Outpost", "LandingZone", "Manmade", "Manmade_VisibleOnInteraction", "PointOfInterest")
# Not real destinations (event spawns, generic names used many times, signs)
SKIP_SITES = re.compile(r"^(RSI Event Platform|PRIVATE PROPERTY|Contested Zone|Derelict Outpost|Abandoned Outpost)$", re.I)
NOTE = "Position from the game files (Star Citizen Wiki data)"
REFRESH_DAYS = 7
# The data has no real sizes for these (the game lists them as not accessible yet): marker-sized globes.
STAR_RADIUS_M = 696_000_000.0
PLANET_RADIUS_M = 1_000_000.0


def _skip_place(e):
    """Station-type entries we don't import: hidden ones (not on the in-game map), generic unnamed
    copies, gateways (gateways.py places those with their jump points), and Levski (lives on Delamar)."""
    name = e.get("name") or ""
    return (e.get("hidden") or e.get("type") not in ("Manmade", "Outpost")
            or "Gateway" in name or name in ("Levski",) or name.endswith("Clinic"))


def _turn(p, deg):
    if not deg:
        return p
    a = math.radians(deg)
    c, s_ = math.cos(a), math.sin(a)
    return [p[0] * c - p[1] * s_, p[0] * s_ + p[1] * c, p[2]]


def _extras(full):
    """Sites on planets and moons, and stations in open space, for the systems in EXTRA."""
    ents = full.get("entities", [])
    by = {}
    for e in ents:
        by.setdefault(e.get("uuid"), e)
    out = {}
    for key, system in EXTRA.items():
        mine = [e for e in ents if (e.get("system") or "").lower() == key]
        count = {}
        for e in mine:
            count[e.get("name")] = count.get(e.get("name"), 0) + 1
        sites, stations, seen = [], [], set()
        for e in mine:
            name, t = (e.get("name") or "").strip(), e.get("type") or ""
            if not name or e.get("hidden") or t not in SITE_TYPES or SKIP_SITES.match(name) or name in seen:
                continue
            if count.get(name, 0) > 1 and t == "PointOfInterest":
                continue                                  # the same POI name placed many times
            par = by.get(e.get("parent_uuid")) or {}
            pos = [float(e["x"]), float(e["y"]), float(e["z"])]
            if par.get("type") in ("Planet", "Moon"):
                local = [pos[i] - float(par[k]) for i, k in enumerate("xyz")]
                sites.append({"name": name, "body": par.get("name"), "local": local, "kind": t,
                              "qt": bool(e.get("qt_valid", True))})
            elif par.get("type") == "Star" and t.startswith("Manmade") and "Gateway" not in name:
                stations.append({"name": name, "pos": _turn(pos, TURN_DEG.get(key)), "qt": bool(e.get("qt_valid", True))})
            else:
                continue
            seen.add(name)
        out[system] = {"sites": sites, "stations": stations}
    return out


def build_snapshot(full):
    """starmap_positions.json (the whole thing) -> the part Quantum uses."""
    out = {"source": SOURCE_URL, "generated": time.time(), "format": FORMAT, "systems": {}, "extra": _extras(full)}
    for key, system in SYSTEMS.items():
        ents = [e for e in full.get("entities", []) if (e.get("system") or "").lower() == key]
        bodies, places, anchors = [], [], {}
        for e in ents:
            pos = [float(e["x"]), float(e["y"]), float(e["z"])]
            t, name = e.get("type"), e.get("name") or ""
            if t == "Star":
                bodies.append({"name": name, "kind": "star", "center": pos})
            elif t == "Planet":
                bodies.append({"name": name, "kind": "planet", "center": pos})
            elif name == "Levski":
                anchors["Levski"] = pos                     # to move Delamar to the right place
            elif not _skip_place(e):
                places.append({"name": name, "pos": pos, "qt": bool(e.get("qt_valid", True))})
        out["systems"][system] = {"bodies": bodies, "places": places, "anchors": anchors}
    return out


def load_snapshot(*paths):
    """The newest readable snapshot of the given files."""
    best = None
    for p in paths:
        try:
            snap = json.loads(Path(p).read_text(encoding="utf-8"))
        except Exception:
            continue
        # one with the sites and stations beats an older-format one, however new that is
        if not best or (snap.get("format", 1), snap.get("generated", 0)) > (best.get("format", 1), best.get("generated", 0)):
            best = snap
    return best


def refresh(cache_path, force=False):
    """Download the wiki's file and save a fresh snapshot, at most once a week. Returns True if a new
    snapshot was written. Never raises: offline just means the shipped snapshot is used."""
    cache_path = Path(cache_path)
    try:
        if not force and cache_path.exists() and time.time() - cache_path.stat().st_mtime < REFRESH_DAYS * 86400:
            return False
        with urllib.request.urlopen(urllib.request.Request(SOURCE_URL, headers=UA), timeout=60) as r:
            full = json.loads(r.read().decode("utf-8"))
        snap = build_snapshot(full)
        if not any(s["places"] for s in snap["systems"].values()):
            return False                                    # format changed: keep what we have
        cache_path.parent.mkdir(exist_ok=True)
        cache_path.write_text(json.dumps(snap), encoding="utf-8")
        return True
    except Exception:
        return False


ROMAN = {"I": 1, "II": 2, "III": 3, "IV": 4, "V": 5, "VI": 6, "VII": 7, "VIII": 8}


def _body_for(db, name, system):
    """The game files' body name -> Quantum's ('Pyro I' -> 'Pyro1', 'microTech' -> 'microTech')."""
    if name in db.bodies and db.bodies[name].system == system:
        return name
    m = re.fullmatch(r"(.+?)\s+([IVX]+)", name or "")
    if m and m.group(2) in ROMAN:
        alt = f"{m.group(1)}{ROMAN[m.group(2)]}"
        if alt in db.bodies and db.bodies[alt].system == system:
            return alt
    key = re.sub(r"[^a-z0-9]", "", (name or "").lower())
    return next((n for n, b in db.bodies.items() if b.system == system and re.sub(r"[^a-z0-9]", "", n.lower()) == key), None)


def _key(n):
    return re.sub(r"[^a-z0-9]", "", re.sub(r"\bstation\b", "", (n or "").lower()))


def _site_category(name, kind):
    n = name.lower()
    if kind == "LandingZone":
        return ""                                         # classify() picks city/spaceport from the name
    if any(k in n for k in ("station", "emporium")):
        return "station"
    if "cave" in n:
        return "cave"
    return "outpost" if kind == "Outpost" else ""


def apply_extra(db, snap, keep=None):
    """Stanton and Pyro: add the sites and stations the map is missing, and move stations whose spot was
    only approximate (at their Lagrange point) to where the game files have them. Returns how many."""
    if not snap or not snap.get("extra"):
        return 0
    keep = keep or {}
    changed = 0
    for system, s in snap["extra"].items():
        have = {(_key(n), L.system): n for n, L in db.locations.items()}
        for p in s.get("stations", []):
            name, pos = p["name"], tuple(p["pos"])
            cur_name = have.get((_key(name), system))
            k = keep.get(cur_name or name)
            if k and k.get("system") == system:
                continue                                     # measured in game: that wins
            if cur_name:
                cur = db.locations[cur_name]
                # only the rough ones: "Position approximate (at P2-L4)" from UEX's Lagrange point
                if cur.source == "db" and cur.kind == "space" and (cur.notes or "").startswith("Position approximate"):
                    cur.pos = pos
                    cur.notes = NOTE + (". Station from UEX" if "from UEX" in cur.notes else "")
                    changed += 1
                continue
            db.locations[name] = Location(name, "space", pos, None, notes=NOTE, source="db", system=system,
                                          qt=p.get("qt", True), category="station", created=time.time())
            have[(_key(name), system)] = name
            changed += 1
        for p in s.get("sites", []):
            name = p["name"]
            if (_key(name), system) in have or keep.get(name):
                continue
            body = _body_for(db, p.get("body"), system)
            if not body:
                continue
            b = db.bodies[body]
            if b.radius_m > 0 and abs(math.hypot(*p["local"]) - b.radius_m) > max(50_000, 0.25 * b.radius_m):
                continue          # filed under a moon but placed somewhere else (nested in a rotated container)
            db.locations[name] = Location(name, "surface", tuple(p["local"]), body, notes=NOTE, source="db",
                                          system=system, qt=p.get("qt", True), category=_site_category(name, p.get("kind")),
                                          created=time.time())
            have[(_key(name), system)] = name
            changed += 1
    return changed


def apply(db, snap, keep=None):
    """Put the snapshot's bodies and places into the database. `keep` is {name: measured position}
    (your /showlocation readings and other datarunners' agreed ones): a measured position in the
    same system is used instead of the game files' marker. Your own waypoints are left alone.
    Returns the number changed."""
    if not snap:
        return 0
    keep = keep or {}
    changed = 0
    for system, s in (snap.get("systems") or {}).items():
        for b in s.get("bodies", []):
            cur = db.bodies.get(b["name"])
            center = tuple(b["center"])
            if cur and cur.system == system:
                if math.dist(cur.center, center) > 1000:
                    cur.center = center
                    changed += 1
                continue
            if cur:
                continue                                     # same name in another system: leave it
            star = b["kind"] == "star"
            r = STAR_RADIUS_M if star else PLANET_RADIUS_M
            db.bodies[b["name"]] = Body(b["name"], center, r, system=system, kind=b["kind"],
                                        om_radius_m=0.0 if star else r * 1.5)
            changed += 1
        # Delamar came from older data, before Nyx existed, and sits next to the star. Levski is on
        # it, so its position from the game files tells where Delamar really is.
        lev, dela, lev_loc = s.get("anchors", {}).get("Levski"), db.bodies.get("Delamar"), db.locations.get("Levski")
        if lev and dela and dela.system == system and lev_loc and lev_loc.kind == "surface" and lev_loc.body == "Delamar":
            local = dela.to_local(db.global_pos(lev_loc, time.time()), time.time())
            new = tuple(a - c for a, c in zip(lev, local))
            if math.dist(new, dela.center) > 1_000_000:      # only the stale position, not small drift
                dela.center = new
                changed += 1
        for p in s.get("places", []):
            name, pos, note = p["name"], tuple(p["pos"]), NOTE
            k = keep.get(name) if isinstance(keep, dict) else None
            if k and k.get("system") == system and k.get("pos"):
                # Placed here rather than left to whoever placed it before: a place that's now on the
                # map from the game files can match a UEX terminal by name and be skipped there.
                pos = tuple(k["pos"])
                note = "Position from " + ("Quantum datarunners' /showlocation" if k.get("community")
                                           else "your /showlocation")
            cur = db.locations.get(name)
            if cur and (cur.source != "db" or cur.system != system):
                continue                                     # your waypoint, or a same-named place elsewhere
            if cur:
                if cur.pos is None or math.dist(cur.pos, pos) > 1000:
                    cur.pos, cur.kind, cur.body = pos, "space", None
                    changed += 1
                if cur.notes.startswith(("Position from", "From UEX")) or not cur.notes:
                    cur.notes = note
                continue
            db.locations[name] = Location(name, "space", pos, None, notes=note, source="db", system=system,
                                          qt=p.get("qt", True), category="station", created=time.time())
            changed += 1
    return changed


def load_positions(*paths):
    """station_positions.json (written by tools/build_stations.py): {name: {system, pos | body + local}}."""
    for p in paths:
        try:
            return json.loads(Path(p).read_text(encoding="utf-8")).get("stations") or {}
        except Exception:
            continue
    return {}


def apply_positions(db, positions, keep=None):
    """Stations' spots from the game's own system layout, where Quantum's other data had them off (Nyx's ring
    and belt stations, a Gateway station). A /showlocation (keep) still wins. Returns how many moved."""
    keep = keep or {}
    changed = 0
    for name, e in (positions or {}).items():
        L = db.locations.get(name)
        k = keep.get(name)
        if not L or L.source != "db" or L.system != e.get("system") or (k and k.get("system") == L.system):
            continue
        if e.get("local") and e.get("body") in db.bodies:
            kind, pos, body = "surface", tuple(e["local"]), e["body"]
        elif e.get("pos"):
            kind, pos, body = "space", tuple(e["pos"]), None
        else:
            continue
        if L.pos is not None and L.kind == kind and L.body == body and math.dist(L.pos, pos) < 50:
            continue
        L.kind, L.pos, L.body = kind, pos, body
        if "game's own layout" not in (L.notes or ""):
            base = "" if (L.notes or "").startswith("Position") else (L.notes or "").split(". Position from")[0]
            L.notes = (base + ". " if base else "") + "Position from the game's own layout"
        changed += 1
    return changed
