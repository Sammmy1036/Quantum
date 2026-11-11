"""Everything app.py's Api and its mixins share at module level: imports, paths, constants and helpers.
Split out of app.py so each api_*.py mixin can `from qbase import *` and see the same names the Api class
always saw. Underscore names are exported too (see __all__ at the bottom)."""
import base64
import hashlib
import json
import secrets
import urllib.parse
import urllib.request
import os
import re
import math
import sys
import threading
import time
from pathlib import Path

import webbrowser

import webview

import backup
import secure
from dataclasses import asdict
import ccu
import community
import datarunner
import fleet
import gateways
import gear
import shopping
import tray
import services
import uex
import updater
import assets
import wiki

from gamelog import ContractTracker, contract_cargo, is_collection, is_tracked, need_item
import gamelog
from nav_core import Location, NavDB, SYSTEMS, _from_dict, can_align, classify, dist
import nav_core
import missions_wiki
import starmap_import
import overlay
import city_clock
import clientid
from keysender import ShowLocationSender
from watcher import ClipboardWatcher
import watcher as watcher_mod

FROZEN = getattr(sys, "frozen", False)


def report_ids(v):
    """UEX's ids_reports, however it comes back (a list, a number or "1,2,3"), as ["1", "2", "3"]."""
    if v is None:
        return []
    if isinstance(v, (list, tuple)):
        return [str(int(x)) for x in v if str(x).strip().lstrip("-").isdigit()]
    return re.findall(r"\d+", str(v))


def wintypes_hwnd(n):
    from ctypes import wintypes
    return wintypes.HWND(n)


def wintypes_hwnd_type():
    from ctypes import wintypes
    return wintypes.HWND


def ctypes_int_type():
    import ctypes
    return ctypes.c_int


def ctypes_dword():
    from ctypes import wintypes
    return wintypes.DWORD()


def ctypes_byref(x):
    import ctypes
    return ctypes.byref(x)
# Your data (locations, settings, calibrations, logs learned) lives next to Quantum.exe when packaged,
HERE = Path(sys.executable).parent if FROZEN else Path(__file__).resolve().parent
RES = Path(getattr(sys, "_MEIPASS", HERE))
DB_PATH = HERE / "locations.json"
MISSIONS_PATH = HERE / "missions.json"
SETTINGS_PATH = HERE / "settings.json"
SETTINGS_BAK = HERE / "settings.json.bak"   # the last settings.json Quantum read without trouble
SERVICES_PATH = HERE / "services.json"    # location services from the Star Citizen Wiki API
WIKI_PATH = HERE / "wiki_systems.json"   # Star Citizen Wiki system info (CC BY-SA 4.0)
CAL_PATH = HERE / "calibrations.json"
PLACES_PATH = HERE / "places.json"
COMMUNITY_PLACES_PATH = HERE / "community_places.json"
SYSTEM_ORDER = {"Stanton": 0, "Pyro": 1, "Nyx": 2}
# RSI store pages UEX has wrong (a dead link), by vehicle name in lower case
STORE_FIX = {"pitbull": "https://robertsspaceindustries.com/en/pledge/ships/pitbull/Pitbull"}


# Add-ons UEX lists (cargo modules and the like) aren't ships, so they stay out of the lists, except ones
# that fly on their own: the Drake Command Module comes with a Caterpillar or Ironclad and detaches.
FLYING_ADDONS = ("command module", "skylark")
# Ships UEX doesn't list at all, added so they can be looked up and put in My Fleet. Dropped by itself
# once UEX lists one with the same name. The id is far outside UEX's range, so it never clashes.
EXTRA_VEHICLES = [{"id": 990001, "name": "Command Module", "name_full": "Drake Command Module", "slug": "command-module",
                   "company_name": "Drake Interplanetary", "scu": 0, "crew": "1,2", "pad_type": "S", "is_spaceship": 1,
                   "is_addon": 1, "is_concept": 0, "url_store": None, "url_photo": None, "quantum_extra": True},
                  # The new Constellation generation, in game since 4.x (the older ones are the Mk IV now). Until
                  # UEX lists them; then UEX's own entries take over. Centaurus: 240 SCU, crew 4, size 5 (Sam, in game).
                  {"id": 990010, "name": "Constellation Mk V Andromeda", "name_full": "RSI Constellation Mk V Andromeda",
                   "slug": "constellation-mk-v-andromeda", "company_name": "Roberts Space Industries", "scu": 0,
                   "crew": "", "pad_type": "", "is_spaceship": 1, "is_addon": 0, "is_concept": 0, "url_store": None,
                   "url_photo": None, "quantum_extra": True, "wiki_page": "Constellation Mk V Andromeda"},
                  {"id": 990011, "name": "Constellation Mk V Centaurus", "name_full": "RSI Constellation Mk V Centaurus",
                   "slug": "constellation-mk-v-centaurus", "company_name": "Roberts Space Industries", "scu": 240,
                   "crew": "4", "size": 5, "pad_type": "", "is_spaceship": 1, "is_addon": 0, "is_concept": 0,
                   "url_store": None, "url_photo": None, "quantum_extra": True,
                   "wiki_page": "Constellation Mk V Centaurus",
                   # From the Star Citizen Wiki page (4.10.2). Shown until the wiki's ship data has the full stats,
                   # which then take over by themselves.
                   "fallback": {"career": "Medium freight / Gunship", "length": 82.5, "beam": 47.5, "height": 20.25,
                                "mass": 1240000, "crew_min": 4, "size_class": 5}},
                  # RSI's snub fighter, flight ready since 4.10.2 (out with the Centaurus, as a rental in the
                  # RSI Discovery event). Until UEX lists it.
                  {"id": 990012, "name": "Skylark", "name_full": "RSI Skylark", "slug": "skylark",
                   "company_name": "Roberts Space Industries", "scu": 0, "crew": "1", "pad_type": "XS",
                   "is_spaceship": 1, "is_addon": 0, "is_concept": 0, "is_military": 1, "url_store": None,
                   "url_photo": None, "quantum_extra": True, "wiki_page": "Skylark"}]
# Ships UEX still flags as concepts (or as add-ons, for a snub) that are flying in game.
IN_GAME = ({"constellation", "mk", "v", "andromeda"}, {"constellation", "mk", "v", "centaurus"}, {"skylark"})


def is_concept(v):
    """A ship that isn't in the game yet (UEX's flag, unless we know it's flying). Word order doesn't
    matter ("Constellation Andromeda Mk V" is the same ship)."""
    if not v.get("is_concept"):
        return False
    words = set(re.findall(r"[a-z0-9]+", f"{v.get('name') or ''} {v.get('name_full') or ''}".lower()))
    return not any(w <= words for w in IN_GAME)


def listed_vehicle(v):
    """Shown in Vehicles, My Fleet and the trade route ship list: in the game, and a ship (not a module)."""
    if is_concept(v):
        return False
    return not v.get("is_addon") or any(a in str(v.get("name_full") or v.get("name") or "").lower() for a in FLYING_ADDONS)


# The Constellation line was renamed in game when the Mk V arrived: the older ones are the Mk IV now
# ("Constellation Mk IV Andromeda"). UEX and the wiki may still use the old names, so both are searchable.
MK_ALIASES = ((r"^(?:RSI\s+)?Constellation (Andromeda|Aquila|Phoenix(?: Emerald)?|Taurus)$", "Constellation Mk IV {0}"),)


def vehicle_aka(v):
    """Other names a ship goes by (its current in-game name when UEX still uses an old one), or ""."""
    name = str(v.get("name") or "")
    for rx, fmt in MK_ALIASES:
        m = re.match(rx, name, re.I)
        if m:
            return fmt.format(*m.groups())
    return ""


# What a UEX entry may leave blank (0 or empty) for a brand-new ship, filled in from EXTRA_VEHICLES
EXTRA_FILL = ("scu", "crew", "size", "pad_type")


def _same_ship(extra, v):
    """Is UEX's row v the ship in EXTRA_VEHICLES entry extra? Word order doesn't matter ("Constellation
    Centaurus Mk V" is "Constellation Mk V Centaurus")."""
    want = set(re.findall(r"[a-z0-9]+", extra["name"].lower()))
    for k in ("name", "name_full"):
        h = str(v.get(k) or "").strip().lower()
        if h and (h in (extra["name"].lower(), extra["name_full"].lower()) or extra["name"].lower() in h
                  or want <= set(re.findall(r"[a-z0-9]+", h))):
            return True
    return False


# Ships UEX files under the wrong maker: (name pattern, real maker). The Scythe and its kin are Esperia's
# replicas of Vanduul ships, but UEX lists them under "Vanduul", which put them in a maker group of their own.
MAKER_FIX = ((r"\b(scythe|glaive|blade)\b", "Esperia"),)


def _fix_makers(rows):
    """Correct the maker of ships in MAKER_FIX, spelled the way UEX spells that maker elsewhere (so they
    land in the same "By manufacturer" group as the maker's other ships)."""
    names = {str(v.get("company_name") or ""): None for v in rows}
    out = []
    for v in rows:
        full = f"{v.get('name') or ''} {v.get('name_full') or ''}"
        for rx, maker in MAKER_FIX:
            cur = str(v.get("company_name") or "")
            if re.search(rx, full, re.I) and maker.lower() not in cur.lower():
                spelled = next((n for n in names if n.lower().startswith(maker.lower())), maker)
                v = dict(v, company_name=spelled)
                break
        out.append(v)
    return out


def with_extra_vehicles(rows):
    """UEX's vehicles, plus EXTRA_VEHICLES it doesn't have yet. When UEX does list one but with blanks
    (a new ship often comes in with 0 SCU, which hid the Mk V Centaurus from the trade route ship list
    and its cargo from My Fleet), the blanks are filled from our entry."""
    out, used = [], set()
    for v in rows:
        x = next((x for x in EXTRA_VEHICLES if _same_ship(x, v)), None)
        if x is not None:
            used.add(x["id"])
            if any(not v.get(k) and x.get(k) for k in EXTRA_FILL):
                v = dict(v, **{k: x[k] for k in EXTRA_FILL if not v.get(k) and x.get(k)})
        out.append(v)
    return _fix_makers(out + [dict(x) for x in EXTRA_VEHICLES if x["id"] not in used])


def store_url(v):
    """A vehicle's RSI store page: UEX's, unless it's one we know is wrong."""
    for k in (v.get("name"), v.get("name_full")):
        if k and str(k).strip().lower() in STORE_FIX:
            return STORE_FIX[str(k).strip().lower()]
    return v.get("url_store")


VEHICLE_ROLES = [("is_cargo", "Cargo"), ("is_mining", "Mining"), ("is_salvage", "Salvage"), ("is_military", "Combat"),
                 ("is_bomber", "Bomber"), ("is_exploration", "Exploration"), ("is_medical", "Medical"),
                 ("is_refuel", "Refuel"), ("is_passenger", "Passenger"),
                 ("is_racing", "Racing"), ("is_starter", "Starter"), ("is_ground_vehicle", "Ground"),
                 ("is_industrial", "Industrial"), ("is_science", "Exploration"), ("is_stealth", "Stealth"),
                 ("is_carrier", "Carrier"), ("is_interdiction", "Interdiction"), ("is_emp", "EMP"),
                 ("is_construction", "Construction"), ("is_datarunner", "Data running"), ("is_qed", "Quantum snare")]      # gateway positions you measured with /showlocation; shareable
# Where a hangar reading in each city is anchored its spaceport (or the city if the data has no spaceport).
CITY_ANCHOR = {"New Babbage": "New Babbage Interstellar Spaceport", "Area 18": "Riker Memorial Spaceport",
               "Orison": "August Dunlow Spaceport", "Lorville": "Lorville"}   # Teasa's spot is approximate: Lorville stays the anchor
# Each landing zone's spaceport: the same place as its city for services, landing and contracts ("Teasa
# Spaceport" is Lorville, "Riker Memorial Spaceport" is Area 18). name -> (city, planet, local position
# on the planet or None to keep the one in the data, note).
SPACEPORTS = {
    # From Sam's /showlocation at the spaceport (4.10.2), turned to Hurston's frame. The reading's time
    # isn't known, so it's placed at Lorville's longitude: within a few km.
    "Teasa Spaceport": ("Lorville", "Hurston", (-330889.8, -756782.4, 565425.1),
                        "Lorville's spaceport. Position from a /showlocation there (approximate: within a few km)"),
    "Riker Memorial Spaceport": ("Area 18", "ArcCorp", None, "Area 18's spaceport"),
    "New Babbage Interstellar Spaceport": ("New Babbage", "microTech", None, "New Babbage's spaceport"),
    "August Dunlow Spaceport": ("Orison", "Crusader", None, "Orison's spaceport"),
}


def spaceport_city(name):
    """'Teasa Spaceport' -> 'Lorville', or None."""
    sp = SPACEPORTS.get(name)
    return sp[0] if sp else None


def ensure_spaceports(db):
    """Put every city's spaceport on the map (a city place, with its city's services), adding any the
    map data lacks (Teasa Spaceport at Lorville). Returns True if the map changed."""
    changed = False
    for name, (city, body, local, note) in SPACEPORTS.items():
        loc = db.locations.get(name)
        if loc is not None and loc.source != "db":
            continue                                  # a waypoint of yours with that name: leave it alone
        if loc is None:
            if local is None or body not in db.bodies:
                continue
            c = db.locations.get(city)
            db.locations[name] = Location(name, "surface", tuple(local), body, source="db", system="Stanton",
                                          qt=True, category="city", notes=note)
            if c is not None and c.pad and c.pad != "unknown":
                db.locations[name].pad = c.pad
            changed = True
        else:
            if loc.category != "city":
                loc.category, changed = "city", True
            if not loc.notes:
                loc.notes, changed = note, True
    return changed
QUALITY = {"": 0, "estimate": 0, "hangar": 1, "station": 2, "place": 3}
BUILTIN_CAL_PATH = RES / "builtin_calibrations.json"   # shared alignments shipped with Quantum  

def _num_or0(v):
    try:
        return float(v or 0)
    except (TypeError, ValueError):
        return 0.0

def _place_key(name):
    """Name key for hidden places: case, spaces and punctuation don't matter, but a "(Pyro)" or "(Nyx)"
    suffix does (Nyx Gateway (Pyro) and Nyx Gateway (Stanton) are different stations)."""
    return re.sub(r"[^a-z0-9]", "", (name or "").lower())


def rename_raw_pois(db):
    """Older location data named some caves and derelict outposts by their game entity name
    ("RastarLocationEntity-012 (Bloom)"), and microTech's animal areas "Area 18" like ArcCorp's city.
    Give them readable names and drop developer test entities,
    so saved routes keep working. Returns {old name: new name}."""
    out = {}
    for name in list(db.locations):
        loc = db.locations[name]
        if loc.source == "db" and loc.body == "microTech" and re.match(r"^Area \d+(?: \(microTech\))?$", name):
            # microTech's wildlife zones, once named "Area 18" / "Area 18 (microTech)" like ArcCorp's city
            new = nav_core.friendly_poi_name(name, "AnimalArea", loc.body)
            if new != name and new not in db.locations:
                loc.name = new
                db.locations[new] = db.locations.pop(name)
                out[name] = new
            continue
        if loc.source != "db" or not nav_core.RAW_POI.match(name):
            continue
        if nav_core.is_test_poi(name.split(" (")[0]):
            db.locations.pop(name)
            continue
        kind = {"cave": "Cave", "outpost": "DerelictOutpost"}.get(loc.category, "")
        new = base = nav_core.friendly_poi_name(name, kind, loc.body or "")
        n = 2
        while new in db.locations and new != name:           # two unnumbered ones on the same moon
            new = re.sub(r"(\s*\([^)]*\))?$", lambda m: f" {n}{m.group(0)}", base, count=1)
            n += 1
        if new == name:
            continue
        loc.name = new
        db.locations[new] = db.locations.pop(name)
        out[name] = new
    return out


def learned_local(db, entry):
    """A place's spot on its planet or moon from a /showlocation entry, in the planet's current frame.
    The local position saved with it was worked out with the alignment of that moment; if the planet has
    been lined up differently since, the spot is turned to match (from the reading itself when it was
    kept, else by the change in alignment), so the place stays where the reading really was."""
    b = db.bodies.get(entry.get("body"))
    local = tuple(entry["local"])
    if b is None:
        return local
    rd = entry.get("reading")
    if rd and rd.get("pos") and rd.get("t"):
        return tuple(b.to_local(tuple(rd["pos"]), rd["t"]))
    off = entry.get("offset")
    if off is None or abs(off - b.rotation_offset_deg) < 1e-9:
        return local
    return nav_core.rot_z(local, math.radians(off - b.rotation_offset_deg))


def rename_rest_stops(db):
    """The community map data calls the Lagrange-point rest stops "R&R HUR-L1 Green Glade Station"; the
    game and the Star Citizen Wiki call them "HUR-L1 Green Glade Station". Use the game's name (so the
    wiki's picture, UEX and search line up), and keep saved routes working. Returns {old name: new name}."""
    out = {}
    for name in list(db.locations):
        loc = db.locations[name]
        m = re.match(r"^R\s*(?:&|and)\s*R\s+(.+)$", name, re.I)
        if loc.source != "db" or not m:
            continue
        new = m.group(1).strip()
        if not new or new in db.locations:
            continue
        loc.name = new
        db.locations[new] = db.locations.pop(name)
        out[name] = new
    return out


def rename_gateways(db):
    """In game the jump points between systems are called Gateways ("Pyro Gateway"). Rename older
    "Pyro Jump Point" entries so saved data keeps working. Returns {old name: new name}."""
    out = {}
    for name in list(db.locations):
        loc = db.locations[name]
        if loc.category == "jump" and name.endswith(" Jump Point") and name not in gateways.JUMP_POINTS:
            new = name[: -len(" Jump Point")] + " Gateway"
            if new in db.locations:
                continue
            loc.name = new
            if not loc.notes or loc.notes == "Jump point":
                loc.notes = f"Gateway: jump point to {new[: -len(' Gateway')]}"
            db.locations[new] = db.locations.pop(name)
            out[name] = new
    return out


def star_citizen_running():
    """Is StarCitizen.exe running? (Windows; elsewhere assume not.)"""
    if os.name != "nt":
        return False
    try:
        import subprocess
        out = subprocess.run(["tasklist", "/FI", "IMAGENAME eq StarCitizen.exe", "/NH"], capture_output=True,
                             text=True, timeout=10, creationflags=0x08000000).stdout   # no console window
        return "starcitizen.exe" in out.lower()
    except Exception:
        return True                          # can't tell: play it safe and leave the log alone


def clear_game_log(path=None):
    """Empty Game.log so Quantum starts reading from a clean slate. Never while the game is running
    (it's writing to it). Star Citizen keeps its own copies of old logs in the logbackups folder.
    Your contracts, learned places and calibrations are stored by Quantum and aren't affected."""
    from gamelog import default_log_paths
    path = path or next((p for p in default_log_paths() if os.path.isfile(p)), None)
    if not path or not os.path.isfile(path):
        return {"ok": False, "reason": "Game.log not found"}
    if star_citizen_running():
        return {"ok": False, "reason": "Star Citizen is running"}
    try:
        size = os.path.getsize(path)
        open(path, "w").close()
        return {"ok": True, "bytes": size, "path": path}
    except OSError as e:
        return {"ok": False, "reason": str(e)}


def _bed_count(beds):
    """The wiki gives medical beds per tier ({"T2": 1}) or as a number: the total."""
    if isinstance(beds, dict):
        return sum(v for v in beds.values() if isinstance(v, (int, float))) or None
    return beds if isinstance(beds, (int, float)) else None


def _tier(t):
    """ "T2" / 2 -> 2 (shown as "Tier 2")."""
    m = re.search(r"\d+", str(t or ""))
    return int(m.group()) if m else None


def apply_calibrations(db, data):
    """Apply a calibration file to the database. A planet already calibrated more recently is kept."""
    applied, skipped = [], []
    for name, c in (data.get("bodies") or {}).items():
        b = db.bodies.get(name)
        if not b:
            skipped.append(f"{name} (not in your map)")
            continue
        if not can_align(b):
            skipped.append(f"{name} (nowhere to land, so nothing to line up)")
            continue
        fixes_period = b.rotation_period_h == 0 and (c.get("rotation_period_h") or 0) > 0
        if fixes_period:
            b.rotation_period_h = c["rotation_period_h"]         # data said it doesn't rotate; it does
        elif abs((c.get("rotation_period_h") or 0) - b.rotation_period_h) > 1e-4:
            skipped.append(f"{name} (different day length in your data)")
            continue
        if not fixes_period and b.calibrated and b.calibrated_at >= (c.get("calibrated_at") or 0):
            skipped.append(f"{name} (yours is newer)")
            continue
        b.rotation_offset_deg = c["rotation_offset_deg"]
        b.epoch_utc = c.get("epoch_utc", b.epoch_utc)
        b.calibrated, b.calibrated_at, b.calibrated_place = True, c.get("calibrated_at", 0), c.get("place", "")
        b.calibration_quality = c.get("quality", "")
        applied.append(name)
    return applied, skipped


DEMO = {"auto": False, "delay": 0.0, "speed": 1.0}


def _demo_args(argv):
    rest, i = [], 0
    while i < len(argv):
        a = argv[i]
        key, _, val = a.partition("=")
        if key in ("--demo-delay", "--demo-speed"):
            if not val and i + 1 < len(argv) and not argv[i + 1].startswith("--"):
                i += 1
                val = argv[i]
            try:
                n = float(val)
                if key == "--demo-delay":
                    DEMO["delay"] = max(0.0, min(120.0, n))
                else:
                    DEMO["speed"] = max(0.3, min(4.0, n))
            except ValueError:
                print(f"Ignoring {a}: it needs a number, like {key}=1.5")
        elif a == "--demo":
            DEMO["auto"] = True
        else:
            rest.append(a)
        i += 1
    return rest


# Folders inside the WebView2 profile that only hold cached copies (pages, scripts, compiled code and
# shaders). Settings and saved state live elsewhere in the profile (Local Storage, IndexedDB) and are kept.
_UI_CACHE_DIRS = {"Cache", "Code Cache", "GPUCache", "Service Worker", "DawnCache", "DawnGraphiteCache",
                  "DawnWebGPUCache", "GrShaderCache", "ShaderCache"}


def clear_stale_ui_cache(cache_dir):
    """After an update (or any change to the UI files), throw away the browser's cached copies so the new
    UI shows straight away, instead of the old one until someone deletes webview_cache by hand.
    The UI is fingerprinted by content, not file dates: a packaged build unpacks fresh every launch."""
    import hashlib
    import shutil
    h = hashlib.sha1(updater.VERSION.encode())
    ui = RES / "ui"
    try:
        for f in sorted(ui.rglob("*")):
            if f.is_file() and f.suffix.lower() in (".html", ".js", ".css", ".json"):
                h.update(str(f.relative_to(ui)).encode())
                h.update(f.read_bytes())
    except OSError:
        pass
    stamp = h.hexdigest()
    mark = cache_dir / "ui_stamp.txt"
    try:
        if mark.read_text().strip() == stamp:
            return
    except OSError:
        pass
    for d in [p for p in cache_dir.rglob("*") if p.is_dir() and p.name in _UI_CACHE_DIRS]:
        shutil.rmtree(d, ignore_errors=True)
    try:
        mark.write_text(stamp)
    except OSError:
        pass


# Every name above, underscore ones included, for `from qbase import *` in app.py and the api_*.py mixins
__all__ = [n for n in list(globals()) if not (n.startswith("__") and n.endswith("__"))]
