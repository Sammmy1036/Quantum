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

Quantum ships a small snapshot (nyx_starmap.json) so this works offline. A newer copy is downloaded
in the background about once a week and used from the next start.
"""
import json
import math
import time
import urllib.request
from pathlib import Path

from nav_core import Body, Location

SOURCE_URL = "https://raw.githubusercontent.com/StarCitizenWiki/scunpacked-data/HEAD/starmap_positions.json"
UA = {"User-Agent": "Quantum (Star Citizen route planner; github.com/Sammmy1036/Quantum)"}
SYSTEMS = {"nyx": "Nyx"}                 # systems taken from this source (Stanton and Pyro have better data)
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


def build_snapshot(full):
    """starmap_positions.json (the whole thing) -> the part Quantum uses."""
    out = {"source": SOURCE_URL, "generated": time.time(), "systems": {}}
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
        if not best or snap.get("generated", 0) > best.get("generated", 0):
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
