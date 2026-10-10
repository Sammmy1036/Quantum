"""Quantum - 3D route planner, waypoint finder and contract map for Star Citizen.

Python backend + HTML/WebGL UI in a native window (pywebview / Edge WebView2).
Read-only data sources; nothing touches the game process:
  - /showlocation clipboard text  -> your position
  - Game.log                      -> contracts, exact objective markers, current system/planet
  - locations.json                -> map database (run import_data.py once)
"""
import base64
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
from dataclasses import asdict
import community
import datarunner
import fleet
import gateways
import tray
import services
import uex
import updater
import wiki

from gamelog import ContractTracker, contract_cargo, is_collection, is_tracked, need_item
import gamelog
from nav_core import Location, NavDB, SYSTEMS, _from_dict, can_align, classify, dist
import nav_core
import missions_wiki
import starmap_import
import overlay
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
FLYING_ADDONS = ("command module",)
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
                   "url_photo": None, "quantum_extra": True},
                  {"id": 990011, "name": "Constellation Mk V Centaurus", "name_full": "RSI Constellation Mk V Centaurus",
                   "slug": "constellation-mk-v-centaurus", "company_name": "Roberts Space Industries", "scu": 240,
                   "crew": "4", "size": 5, "pad_type": "", "is_spaceship": 1, "is_addon": 0, "is_concept": 0,
                   "url_store": None, "url_photo": None, "quantum_extra": True}]
# Ships UEX still flags as concepts that are flying in game.
IN_GAME = ({"constellation", "mk", "v", "andromeda"}, {"constellation", "mk", "v", "centaurus"})


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


def with_extra_vehicles(rows):
    """UEX's vehicles, plus EXTRA_VEHICLES it doesn't have yet."""
    have = {str(v.get(k) or "").strip().lower() for v in rows for k in ("name", "name_full")}
    words = [set(re.findall(r"[a-z0-9]+", h)) for h in have]
    return list(rows) + [dict(x) for x in EXTRA_VEHICLES if x["name"].lower() not in have and x["name_full"].lower() not in have
                         and not any(x["name"].lower() in h for h in have)
                         and not any(set(re.findall(r"[a-z0-9]+", x["name"].lower())) <= w for w in words)]


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
               "Orison": "August Dunlow Spaceport", "Lorville": "Lorville"}
QUALITY = {"": 0, "estimate": 0, "hangar": 1, "station": 2, "place": 3}
BUILTIN_CAL_PATH = RES / "builtin_calibrations.json"   # shared alignments shipped with Quantum  

class Api:

    def __init__(self):
        self._lock = threading.RLock()
        self._db = NavDB.load(DB_PATH)
        self._db.path = DB_PATH
        self._renamed = rename_gateways(self._db)
        self._renamed.update(rename_raw_pois(self._db))
        ren, self._unplaced = gateways.apply(self._db, self._learned_places())
        self._renamed.update(ren)
        # Nyx (and anything else the community map data lacks) from the game files, via the Star
        # Citizen Wiki: the shipped snapshot or a newer download. Measured positions win.
        self._starmap_cache = HERE / "uex_cache" / "starmap_snapshot.json"
        try:
            starmap_import.apply(self._db, starmap_import.load_snapshot(HERE / "nyx_starmap.json", self._starmap_cache),
                                 keep=self._learned_places())
            for name in [n for n, L in self._unplaced.items() if n in self._db.locations]:
                self._unplaced.pop(name, None)               # placed from the game files now
        except Exception:
            watcher_mod.log_error("starmap import")
        threading.Thread(target=starmap_import.refresh, args=(self._starmap_cache,), daemon=True).start()
        nav_core.normalize(self._db)          # after every import: Delamar is an asteroid, Levski a station
        self._db.save()
        for path in (BUILTIN_CAL_PATH, CAL_PATH):
            if not path.exists():
                continue
            try:
                applied, _ = apply_calibrations(self._db, json.loads(path.read_text(encoding="utf-8")))
                if applied:
                    self._db.save()
            except Exception:
                pass
        self._settings = self._load_settings()
        try:                                   # what datarunners agree on, from the last sync
            _cp = json.loads(COMMUNITY_PLACES_PATH.read_text(encoding="utf-8"))
            self._community_missing, self._community_pads = set(_cp.get("missing") or []), dict(_cp.get("pads") or {})
        except (OSError, ValueError, AttributeError):
            self._community_missing, self._community_pads = set(), {}
        # Stations Quantum's data lacks, from UEX's station list.
        self._uex = uex.Uex(HERE / "uex_cache", self._settings.get("uex_token", ""))
        self._uex_amen = {}
        self._wikiapi = fleet.Wiki(HERE / "uex_cache")
        self._part_images = {}               # wiki page title (lowercase) -> the wiki API's picture of that part
        self._missions = missions_wiki.MissionWiki(HERE / "uex_cache")   # contract details (wiki API)
        # Component numbers from the game files which are preferred over the wiki.
        self._game = fleet.GameData(HERE / "component_stats.json", RES / "component_stats.json")
        self._renamed.update(self._apply_uex_stations(offline=True))
        ren = self._renamed
        for st in self._settings.get("route_tasks") or []:
            st["place"] = ren.get(st.get("place"), st.get("place"))
        self._settings["route"] = [ren.get(n, n) for n in self._settings.get("route", [])]
        if self._settings.get("guide") in ren:
            self._settings["guide"] = ren[self._settings["guide"]]
        saved = self._settings.get("route_tasks") or [{"place": n, "task": "visit"} for n in self._settings.get("route", [])]
        self._route = [t for t in saved if t.get("place") in self._db.locations]
        self._guide = self._settings.get("guide") if self._settings.get("guide") in self._db.locations else None
        self._player = self._player_t = self._player_sys = None
        self._last_cal_key = None
        self._arrive_seen = None
        self._arrived_note = None
        self._last_check_t = None
        self._calibration = self._settings.get("last_calibration")
        self._static_version = 1
        self._wiki = wiki.load(WIKI_PATH)
        self._service_records = services.load(SERVICES_PATH)
        self._services = self._match_services()
        self._log_cleared = None
        if self._settings.get("clear_log_on_start", True):      # on unless the user turned it off
            self._log_cleared = clear_game_log(self._settings.get("log_path"))
        self._tracker = ContractTracker(MISSIONS_PATH, self._db, self._settings.get("log_path"))
        self._tracker.player_ref = lambda: (self._player, self._player_sys, self._player_t)
        self._tracker.start()
        self._watcher = ClipboardWatcher(self._on_position)
        self._watcher.start()
        # Types /showlocation for you: F9 by default, optional timer (off by default). Windows only.
        self._sender = ShowLocationSender()
        self._sender.on_overlay = lambda: overlay.toggle(restore_cb=self._restore_window, show_cb=self._show_window,
                                                         after_show_cb=self._nudge_redraw)
        a = {"hotkey": "F9", "loc_hotkey": "", "interval": 0, "open_chat": "enter", "on_arrival": False,
             **self._settings.get("autoloc", {})}
        if a.get("action") == "showlocation" and not a.get("loc_hotkey"):
            a["loc_hotkey"], a["hotkey"] = a["hotkey"], "F9" if a["hotkey"] != "F9" else ""
        self._sender.configure(a["hotkey"], 0, a["open_chat"], None, True, a.get("loc_hotkey", ""), False)
        self._dr = datarunner.Submitter(HERE / "datarunner_test")
        self._dr_shots, self._dr_seq = [], 0
        self._dr_job = {"state": "idle", "n": 0}
        self._dr_terminal = None
        self._community = community.Community(lambda: self._settings.get("community_url"),
                                              lambda: not self._dr.live, self._session_token, self._session_lost)
        if self._dr_cfg().get("secret") and not self._session_token():
            self._sign_in_soon()                              # signs in on first start after updating, too
        threading.Thread(target=self._sync_places, daemon=True).start()
        threading.Thread(target=self._backup_loop, daemon=True).start()
        threading.Thread(target=self._sync_photos, daemon=True).start()
        self._updater = updater.Updater()
        self._updater.cleanup()
        self._update = None
        threading.Thread(target=self._check_update, daemon=True).start()
        self._dr_session = {"reports": 0, "prices": 0, "terminals": [], "days": 0.0, "started": time.time()}
        self._sender.on_shot = lambda: self._dr_start_job(from_button=False)
        self._sender.configure(shot_hotkey=(self._settings.get("datarunner") or {}).get("shot_hotkey", ""))

    # ------------------------------------------------------------ internals
    def _load_settings(self):
        try:
            return json.loads(SETTINGS_PATH.read_text(encoding="utf-8"))
        except Exception:
            return {}

    def _save_settings(self):
        self._settings.update(route_tasks=self._route, guide=self._guide)
        self._settings.pop("route", None)
        SETTINGS_PATH.write_text(json.dumps(self._settings, indent=1), encoding="utf-8")

    def _game_on(self):
        """Is Star Citizen running?"""
        tr = self._tracker
        if os.name != "nt" or tr.game_running:
            return True
        if tr.proc_seen:              # the process check has seen the game before trust it it's gone
            return False
        return time.time() - tr.last_growth < 120

    def _on_position(self, pos, t):
        if not self._game_on():
            # A /showlocation copied while Quantum can't see the game is treated as an old clipboard.
            # Say so in quantum_errors.log, so "it ignored my reading" can be traced.
            try:
                with watcher_mod.ERROR_LOG.open("a", encoding="utf-8") as f:
                    f.write(f"--- {time.strftime('%Y-%m-%d %H:%M:%S')} /showlocation ignored: Star Citizen "
                            f"not detected (log status {self._tracker.status})\n")
            except OSError:
                pass
            return
        with self._lock:
            try:
                hint = self._system_hint(pos, t)
            except Exception:                              # a bad guess must never cost the reading
                watcher_mod.log_error("system hint")
                hint = (self._tracker.where or {}).get("system")
            self._player, self._player_t = pos, t
            self._player_sys = self._db.guess_system(pos, hint)
            if self._player_sys != hint:
                self._sys_how = ("planet", "", t)
            self._last_fix = (pos, t, self._player_sys)
            self._learn_jump_from_reading()
            self._try_autocal()
            try:
                self._tracker.resolve_free_markers()       # open-space markers waiting for your position
            except Exception:
                watcher_mod.log_error("free markers")

    def _travel_view(self, cur, t):
        v = self._travel_view_base(cur, t)
        if v is None:
            return v
        tr, now = self._tracker, time.time()
        if tr.activity and now - tr.activity["at"] < 1800:
            v["activity"] = tr.activity
        if tr.vehicle and now - tr.vehicle["at"] < 6 * 3600:
            v["vehicle"] = tr.vehicle
        if tr.armistice:
            v["armistice"] = tr.armistice[0]
        return v

    def _travel_view_base(self, cur, t):
        q = self._tracker.qt or {}
        known = sum(1 for d in self._tracker.dest_ids.values() if not d.get("ambiguous"))
        base = {"known_ids": len(self._tracker.loc_ids), "known_jumps": known}
        if q.get("selected") and not q.get("arrived") and t - q["selected"] < 1800 and \
                (not cur or q["selected"] >= cur.get("at", 0)):
            return {**base, "state": "jumping", "from": q.get("start"), "to": q.get("place"), "at": q["selected"]}
        if cur and cur.get("dead"):
            return {**base, "state": "dead", "near": cur.get("died_near"), "at": cur.get("at")}
        if cur and cur.get("spawned"):
            return {**base, "state": "respawned", "place": cur.get("place"), "near": cur.get("died_near"),
                    "at": cur.get("at")}
        if cur and cur.get("jump"):
            return {**base, "state": "arrived", "place": cur.get("near"), "at": cur.get("at")}
        if cur:
            return {**base, "state": "landed" if cur.get("landing") else "flying", "place": cur.get("place"),
                    "left": cur.get("left"), "at": cur.get("at")}
        return {**base, "state": None}

    def _system_hint(self, pos, t):
        """Which system Game.log says you're in, corrected for what it misses:
          - you told Quantum which system you're in (set_my_system), and the log hasn't named a place since;
          - you went through a gateway: the reading before was at a jump point, no quantum jump was
            started since, and now you're nowhere near it. That's the other side of the wormhole.
        Going through a wormhole doesn't write anything Quantum recognises to Game.log, so without
        this the last system stays in place (readings in Nyx came out as Stanton)."""
        w = self._tracker.where or {}
        hint = w.get("system")
        self._sys_how = ("log", w.get("code") or "", w.get("at"))
        ov = getattr(self, "_sys_override", None)
        if ov:
            # Held while the log keeps naming the system it named when it was set (stale lines after a
            # wormhole keep saying "Stanton"). Dropped when the log reports a different system.
            named = False                                  # the log named a real place since: believe it
            if (w.get("at") or 0) > ov.get("at", 0) and w.get("code"):
                try:
                    named = bool(self._tracker.place_for_code(w["code"]))
                except Exception:
                    named = False
            if hint == ov.get("log_sys") and hint != ov["system"] and not named:
                self._sys_how = (ov.get("how", "you"), w.get("code") or "", w.get("at"))
                return ov["system"]
            self._sys_override = None
        last = getattr(self, "_last_fix", None)
        if last and 0 < t - last[1] < 3600:
            ppos, pt, psys = last
            q = self._tracker.qt or {}
            if (q.get("selected") or 0) < pt:              # no quantum jump since that reading
                for loc in self._db.locations.values():
                    to = gateways.leads_to(loc.name)
                    if not to or to not in nav_core.SYSTEMS or loc.system != psys or not loc.pos:
                        continue
                    if dist(loc.pos, ppos) < 150_000 and dist(loc.pos, pos) > 2_000_000:
                        self._sys_override = {"system": to, "log_sys": hint, "how": "wormhole", "at": t}
                        self._sys_how = ("wormhole", loc.name, pt)
                        return to
        return hint

    def set_my_system(self, system):
        """You're in this system: Game.log hasn't said so (it doesn't after a wormhole). Holds until the
        log names a new place; your latest /showlocation is re-read for it right away."""
        if system not in nav_core.SYSTEMS:
            return {"ok": False, "error": f"Unknown system {system}"}
        with self._lock:
            w = self._tracker.where or {}
            self._sys_override = {"system": system, "log_sys": w.get("system"), "how": "you",
                                  "at": time.time()}
            self._sys_how = ("you", w.get("code") or "", w.get("at"))
            if self._player:
                self._player_sys = system
                self._last_fix = (self._player, self._player_t, system)
        return {"ok": True}

    def _learn_jump_from_reading(self):
        q = self._tracker.qt or {}
        if not q.get("arrived") or q.get("by_reading") or not (0 <= self._player_t - q["arrived"] <= 900):
            return
        t, best, bd, second = self._player_t, None, float("inf"), float("inf")
        for loc in self._db.locations.values():
            if loc.system != self._player_sys or loc.source != "db":
                continue
            if not (loc.qt or classify(loc.name, loc.category) in ("om", "station", "city", "lpoint", "jump")):
                continue
            d = dist(self._db.global_pos(loc, t), self._player)
            if d < bd:
                best, bd, second = loc.name, d, bd
            elif d < second:
                second = d
        if best and bd < 150_000 and second > 2 * bd:
            q["by_reading"] = True
            self._tracker.learn_dest(q["dest"], best, "reading")

    def _auto_arrive(self, cur):
        """Tick off the next stop when you get there. Evidence, from the log or a /showlocation:
          - landing or docking at that place (or anywhere in that city),
          - a quantum jump arriving at a destination known to be that place,
          - a /showlocation within reach of it (1.5 km on the ground, 30 km in space).
        Stops with contract jobs stay until the job itself completes they're marked as reached."""
        stops = self._stops()
        if not stops:
            return
        target = stops[0]["place"]
        L = self._db.locations.get(target)
        if not L:
            return
        evidence = None
        if cur and cur.get("landing") and cur.get("place"):
            here = self._db.locations.get(cur["place"])
            same_city = here and L.body and here.body == L.body and \
                classify(here.name, here.category) == "city" and dist(here.pos, L.pos) < 30_000
            if cur["place"] == target or same_city:
                evidence = ("landed", cur.get("id"), cur.get("at"))
        if not evidence and cur and cur.get("jump") and cur.get("near") == target:
            evidence = ("jump", cur.get("jump"), cur.get("at"))
        if not evidence and self._player and self._player_sys == L.system:
            reach = 1_500 if L.kind == "surface" else 30_000
            if dist(self._db.global_pos(L, self._player_t), self._player) < reach:
                evidence = ("reading", target, round(self._player_t))
        if not evidence or evidence == self._arrive_seen:
            return
        self._arrive_seen = evidence
        at = evidence[2] or time.time()
        if all(tk["task"] == "visit" for tk in stops[0]["tasks"]):      # gateways clear once you've jumped
            self._set_from_stops(stops[1:])
            self._save_settings()
            self._arrived_note = {"place": target, "at": at, "advanced": True}
        elif not self._arrived_note or self._arrived_note.get("place") != target:
            self._arrived_note = {"place": target, "at": at, "advanced": False}

    def _try_autocal(self):
        """Line a planet up from a /showlocation taken where the log says you are.

        - City or spaceport (e.g. your hangar at New Babbage) anchored to that city's spaceport.
          Hangars sit a few km from the spaceport's map point, so this is good to a few km.
        - Orbital station (e.g. Port Tressler) anchored to the station, good to about a km.
        - Any other named place (outposts, distribution centres) exact.
        Latitude and height don't depend on the rotation angle, so they must roughly match the anchor
        first."""
        if self._player and self._autocal_from_delivery():
            return
        w = self._tracker.where or {}
        if not self._player or not w.get("code") or not w.get("at"):
            return
        if abs(self._player_t - w["at"]) > 1200:       # log event and reading within 20 minutes
            return
        key = (w["code"], round(w["at"]), round(self._player_t))
        if key == self._last_cal_key:
            return
        self._last_cal_key = key
        body = self._db.body_near(self._player, self._player_sys)
        if not can_align(body):
            return
        anchor_name = self._tracker.place_for_code(w["code"])
        anchor = self._db.locations.get(anchor_name) if anchor_name else None
        target, mode, lat_tol, alt_tol = None, None, 0, 0
        if anchor:
            kind = classify(anchor.name, anchor.category)
            if kind == "city" or "spaceport" in anchor.name.lower():
                city = next((c for c in CITY_ANCHOR if c.lower() in anchor.name.lower()
                             or anchor.name == CITY_ANCHOR[c]), None)
                target = self._db.locations.get(CITY_ANCHOR.get(city, ""), anchor)
                mode, lat_tol, alt_tol = "hangar", 0.5, 6_000
            elif kind == "station":
                target, mode, lat_tol, alt_tol = anchor, "station", 0.15, 6_000
        if target is None:
            lat_p, _, alt_p = body.lat_lon_alt(body.to_local(self._player, self._player_t))
            matches = []
            for loc in self._db.locations.values():
                if loc.source != "db" or loc.kind != "surface" or loc.body != body.name:
                    continue
                if classify(loc.name, loc.category) == "city" or "spaceport" in loc.name.lower():
                    continue
                if anchor and anchor.kind == "surface" and dist(loc.pos, anchor.pos) > 150_000:
                    continue
                lat, _, alt = body.lat_lon_alt(loc.pos)
                score = max(abs(lat - lat_p) / 0.02, abs(alt - alt_p) / (3_000 if alt > 20_000 else 600))
                if score < 1.0:
                    matches.append((score, loc))
            if not matches:
                return
            matches.sort(key=lambda m: m[0])
            if any(dist(m[1].pos, matches[0][1].pos) > 5_000 for m in matches[1:]):
                return                                  # two different places fit let the prompt ask
            target, mode, lat_tol, alt_tol = matches[0][1], "place", 0.3, 15_000
        if target.kind != "surface" or target.body != body.name:
            return
        if body.calibrated and abs((body.calibrated_at or 0) - self._player_t) < 1:
            return                                      # this reading already calibrated this body
        have = QUALITY.get(body.calibration_quality, 0) if body.calibrated else -1
        if QUALITY[mode] < have:
            lat_c, _, alt_c = body.lat_lon_alt(body.to_local(self._player, self._player_t))
            lat_k, _, alt_k = body.lat_lon_alt(target.pos)
            if abs(lat_c - lat_k) <= lat_tol and abs(alt_c - alt_k) <= alt_tol \
                    and self._player_t - (body.calibrated_at or 0) > 60:
                self._record_cal(f"check-{mode}", body.name, target.name,
                                 self._db.angle_error(body, target, self._player, self._player_t))
            return
        res = self._db.auto_calibrate(body.name, target, self._player, self._player_t, lat_tol, alt_tol, mode)
        if res.get("ok"):
            self._record_cal(f"auto-{mode}", body.name, target.name, res["correction"])
            self._calibration = {"body": body.name, "place": target.name, "correction": res["correction"],
                                 "at": time.time(), "quality": mode}
            self._settings["last_calibration"] = self._calibration
            self._static_version += 1
            self._save_settings()

    def _autocal_from_delivery(self):
        """You just completed a pickup or drop-off the log's marker for it is where you're standing.
        A /showlocation within 5 minutes lines that planet up exactly."""
        for hit in reversed(self._tracker.marker_hits):
            if hit["used"] or abs(self._player_t - hit["t"]) > 300:
                continue
            body = self._db.bodies.get(hit["body"])
            if not can_align(body) or self._db.body_near(self._player, self._player_sys) is not body:
                continue
            spot = Location(hit["name"], "surface", tuple(hit["pos"]), body.name, system=body.system)
            if QUALITY["place"] < (QUALITY.get(body.calibration_quality, 0) if body.calibrated else -1):
                continue
            # 0.05 degrees (about 900 m on a 1,000 km planet) and 1.5 km of height you're at the marker.
            res = self._db.auto_calibrate(body.name, spot, self._player, self._player_t, 0.05, 1_500, "place")
            if not res.get("ok"):
                continue
            hit["used"] = True
            self._record_cal("auto-delivery", body.name, hit["name"], res["correction"])
            self._calibration = {"body": body.name, "place": hit["name"], "correction": res["correction"],
                                 "at": time.time(), "quality": "place"}
            self._settings["last_calibration"] = self._calibration
            self._static_version += 1
            self._save_settings()
            return True
        return False

    def _calib_suggestion(self):
        """Your reading matches a known place by latitude and altitude (which don't depend on the
        planet's rotation angle) but the map puts you far from it offer to line the planet up there.
        Places near the area the log last named come first otherwise the closest matches anywhere."""
        if not self._player:
            return None
        body = self._db.body_near(self._player, self._player_sys)
        if not can_align(body) or body.rotation_period_h <= 0:
            return None
        local = body.to_local(self._player, self._player_t)
        lat_p, lon_p, alt_p = body.lat_lon_alt(local)
        w = self._tracker.where or {}
        anchor_name = self._tracker.place_for_code(w["code"]) if w.get("code") else None
        anchor = self._db.locations.get(anchor_name) if anchor_name else None
        if anchor and anchor.body != body.name:
            anchor = None
        cands = []
        for loc in self._db.locations.values():
            if loc.source != "db" or loc.kind != "surface" or loc.body != body.name:
                continue
            lat, lon, alt = body.lat_lon_alt(loc.pos)
            alt_tol = 6_000 if alt > 20_000 else 2_500
            score = max(abs(lat - lat_p) / 0.08, abs(alt - alt_p) / alt_tol)
            if score >= 1:
                continue
            off = dist(loc.pos, local)
            if off < 3_000:                
                if (body.calibrated and self._last_check_t != self._player_t
                        and self._player_t - (body.calibrated_at or 0) > 60):   # a LATER reading, not the calibrating one
                    self._last_check_t = self._player_t
                    resid = math.degrees(math.atan2(loc.pos[1], loc.pos[0]) - math.atan2(local[1], local[0]))
                    self._record_cal("check", body.name, loc.name, (resid + 180) % 360 - 180)
                return None
            if off < 25_000:
                # A few km could just mean you're parked near the place; a wrong rotation angle puts
                # you tens to hundreds of km out, so only offer the fix for that.
                continue
            near_anchor = bool(anchor and dist(loc.pos, anchor.pos) < 150_000)
            cands.append({"name": loc.name, "off": off, "near_log": near_anchor, "score": score,
                          "type": loc.category or ""})
        if not cands:
            return None
        cands.sort(key=lambda c: (not c["near_log"], c["score"]))
        if cands[0]["near_log"]:
            cands = [c for c in cands if c["near_log"]]
        return {"body": body.name, "calibrated": body.calibrated, "reading_t": self._player_t,
                "log_area": anchor.name if anchor else None, "places": cands[:3],
                "city": bool(anchor and classify(anchor.name, anchor.category) == "city")}

    def _match_services(self):
        locs = {**self._unplaced, **self._db.locations}
        out = services.match(self._service_records, locs)
        for name, amen in self._uex_amen.items():      # stations the wiki data has nothing for
            if getattr(locs.get(name), "category", "") == "jump":
                continue                                # Gateways (jump points) have no services
            if amen and (name not in out or not out[name]["amenities"]):
                out[name] = dict(out.get(name) or {"name": name, "description": "", "jurisdiction": "",
                                                   "url": "", "version": ""}, amenities=amen, uex=True)
        return out

    def _apply_uex_stations(self, offline=False):
        """Add the stations UEX lists that Quantum's data lacks: at their Lagrange point (approximate),
        or by renaming a placeholder like "Orbital Station Bloom" to the real name ("Orbituary").
        Returns {old name: new name}."""
        try:
            rows, _ = self._uex.get("space_stations", offline=offline)
        except uex.UexError:
            self._drop_hidden()
            return {}
        locs = self._db.locations
        keys = {(services._key(n), l.system): n for n, l in locs.items()     # a Gateway is never a UEX station
                if l.source == "db" and l.category not in ("lpoint", "om", "jump")}
        renamed, aliases, amen = {}, {}, {}
        for st in rows:
            sysn, name = st.get("star_system_name"), (st.get("name") or "").strip()
            if sysn not in uex.SYSTEMS or not name or st.get("is_decommissioned") or \
                    not st.get("is_available_live", 1) or not st.get("is_visible", 1):
                continue
            k = services._key(name)
            have = keys.get((k, sysn)) or keys.get((k + "station", sysn))
            if have:
                if have != name:
                    aliases[name] = have
                amen[have] = uex.amenities(st)
                continue
            lp = uex.lpoint_name(st)
            body = st.get("moon_name") or st.get("planet_name")
            ph = f"Orbital Station {body}" if body else None
            if not lp and ph in locs and locs[ph].source == "db" and name not in locs:
                loc = locs.pop(ph)
                loc.name = name
                loc.notes = (loc.notes + ". " if loc.notes else "") + "Name from UEX"
                locs[name] = loc
                renamed[ph] = name
            elif lp in locs and locs[lp].system == sysn and name not in locs:
                locs[name] = Location(name, "space", locs[lp].pos, None, source="db", system=sysn, qt=True,
                                      notes=f"Position approximate (at {lp}). Station from UEX", category="station")
            else:
                continue
            keys[(k, sysn)] = name
            amen[name] = uex.amenities(st)
        self._uex.aliases, self._uex_amen = aliases, amen
        self._uex.forget_places()
        self._add_uex_pending(offline, rows)
        self._db.save()
        self._uex.forget_places()
        return renamed

    def _add_uex_pending(self, offline, stations):
        """Trade terminals at places no data has a position for (new Pyro outposts and stations):
        searchable with their services, and placed for good by one /showlocation there."""
        try:
            places = self._uex.place_map(self._db.locations, offline=offline)
            terms = self._uex.terminals(offline=offline)
        except uex.UexError:
            self._drop_hidden()
            return
        try:
            outposts = {o["name"]: o for o in self._uex.get("outposts", offline=offline)[0]}
        except uex.UexError:
            outposts = {}
        st_by_name = {s_.get("name"): s_ for s_ in stations}
        learned = self._learned_places()
        bodies = {n for n in self._db.bodies}
        self._uex_pending = getattr(self, "_uex_pending", {})
        hidden = self._hidden_keys()
        for tid, t in terms.items():
            if places.get(tid):
                continue
            # UEX lists some terminals that aren't in the live game (retired, unreleased, hidden)
            if not uex.is_live(t):
                continue
            station = t.get("space_station_name")
            name = uex.place_name(t)            # the same name Settings and the Jobs use for it
            sysn = t.get("star_system_name")
            if _place_key(name) in hidden:          # case/spacing-proof: UEX re-cases names now and then
                self._unplaced.pop(name, None)
                continue
            if not name or name in self._db.locations or gateways.system_of(name) or \
                    any(services._key(name) == services._key(n) for n in self._unplaced if n not in self._uex_pending):
                continue
            body = uex.body_name(t.get("moon_name") or t.get("planet_name"), bodies)
            surface = not station and bool(body)
            src = st_by_name.get(name) or outposts.get(name) or {}
            self._uex_amen[name] = uex.amenities(src) if src else []
            where = f" on {t.get('moon_name') or t.get('planet_name')}" if surface else ""
            l = learned.get(name)
            if l and l.get("system") == sysn and (l.get("local") or l.get("pos")):
                if l.get("local") and l.get("body") in bodies:
                    loc = Location(name, "surface", learned_local(self._db, l), l["body"], source="db", system=sysn,
                                   qt=True, category="station" if station else "outpost",
                                   notes=f"From UEX{where}. Position from " + ("Quantum datarunners' /showlocation" if l.get("community") else "your /showlocation"))
                else:
                    loc = Location(name, "space", tuple(l["pos"]), None, source="db", system=sysn, qt=True,
                                   category="station", notes="From UEX. Position from " + ("Quantum datarunners' /showlocation" if l.get("community") else "your /showlocation"))
                self._db.locations[name] = loc
                self._unplaced.pop(name, None)
            else:
                self._unplaced[name] = Location(name, "surface" if surface else "space", None, body if surface else None,
                                                source="db", system=sysn, qt=True,
                                                category="station" if station else "outpost",
                                                notes=f"From UEX{where}. Position not known yet")
            self._uex_pending[name] = sysn
        self._drop_hidden()                          # gateways or Wikelo places reported missing, too

    def _hidden_places(self):
        """Places not to list as "not on the map yet": ones you said don't exist, and ones datarunners
        agree don't exist."""
        return set(self._settings.get("places_hidden") or []) | set(getattr(self, "_community_missing", ()))

    def _hidden_keys(self):
        """The hidden places as name keys, so "NovaworX Industries" and "Novaworx Industries" match."""
        return {_place_key(n) for n in self._hidden_places()}

    def _drop_hidden(self):
        """Take hidden places off "Not on the map yet". Run after every rebuild of the list, including
        the ones where UEX's cached data couldn't be read (they used to skip this)."""
        hk = self._hidden_keys()
        for n in [n for n in self._unplaced if _place_key(n) in hk]:
            self._unplaced.pop(n, None)

    def report_missing(self, name):
        """This place doesn't exist in the game: hide it here now, and tell the Quantum server."""
        with self._lock:
            hidden = self._settings.setdefault("places_hidden", [])
            if name not in hidden:
                hidden.append(name)
            self._unplaced.pop(name, None)
            self._db_changed()
        self._community.post_missing(name, self._dr_cfg().get("username"))
        return {"ok": True}

    def dr_claims(self):
        """Jobs other datarunners are on, and the one you're on: {ok, claims: {job: {by, until, mine}}}."""
        c = self._community.claims()
        me = (self._dr_cfg().get("username") or "").lower()
        if c is None:
            return {"ok": False, "claims": {}}
        return {"ok": True, "now": time.time(), "claims": {k: dict(v, mine=v["by"] == me) for k, v in c.items()}}

    def dr_claim(self, job, release=False):
        """Accept a job (held for 30 minutes, renewable) or let it go."""
        user = self._dr_cfg().get("username") or (self._dr_cfg().get("uex_user") or {}).get("username")
        if not user:
            return {"ok": False, "error": "Add your UEX Secret Key first: jobs are held under your UEX name"}
        r = self._community.claim(job, user.lower(), release)
        if r.get("status") == "ok":
            return {"ok": True, "until": r.get("until")}
        if r.get("status") == "taken":
            return {"ok": False, "taken": True, "by": r.get("by"), "until": r.get("until"),
                    "error": f"{r.get('by')} accepted this job already"}
        if r.get("status") == "off":
            return {"ok": True, "until": None, "offline": True}
        return {"ok": False, "error": "The Quantum server couldn't be reached. Try again in a minute"}

    def withdraw_place(self, name):
        """You set a station's position by mistake: take your reading back from the Quantum server and
        off your map. (A position other datarunners agreed on stays on the map from their readings.)"""
        name = gateways.learn_key(name)
        r = self._community.withdraw_place(name, self._dr_cfg().get("username"))
        if r.get("status") not in ("ok", "off"):
            return {"ok": False, "error": "That reading was sent from another connection, so it can't be withdrawn from here"
                    if r.get("status") == "not_yours" else "The Quantum server couldn't be reached. Try again in a minute"}
        with self._lock:
            places = gateways.load_learned(PLACES_PATH)
            if places.pop(name, None) is not None:
                PLACES_PATH.write_text(json.dumps({"places": places}, indent=1), encoding="utf-8")
            unsent = self._settings.get("places_unsent") or []
            if name in unsent:
                unsent.remove(name)
            self._community.place_results.pop(name, None)
            plain = name[len(gateways.JUMP_PREFIX):] if name.startswith(gateways.JUMP_PREFIX) else name
            placeable = gateways.system_of(plain) or plain in getattr(self, "_uex_pending", {})
            if placeable and plain in self._db.locations and self._db.locations[plain].source == "db" \
                    and plain not in gateways.JUMP_POINTS and plain not in gateways.GATEWAYS:
                self._db.locations.pop(plain)            # put back on "Not on the map yet" by the re-apply below
            ren, self._unplaced = gateways.apply(self._db, self._learned_places())
            self._renamed.update(ren)
            self._apply_uex_stations(offline=True)
            self._db.save()
            self._db_changed()
        return {"ok": True}

    def unhide_places(self):
        """Show every place you hid again (ones datarunners agree don't exist stay hidden)."""
        self._settings.pop("places_hidden", None)
        self._save_settings()
        with self._lock:
            ren, self._unplaced = gateways.apply(self._db, self._learned_places())
            self._renamed.update(ren)
            self._apply_uex_stations(offline=True)
            self._db_changed()
        return {"ok": True}

    def _db_changed(self):
        self._uex.forget_places()
        self._services = self._match_services()
        self._static_version += 1
        self._route = [r for r in self._route if r["place"] in self._db.locations]
        if self._guide not in self._db.locations:
            self._guide = None
        self._tracker.relink()
        self._save_settings()

    def _restore_window(self):
        """Un-minimise through pywebview, so the embedded browser is told it's visible again."""
        try:
            webview.windows[0].restore()
            time.sleep(0.15)
        except Exception:
            pass

    def _show_window(self):
        """Un-hide (from the tray) through pywebview, so the embedded browser draws again."""
        try:
            webview.windows[0].show()
            time.sleep(0.15)
        except Exception:
            pass

    def _nudge_redraw(self):
        try:
            webview.windows[0].evaluate_js("window.dispatchEvent(new Event('resize'))")
        except Exception:
            pass

    def shutdown(self):
        self._sender.shutdown()
        self._watcher.stop()
        self._tracker.stop()

    # ------------------------------------------------------------ static data
    def _refresh_learned_locals(self):
        """Places on a planet you (or other datarunners) placed with /showlocation: keep them where the
        reading was when the planet's alignment changes (an alignment, a reset, the community's)."""
        key = tuple(sorted((b.name, round(b.rotation_offset_deg, 6)) for b in self._db.bodies.values()))
        if key == getattr(self, "_learned_key", None):
            return
        self._learned_key = key
        for name, l in self._learned_places().items():
            loc = self._db.locations.get(name)
            if loc is not None and loc.kind == "surface" and l.get("body") == loc.body and l.get("local"):
                loc.pos = learned_local(self._db, l)

    def get_static(self):
        with self._lock:
            self._refresh_learned_locals()
            bodies = sorted(self._db.bodies.values(), key=lambda b: -b.radius_m)
            out_b = []
            for b in bodies:
                # a moon's parent at least twice its size and close by (within 200 parent radii)
                parents = [p for p in bodies if p.system == b.system and p.radius_m >= 2 * b.radius_m
                           and (p.kind == "star" or dist(p.center, b.center) < 200 * p.radius_m)]
                parent = min(parents, key=lambda p: dist(p.center, b.center), default=None)
                out_b.append({"name": b.name, "center": b.center, "radius": b.radius_m, "system": b.system,
                              "kind": b.kind, "period": b.rotation_period_h, "offset": b.rotation_offset_deg,
                              "epoch": b.epoch_utc, "om": b.om_radius_m, "calibrated": b.calibrated,
                              "alignable": can_align(b),
                              "parent": parent.name if parent and b.kind != "star" else None})
            hidden_keys = self._hidden_keys()
            unverified = gateways.unverified(self._learned_places())     # "Check its position" jobs
            locs = [{"name": l.name, "kind": l.kind, "pos": l.pos, "body": l.body, "pad": l.pad,
                     "notes": l.notes, "source": l.source, "system": l.system, "qt": l.qt,
                     "pinned": l.pinned, "created": l.created, "type": classify(l.name, l.category),
                     # "to" only on the jump points themselves, so the UI doesn't treat the gateway
                     # station as a wormhole; the station gets "gate_to" and its jump point's name.
                     "to": gateways.leads_to(l.name) if l.name in gateways.JUMP_POINTS
                     or (l.name not in gateways.GATEWAYS and classify(l.name, l.category) == "jump") else None,
                     "gate_to": gateways.leads_to(l.name) if l.name in gateways.GATEWAYS else None,
                     "jump_point": gateways.jump_point_of(l.name), "station": gateways.station_of(l.name),
                     "unplaced": l.pos is None,
                     "placeable": gateways.system_of(l.name) is not None or l.name in getattr(self, "_uex_pending", {}),
                     "verify": l.pos is not None and l.name in unverified,
                     "near": gateways.near_body(l.name),
                     "pad_shared": (getattr(self, "_community_pads", None) or {}).get(l.name),
                     **({"amen": self._services[l.name]["amenities"],
                         "pad_auto": services.pad_from(self._services[l.name]["amenities"])}
                        if l.name in self._services else {})}
                    for l in [*self._db.locations.values(), *self._unplaced.values()]
                    if l.pos is not None or _place_key(l.name) not in hidden_keys]
            info = {b["name"]: wiki.for_game_body(self._wiki, b["name"], b["kind"], b["system"]) for b in out_b}
            return {"version": self._static_version, "bodies": out_b, "locations": locs, "systems": SYSTEMS,
                    "wiki": {"bodies": info, "systems": (self._wiki or {}).get("systems", {})}}

    # ------------------------------------------------------------ live data
    def _log_spot(self, cur):
        """Best place the log puts you at -> (place, when, how), or (None, 0, None).
        Landed/docked there > arrived there by quantum > talking to its traffic control or entering it >
        just took off from it. Unknown places, deaths and quantum jumps under way give nothing."""
        cur, locs = cur or {}, self._db.locations
        if cur.get("dead"):
            return None, 0, None
        if cur.get("landing") and cur.get("place") in locs:
            return cur["place"], cur["at"], "landed"
        if cur.get("jump"):
            return (cur["near"], cur["at"], "jump") if cur.get("near") in locs else (None, 0, None)
        q = self._tracker.qt or {}
        if q.get("selected") and not q.get("arrived") and time.time() - q["selected"] < 1800:
            return None, 0, None                      # mid-jump you're not at the old place any more
        w = self._tracker.where or {}
        wp = self._tracker.place_for_code(w["code"]) if w.get("code") else None
        options = []
        if wp in locs and w.get("at"):
            options.append((wp, w["at"], "log"))
        if cur.get("left") in locs and cur.get("at"):
            options.append((cur["left"], cur["at"], "left"))
        return max(options, key=lambda o: o[1]) if options else (None, 0, None)

    def get_live(self):
        with self._lock:
            t = time.time()
            game_on = self._game_on()
            if not game_on and self._player:
                # The game closed that reading is from the last session and you'll spawn somewhere else.
                self._player = self._player_t = self._player_sys = None
                self._last_fix = self._sys_override = None
            p, psys = self._player, self._player_sys
            ptime, approx = self._player_t, None
            cur = self._tracker.cur or {}
            # The log knows where you are and that's newer than your last /showlocation show you at
            # that place (approximate) until a real reading comes in. Keeps the route line drawn.
            spot, spot_at, how = self._log_spot(cur) if game_on else (None, 0, None)
            if spot and (not p or spot_at > self._player_t):
                L = self._db.locations[spot]
                p, psys, ptime, approx = self._db.global_pos(L, t), L.system, t, L.name
            # The log says you're in another system since then (you went through a gateway): you're at
            # the gateway on this side until a /showlocation says otherwise.
            w = self._tracker.where or {}
            wsys = w.get("system")
            if game_on and psys and wsys in nav_core.SYSTEMS and wsys != psys and (w.get("at") or 0) > (ptime or 0):
                came = next(iter(gateways._gate_names(self._db, wsys, psys)), None)
                L = self._db.locations.get(came) if came else None
                if L is not None:
                    p, psys, ptime, approx = self._db.global_pos(L, t), wsys, t, L.name
                    spot_at = w.get("at") or t
                else:
                    p, psys = None, wsys
            if game_on:
                self._auto_arrive(cur)
            self._prune_finished_tasks()
            self._ensure_gates(psys)
            stops = self._stops()
            names = [st["place"] for st in stops]
            live = {"now": t, "static_version": self._static_version, "photos_version": getattr(self, "_photos_version", 0), "route": names,
                    "player": None, "next": None, "legs": [], "total": 0.0, "guide": None,
                    "contracts": [], "contracts_version": self._tracker.version,
                    "log": {"path": self._tracker.log_path, "status": self._tracker.status,
                            "clear_on_start": bool(self._settings.get("clear_log_on_start", True)),
                            "uex_token": bool(self._uex.token),
                            "game_running": self._tracker.game_running, "note": self._tracker.log_note,
                            "cleared": self._log_cleared},
                    "where": self._tracker.where,
                    "travel": self._travel_view(cur, t) if game_on else None,
                    "arrived": self._arrived_note if game_on else None, "game_off": not game_on}
            if p:
                body = self._db.body_near(p, psys)
                how = getattr(self, "_sys_how", None) or ("log", "", None)
                info = {"pos": p, "t": ptime, "age": t - (spot_at if approx else ptime), "system": psys, "body": None,
                        "sys_how": how[0], "sys_from": how[1], "sys_at": how[2],
                        "approx": approx, "approx_how": how if approx else None}
                if body:
                    local = body.to_local(p, ptime)
                    lat, lon, alt = body.lat_lon_alt(local)
                    info.update(body=body.name, lat=lat, lon=lon, alt=alt, local=local)
                live["player"] = info
            tc = ptime if p else t   # evaluate at the moment of the reading (or now, for a logged arrival)
            live["legs"] = self._db.route_length(p, psys, names, tc)
            live["total"] = sum(d for d in live["legs"] if d)
            if names:
                loc = self._db.locations[names[0]]
                pad = loc.pad if loc.pad != "unknown" else (getattr(self, "_community_pads", {}) or {}).get(loc.name) or (
                    services.pad_from(self._services[loc.name]["amenities"]) if loc.name in self._services else "unknown")
                nxt = {"name": loc.name, "pad": pad or "unknown", "body": loc.body, "system": loc.system}
                if p:
                    leg = self._db.leg(p, psys, loc, tc)
                    nxt.update(distance=leg.distance_m, heading=leg.heading_deg, surface=leg.surface_distance_m,
                               other_system=loc.system != psys)
                live["next"] = nxt
            if self._guide:
                live["guide"] = self._db.guidance(self._db.locations[self._guide], p, psys, tc)
            self._try_autocal()   # also when the log event arrives after the reading
            w = self._tracker.where or {}
            live["autoloc"] = self._sender.status()
            up = self._update
            if up and up.get("available") and up.get("version") != self._settings.get("skip_update"):
                live["update"] = {"version": up["version"], "stage": self._updater.progress().get("stage")}
            live["datarunner"] = {"shots": len(self._dr_shots), "seq": self._dr_seq, "job": self._dr_job.get("n"),
                                 "job_state": self._dr_job.get("state"),
                                 "has_secret": bool(self._dr_cfg().get("secret"))}
            live["calibration"] = self._calibration
            live["calib_suggest"] = self._calib_suggestion()
            live["at_place"] = ({"name": self._tracker.place_for_code(w["code"]), "code": w["code"], "at": w.get("at")}
                                if w.get("code") else None)
            self._assign_turn_ins(p, psys, tc)
            live["contracts"] = self._contracts_view(p, psys, tc)
            live["stop_roles"], live["route_warning"] = self._stop_roles(stops, live["contracts"])
            return live

    # ------------------------------------------------------------ route tasks
    def _stops(self):
        """Consecutive tasks at the same place, merged into stops."""
        out = []
        for task in self._route:
            if out and out[-1]["place"] == task["place"]:
                out[-1]["tasks"].append(task)
            else:
                out.append({"place": task["place"], "tasks": [task]})
        return out

    def _set_from_stops(self, stops):
        self._route = [task for st in stops for task in st["tasks"]]

    def _task_ids(self):
        return {t["task"] for t in self._route}

    # Stops Quantum adds itself so a route can cross systems: the gateway to fly to before each jump.
    GATE = "gate"           # the gateway you fly to and jump from
    GATE_IN = "gate-in"     # the gateway you come out at in the next system
    GATES = (GATE, GATE_IN)

    def _ensure_gates(self, start_sys=None):
        """Put a gateway stop before every change of system in the route (and before the first stop, if
        it's in another system from you), and take away ones no longer needed: after you've jumped, or
        when the stops around them changed. Returns True if the route changed."""
        before = [(t["place"], t["task"]) for t in self._route]
        tasks = [t for t in self._route if t["task"] not in self.GATES]
        if not tasks:
            self._route = []
            return bool(before)
        cur = start_sys or self._db.locations[tasks[0]["place"]].system
        out = []
        for t in tasks:
            L = self._db.locations.get(t["place"])
            if L is not None and L.system and cur and L.system != cur:
                hop_from = cur
                for g in gateways.gate_path(self._db, cur, L.system) or []:
                    if not out or out[-1]["place"] != g:
                        out.append({"place": g, "task": self.GATE})
                    came = gateways.arrival(self._db, g, hop_from)        # where the jump comes out
                    if came and came != t["place"]:
                        out.append({"place": came, "task": self.GATE_IN})
                    hop_from = gateways.leads_to(g)
            out.append(t)
            if L is not None and L.system:
                cur = L.system
        self._route = out
        if [(t["place"], t["task"]) for t in out] != before:
            self._save_settings()
            return True
        return False

    def _arrive_at(self, prev, system):
        """For route legs: where you come out in `system` after jumping at stop `prev` (a gateway)."""
        name = gateways.arrival(self._db, prev, self._db.locations[prev].system) if prev in self._db.locations else None
        loc = self._db.locations.get(name) if name else None
        return loc.pos if loc is not None and loc.pos is not None and loc.system == system else None

    def _prune_finished_tasks(self):
        """Drop contract tasks whose objective is done, failed or gone, and move tasks whose objective
        now resolves to a different place (e.g. after a marker was put on the right planet)."""
        keep, changed = [], False
        for t in self._route:
            if t["task"] != "visit" and t["task"] not in self.GATES:
                cid, _, oid = t["task"].partition("|")
                c = self._tracker.get(cid)
                o = next((o for o in c.objectives if o.id == oid), None) if c else None
                if not o or o.status != "active" or c.status != "active" or not is_tracked(c):
                    changed = True
                    continue
                place = self._existing_place(o) or self._objective_place(c, o)
                if not place and need_item(o.text):     # turn-in emporium not placed yet
                    changed = True
                    continue
                if place and place != t["place"]:
                    t["place"], changed = place, True
            keep.append(t)
        if changed:
            self._route = keep
            self._drop_orphan_mission_stops()
            self._save_settings()

    def _drop_orphan_mission_stops(self):
        used = {t["place"] for t in self._route} | ({self._guide} if self._guide else set())
        for c in self._tracker.contracts.values():
            if not is_tracked(c):
                continue
            for o in c.objectives:
                if o.status == "active" and c.status == "active":
                    p = self._existing_place(o)
                    if p:
                        used.add(p)
        gone = [n for n, l in self._db.locations.items() if l.source == "mission" and n not in used]
        for n in gone:
            self._db.locations.pop(n)
        if gone:
            self._db.save()
            self._static_version += 1

    def _stop_roles(self, stops, contracts):
        """Per stop what you do there. Also flags a delivery planned before its pickup."""
        by_id = {c["id"]: c for c in contracts}
        roles, pos = [], {}
        for i, st in enumerate(stops):
            r = []
            for t in st["tasks"]:
                if t["task"] == "visit":
                    continue
                if t["task"] == self.GATE:
                    r.append({"kind": "gate", "to": gateways.leads_to(t["place"])})
                    continue
                if t["task"] == self.GATE_IN:
                    r.append({"kind": "gate-in", "from": gateways.leads_to(t["place"])})
                    continue
                cid, _, oid = t["task"].partition("|")
                c = by_id.get(cid)
                o = next((o for o in c["objectives"] if o["id"] == oid), None) if c else None
                if o:
                    r.append({"kind": o["kind"], "cargo": c.get("subtitle", ""), "contract": cid})
                    pos[t["task"]] = i
            roles.append(r)
        warning = None
        for c in contracts:
            picks = [pos[f"{c['id']}|{o['id']}"] for o in c["objectives"] if o["kind"] == "pickup" and f"{c['id']}|{o['id']}" in pos]
            drops = [pos[f"{c['id']}|{o['id']}"] for o in c["objectives"] if o["kind"] == "dropoff" and f"{c['id']}|{o['id']}" in pos]
            if picks and drops and min(drops) < max(picks):
                warning = f"{c.get('subtitle') or c['name']} is delivered before it's picked up. Plan the route to fix the order."
        return roles, warning

    # ------------------------------------------------------------ contract helpers
    def _existing_place(self, o):
        """A route-able place name for an objective, without creating anything."""
        loc = o.get("location") if isinstance(o, dict) else o.location
        marker = o.get("marker") if isinstance(o, dict) else o.marker
        if loc and loc in self._db.locations:
            return loc
        if marker:
            for l in self._db.locations.values():
                if l.source == "mission" and l.body == marker.get("body") and dist(l.pos, marker["pos"]) < 50:
                    return l.name
        return None

    def _objective_global(self, o, t):
        place = self._existing_place(o)
        if place:
            loc = self._db.locations[place]
            return self._db.global_pos(loc, t), loc.system, loc
        m = o.get("marker")
        if m and not m.get("body"):                     # rest stop at a Lagrange point global position
            loc = Location("marker", "space", tuple(m["pos"]), None, system=m["system"])
            return loc.pos, m["system"], loc
        if m and m["body"] in self._db.bodies:
            b = self._db.bodies[o["marker"]["body"]]
            loc = Location("marker", "surface", tuple(o["marker"]["pos"]), b.name, system=b.system)
            return b.to_global(loc.pos, t), b.system, loc
        return None, None, None

    def _emporium_pos(self, name, t):
        """Where a Wikelo emporium is its own position once placed, else its planet's (good enough to
        tell which one is closest)."""
        L = self._db.locations.get(name)
        if L:
            return self._db.global_pos(L, t)
        b = self._db.bodies.get(gateways.near_body(name) or "")
        return b.center if b else None

    def _assign_turn_ins(self, p, psys, t):
        """Collection contracts (Wikelo) can be handed in at any emporium: pick the one closest to you,
        unless you chose one. The choice sticks, so the route doesn't jump around as you fly."""
        emp = gateways.WIKELO
        for c in list(self._tracker.contracts.values()):
            if c.status != "active" or not is_collection(c) or not is_tracked(c):
                continue
            changed = False
            for o in c.objectives:        # you typed a shop as the item's place that's where you get it
                if need_item(o.text) and o.location and o.location not in emp and o.found == "manual":
                    self._tracker.set_item_source(c.id, o.id, o.location)
                    o.location, o.found, changed = None, "", True
            choice = c.turn_in if c.turn_in in emp else None
            if not choice and p:
                ref = p if psys == "Stanton" else (
                    self._db.locations["Pyro Gateway"].pos if "Pyro Gateway" in self._db.locations else p)
                ranked = [(dist(g, ref), n) for n in emp if (g := self._emporium_pos(n, t))]
                if ranked:
                    choice = min(ranked)[1]
                    self._tracker.set_turn_in(c.id, choice, "nearest")
            target = choice if choice in self._db.locations else None   # placed ones only are routable
            for o in c.objectives:
                if need_item(o.text) and o.status == "active" and o.location != target:
                    o.location, o.found, changed = target, ("turnin" if target else ""), True
            if changed:
                with self._tracker.lock:
                    self._tracker._changed()
        self._prune_finished_tasks()

    def set_turn_in(self, cid, place):
        with self._lock:
            if place not in gateways.WIKELO:
                return {"ok": False, "error": "Pick one of the Wikelo Emporiums"}
            self._tracker.set_turn_in(cid, place, "manual")
            return {"ok": True}

    def set_item_source(self, cid, oid, place):
        with self._lock:
            if place and place not in self._db.locations:
                return {"ok": False, "error": "Pick a place from the suggestions"}
            ok = self._tracker.set_item_source(cid, oid, place or None)
            if ok:
                self._prune_finished_tasks()
            return {"ok": ok} if ok else {"ok": False, "error": "That item isn't open any more"}

    def contract_wiki(self, cid):
        """The Star Citizen Wiki's details for one of your contracts: payout range, reputation, cargo and
        the places the mission can use. {ok, found, info} (found False when the wiki doesn't have it)."""
        c = next((x for x in self._tracker.snapshot() if x["id"] == cid), None)
        if not c:
            return {"ok": False, "error": "That contract isn't in the log any more"}
        try:
            info = self._missions.lookup(c.get("code"), c.get("name"), c.get("system"))
        except Exception:
            return {"ok": False, "error": "The Star Citizen Wiki couldn't be reached. Try again in a minute"}
        return {"ok": True, "found": bool(info), "info": info}

    def _contracts_view(self, p, psys, tc):
        view = self._tracker.snapshot()
        for c in view:
            ids = self._task_ids()
            for o in c["objectives"]:
                o["place"] = self._existing_place(o)
                o["in_route"] = f"{c['id']}|{o['id']}" in ids
            tr = c.get("tracking")
            if not tr or c["status"] != "active":
                continue
            # "Out for delivery" comes from you: a route set in game to the drop-off (Game.log), Guide on
            # the drop-off here, or the "Out for delivery" button. Moving away from the elevator doesn't.
            # How far is the drop-off?
            drop = next((o for o in c["objectives"] if o["kind"] == "dropoff" and o["status"] == "active"), None)
            if drop:
                tr["dest"] = drop["place"] or drop["location"]
                if p:
                    g, sysname, loc = self._objective_global(drop, tc)
                    if loc is not None:
                        leg = self._db.leg(p, psys, loc, tc)
                        tr["to_go"] = leg.surface_distance_m if leg.surface_distance_m is not None else leg.distance_m
                        tr["other_system"] = sysname != psys
        return view

    def _precedence(self):
        """Task pairs (pickup, drop-off) of the same contract: the pickup must come first."""
        ids = self._task_ids()
        pairs = []
        for c in self._tracker.snapshot():
            if c["status"] != "active":
                continue
            picks = [f"{c['id']}|{o['id']}" for o in c["objectives"] if o["kind"] == "pickup" and o["status"] == "active"]
            drops = [f"{c['id']}|{o['id']}" for o in c["objectives"] if o["kind"] == "dropoff" and o["status"] == "active"]
            pairs += [(a, b) for a in picks if a in ids for b in drops if b in ids]
        return pairs

    def _optimize_tasks(self):
        """Reorder the tasks. Each task is a node (its place's position) tasks at the same place are
        zero distance apart, so they end up together unless a revisit is genuinely needed."""
        now = time.time()
        self._route = [t for t in self._route if t["task"] not in self.GATES]
        if not self._route:
            return [], []
        first = self._db.locations[self._route[0]["place"]]
        start = self._player if self._player else self._db.global_pos(first, now)
        ssys = self._player_sys if self._player else first.system
        keys = [f"{i}:{t['task']}" for i, t in enumerate(self._route)]
        place_of = {k: t["place"] for k, t in zip(keys, self._route)}
        by_task = {t["task"]: k for k, t in zip(keys, self._route) if t["task"] != "visit"}
        prec = [(by_task[a], by_task[b]) for a, b in self._precedence() if a in by_task and b in by_task]
        order = self._db.optimize(start, ssys, keys, now, prec, place_of=place_of)
        task_of = dict(zip(keys, self._route))
        self._route = [task_of[k] for k in order]
        self._ensure_gates(ssys)
        names = [st["place"] for st in self._stops()]
        legs = self._db.route_length(start if self._player else None, ssys, names, now)
        return names, legs

    # ------------------------------------------------------------ route
    def add_stops(self, names):
        with self._lock:
            have = {t["place"] for t in self._route}
            for n in names:
                if n in self._db.locations and n not in have:
                    self._route.append({"place": n, "task": "visit"})
                    have.add(n)
            self._ensure_gates(self._player_sys)
            self._save_settings()

    def set_route(self, names):
        with self._lock:
            self._route = [{"place": n, "task": "visit"} for n in names if n in self._db.locations]
            self._ensure_gates(self._player_sys)
            self._save_settings()

    def move_stop(self, frm, to):
        """Drag and drop in the route list: move stop `frm` to position `to`."""
        with self._lock:
            stops = self._stops()
            if 0 <= frm < len(stops) and 0 <= to < len(stops):
                st = stops.pop(frm)
                stops.insert(to, st)
                self._set_from_stops(stops)
                self._ensure_gates(self._player_sys)
                self._save_settings()
            return {"ok": True}

    def remove_stop(self, index):
        with self._lock:
            stops = self._stops()
            if 0 <= int(index) < len(stops):
                gone = stops[int(index)]
                if all(t["task"] in self.GATES for t in gone["tasks"]):
                    return {"ok": False, "error": "That gateway is how the route gets to the next system. "
                                                  "Remove the stops after it instead"}
                stops.pop(int(index))
                self._set_from_stops(stops)
                self._ensure_gates(self._player_sys)
                self._save_settings()
            return {"ok": True}

    def remove_place(self, name):
        with self._lock:
            self._route = [t for t in self._route if t["place"] != name]
            self._save_settings()
            return {"ok": True}

    def clear_route(self):
        with self._lock:
            self._route = []
            self._save_settings()

    def arrived(self):
        with self._lock:
            stops = self._stops()
            if stops:
                self._set_from_stops(stops[1:])
            self._save_settings()

    def optimize_route(self):
        with self._lock:
            if not self._route:
                return {"ok": False, "error": "Add some stops first"}
            before = sum(d for d in self.get_live()["legs"] if d)
            _, legs = self._optimize_tasks()
            self._save_settings()
            return {"ok": True, "saved": before - sum(d for d in legs if d)}

    def _add_contract_tasks(self, c, oid=None):
        """Queue one task per active objective (pickups first). Returns how many were added."""
        ids, added = self._task_ids(), 0
        if not is_tracked(c):
            return 0
        order = {"pickup": 0, "goto": 1, "combat": 1, "dropoff": 2}
        for o in sorted(c.objectives, key=lambda o: order.get(o.kind, 1)):
            if o.status != "active" or (oid is not None and o.id != oid):
                continue
            tid = f"{c.id}|{o.id}"
            if tid in ids:
                continue
            place = self._objective_place(c, o)
            if place:
                self._route.append({"place": place, "task": tid})
                added += 1
        return added

    def plan_route(self, include_contracts=True):
        """Order the trip for the shortest distance that still collects each cargo before delivering it.
        With include_contracts, every active contract's pickups and drop-offs are added first."""
        with self._lock:
            added = 0
            self._assign_turn_ins(self._player, self._player_sys, time.time())
            if include_contracts:
                for c in list(self._tracker.contracts.values()):
                    if c.status == "active":
                        added += self._add_contract_tasks(c)
            if not self._route:
                return {"ok": False, "error": "Nothing to plan yet. Accept a contract or add some stops"
                        if include_contracts else "Add some stops first, or plan from the Contracts tab"}
            names, legs = self._optimize_tasks()
            bodies = []
            for n in names:
                l = self._db.locations[n]
                key = l.body or f"space ({l.system})"
                if not bodies or bodies[-1] != key:
                    bodies.append(key)
            self._save_settings()
            return {"ok": True, "added": added, "stops": len(names), "total": sum(d for d in legs if d),
                    "legs": legs, "bodies": bodies, "from_ship": self._player is not None,
                    "revisits": len(names) - len(set(names)),
                    "jumps": sum(1 for a, b in zip(names, names[1:])
                                 if self._db.locations[a].system != self._db.locations[b].system)}

    # ------------------------------------------------------------ waypoints & places
    def save_waypoint(self, name, notes="", pinned=True, pad="unknown"):
        with self._lock:
            name = (name or "").strip()
            if not name:
                return {"ok": False, "error": "Give the waypoint a name"}
            if not self._player:
                return {"ok": False, "error": "No position yet. Type /showlocation in game chat first"}
            loc = self._db.capture(name, self._player, self._player_t, self._player_sys, pad, notes, pinned)
            self._db_changed()
            return {"ok": True, "name": loc.name, "body": loc.body}

    # ---- station positions shared between Quantum users
    def _learned_places(self):
        """Positions for places the map is missing: your own /showlocation readings (places.json) win;
        other Quantum users' agreed readings (from the server, kept in community_places.json) fill
        the rest."""
        merged = dict(gateways.load_learned(COMMUNITY_PLACES_PATH))
        merged.update(gateways.load_learned(PLACES_PATH))
        return merged

    def _share_place(self, name):
        """Send a position you set to the server. Kept in settings until the server has it, and re-sent
        at start-up and with every map sync, so a server that's down or slow doesn't lose it."""
        entry = gateways.load_learned(PLACES_PATH).get(name)
        if not entry:
            return
        unsent = self._settings.setdefault("places_unsent", [])
        if name not in unsent:
            unsent.append(name)
            self._save_settings()

        def done(answered):
            if answered and name in (self._settings.get("places_unsent") or []):
                self._settings["places_unsent"].remove(name)
                self._save_settings()
        self._community.post_place(name, entry, self._dr_cfg().get("username"), on_done=done)

    def _resend_places(self):
        for name in list(self._settings.get("places_unsent") or []):
            if self._community.place_results.get(name, {}).get("state") != "sending":
                self._share_place(name)

    # ------------------------------------------------------------ encrypted backups
    # Fleet and swaps, waypoints, planned trade routes and mapped stations, encrypted on this PC with
    # keys made from your UEX Bearer Token (see backup.py) and kept on the Quantum server. Uploaded
    # within a minute of a change; brought back automatically on a fresh install once the token is
    # entered. Restoring only adds what's missing here, it never removes or overwrites anything.
    BACKUP_EVERY = 60

    def _backup_creds(self):
        token = (self._settings.get("uex_token") or "").strip()
        return token if token and self._community.url else None

    def _backup_payload(self):
        with self._lock:
            way = [asdict(l) for l in self._db.locations.values() if l.source == "user"]
        return {"v": 1, "fleet": self._settings.get("fleet") or [], "trade_runs": self._settings.get("trade_runs") or [],
                "waypoints": way, "places": gateways.load_learned(PLACES_PATH)}

    def _backup_state(self, **kw):
        st = self._settings.setdefault("backup", {})
        st.update(kw)
        self._save_settings()

    def backup_now(self, force=False):
        """Upload the backup if anything changed since the last one (or always, with force)."""
        token = self._backup_creds()
        if not token:
            return {"ok": False, "status": "no_key"}
        payload = self._backup_payload()
        fp = backup.fingerprint(payload)
        st = self._settings.get("backup") or {}
        k = backup.keys(token)
        if not force and st.get("hash") == fp and st.get("status") == "ok" and st.get("slot") == k["slot"]:
            return {"ok": True, "status": "unchanged"}
        try:
            blob = backup.encrypt(token, payload)
        except ValueError as e:
            self._backup_state(status="too_large", tried=int(time.time()))
            return {"ok": False, "status": "too_large", "error": str(e)}
        r = self._community.backup_put(k["slot"], k["auth"], blob)
        if r.get("status") == "ok":
            self._backup_state(hash=fp, at=int(time.time()), status="ok", slot=k["slot"])
            return {"ok": True, "status": "saved"}
        self._backup_state(status=r.get("status"), tried=int(time.time()))
        return {"ok": False, "status": r.get("status"), "error": r.get("detail")}

    def _local_empty(self):
        with self._lock:
            way = any(l.source == "user" for l in self._db.locations.values())
        return not (self._settings.get("fleet") or self._settings.get("trade_runs") or way)

    def _backup_restore_if_empty(self):
        try:
            if self._local_empty():
                r = self.backup_restore()
                if r.get("ok") and r.get("added"):
                    self._backup_note = f"Restored from your backup: {r['summary']}"
        except Exception as e:
            print("backup restore:", e, flush=True)

    def backup_restore(self, token=None):
        """Fetch, decrypt and merge the backup: adds missing ships, routes, waypoints and stations.
        token: an older UEX Bearer Token's backup to bring in (see _backup_move); default the current one."""
        token = token or self._backup_creds()
        if not token:
            return {"ok": False, "error": "Add your UEX Bearer Token first: backups are locked with it"}
        k = backup.keys(token)
        r = self._community.backup_get(k["slot"], k["auth"])
        st = r.get("status")
        if st == "no_backup":
            return {"ok": False, "error": "There's no backup for this UEX Bearer Token yet"}
        if st != "ok":
            return {"ok": False, "error": "The Quantum server couldn't be reached. Try again in a minute"}
        try:
            data = backup.decrypt(token, r["blob"])
        except Exception as e:
            return {"ok": False, "error": f"The backup couldn't be opened: {e}"}
        added = {"ships": 0, "loadouts": 0, "routes": 0, "waypoints": 0, "stations": 0}
        fleet = self._fleet()
        have = {f["uid"]: f for f in fleet}
        for f in data.get("fleet") or []:
            if not f.get("uid"):
                continue
            if f["uid"] not in have:
                fleet.append(dict(f, main=False)); added["ships"] += 1
                self._loadouts(fleet[-1])
                continue
            # A ship already here gets any loadout it's missing (by name), up to MAX_LOADOUTS; its own stay as they are
            mine = self._loadouts(have[f["uid"]])
            for lo in f.get("loadouts") or []:
                if not isinstance(lo, dict) or len(mine) >= self.MAX_LOADOUTS:
                    continue
                name = str(lo.get("name") or "").strip()
                if not name or any(x["name"].lower() == name.lower() for x in mine):
                    continue
                n = 1
                while f"l{n}" in {x["id"] for x in mine}:
                    n += 1
                mine.append({"id": f"l{n}", "name": name[:40], "loadout": lo.get("loadout") if isinstance(lo.get("loadout"), dict) else {},
                             "power": lo.get("power") if isinstance(lo.get("power"), dict) else {}})
                added["loadouts"] += 1
        if fleet and not any(f.get("main") for f in fleet):
            fleet[0]["main"] = True
        runs = self._settings.setdefault("trade_runs", [])
        have = {x.get("id") for x in runs}
        for x in data.get("trade_runs") or []:
            if x.get("id") and x["id"] not in have:
                runs.append(x); added["routes"] += 1
        self._save_settings()
        with self._lock:
            for d in data.get("waypoints") or []:
                if isinstance(d.get("name"), str) and d["name"] and d["name"] not in self._db.locations:
                    try:
                        loc = _from_dict(Location, d)
                        if loc.kind not in ("space", "surface") or len(loc.pos) != 3 or \
                                not all(isinstance(c, (int, float)) for c in loc.pos):
                            continue
                        loc.source = "user"                   # a backup only ever holds your own waypoints
                    except (TypeError, ValueError):
                        continue
                    self._db.locations[d["name"]] = loc; added["waypoints"] += 1
            places = gateways.load_learned(PLACES_PATH)
            for name, v in (data.get("places") or {}).items():
                if name not in places and isinstance(v.get("system"), str):
                    places[name] = v; added["stations"] += 1
            if added["stations"]:
                PLACES_PATH.write_text(json.dumps({"places": places}, indent=1), encoding="utf-8")
                _, self._unplaced = gateways.apply(self._db, self._learned_places())
                self._apply_uex_stations(offline=True)
            if added["waypoints"] or added["stations"]:
                self._db.save()
                self._db_changed()
        n = sum(added.values())
        words = [f"{v} {k if v != 1 else k[:-1]}" for k, v in added.items() if v]
        return {"ok": True, "added": n, "detail": added, "updated": r.get("updated"),
                "summary": ", ".join(words) if words else "nothing was missing"}

    def backup_status(self):
        st = self._settings.get("backup") or {}
        note, self._backup_note = getattr(self, "_backup_note", None), None
        return {"has_key": bool(self._settings.get("uex_token")), "on": bool(self._community.url),
                "at": st.get("at"), "status": st.get("status"), "note": note, "off": bool(self._settings.get("backup_off"))}

    def backup_delete(self):
        """Remove your backup from the server and stop backing up until turned back on."""
        token = self._backup_creds()
        if not token:
            return {"ok": False, "error": "No UEX Bearer Token saved"}
        k = backup.keys(token)
        r = self._community.backup_get(k["slot"], k["auth"], delete=True)
        if r.get("status") in ("deleted", "no_backup"):
            self._settings.pop("backup", None)
            self._settings["backup_off"] = True
            self._save_settings()
            return {"ok": True}
        return {"ok": False, "error": "The Quantum server couldn't be reached. Try again in a minute"}

    def backup_enable(self):
        self._settings.pop("backup_off", None)
        self._save_settings()
        threading.Thread(target=self.backup_now, kwargs={"force": True}, daemon=True).start()
        return self.backup_status()

    def _backup_loop(self):
        time.sleep(20)
        self._backup_restore_if_empty()
        while True:
            try:
                if not self._settings.get("backup_off"):
                    self.backup_now()
            except Exception as e:
                print("backup:", e, flush=True)
            time.sleep(self.BACKUP_EVERY)

    def place_result(self, name):
        """What the server said about the station position you just sent: live for everyone (trusted, or a
        second reading agreed), waiting for a second reading, still sending, or unreachable."""
        return self._community.place_results.get(gateways.learn_key(name)) or {"state": "none"}

    PLACES_SYNC_EVERY = 10 * 60          # s: how often shared station positions are fetched again

    def _sync_places(self):
        """Background: fetch the shared station positions at start, then every 10 minutes, and put any
        new ones on the map. A station two datarunners just agreed on shows up (and leaves the
        Not on the map yet list and the Jobs) without restarting Quantum."""
        time.sleep(3)                                          # let start-up finish first
        while True:
            try:
                self._resend_places()                          # positions the server didn't get yet
            except Exception as e:
                print("place resend:", e, flush=True)
            try:
                self._sync_places_once()
            except Exception as e:
                print("place sync:", e, flush=True)
            time.sleep(self.PLACES_SYNC_EVERY)

    def _game_build(self):
        """The game build (from Game.log), or the last one seen when the game isn't running."""
        b = str(self._tracker.build or "")
        if b and b != self._settings.get("last_build"):
            self._settings["last_build"] = b
            self._save_settings()
        return b or self._settings.get("last_build")

    def _apply_community_alignments(self):
        """Planet alignments datarunners agree on for this game build go live here: used for every planet
        or moon you haven't lined up yourself in this build (your own always wins)."""
        build = self._game_build()
        r = self._community.alignments(build) if build else None
        if not r:
            return
        self._align_server = dict(r, build=build, at=time.time())
        mine = self._settings.get("cal_build") or {}
        changed = False
        with self._lock:
            for name, a in r["agreed"].items():
                b = self._db.bodies.get(name)
                if not b or not can_align(b) or mine.get(name) == build:
                    continue
                if abs((a.get("period") or 0) - b.rotation_period_h) > 1e-4:
                    continue                                     # different day length in this map data
                if b.calibration_quality == "community" and abs(b.rotation_offset_deg - a["offset"]) < 1e-6:
                    continue
                b.rotation_offset_deg, b.epoch_utc = float(a["offset"]), float(a.get("epoch") or b.epoch_utc)
                b.calibrated, b.calibrated_at = True, float(a.get("at") or time.time())
                b.calibrated_place, b.calibration_quality = "Quantum datarunners", "community"
                changed = True
            if changed:
                self._static_version += 1

    def _sync_places_once(self):
        try:
            self._apply_community_alignments()
        except Exception as e:
            print("alignment sync:", e, flush=True)
        r = self._community.places()
        if r is None:
            return
        got, missing = r["places"], sorted(r["missing"])
        if r.get("pads", {}) != getattr(self, "_community_pads", None):          # pad sizes datarunners agree on
            self._community_pads = r.get("pads", {})
            with self._lock:
                self._static_version += 1
            try:
                saved = json.loads(COMMUNITY_PLACES_PATH.read_text(encoding="utf-8"))
                saved["pads"] = self._community_pads
                COMMUNITY_PLACES_PATH.write_text(json.dumps(saved, indent=1), encoding="utf-8")
            except (OSError, ValueError):
                pass
        # Once per start: re-send positions you set that the server doesn't list yet, in case an earlier
        # send never arrived (it's harmless if it did: the server keeps one reading per person).
        if not getattr(self, "_resent_mine", False):
            self._resent_mine = True
            for name in gateways.load_learned(PLACES_PATH):
                if name not in got and name not in (self._settings.get("places_unsent") or []):
                    self._share_place(name)
        if got == gateways.load_learned(COMMUNITY_PLACES_PATH) and missing == sorted(getattr(self, "_community_missing", ())):
            return
        self._community_missing = set(missing)
        try:
            COMMUNITY_PLACES_PATH.write_text(json.dumps({"places": got, "missing": missing, "pads": r.get("pads", {})},
                                                        indent=1), encoding="utf-8")
        except OSError:
            return
        with self._lock:
            ren, self._unplaced = gateways.apply(self._db, self._learned_places())
            self._renamed.update(ren)
            self._apply_uex_stations(offline=True)
            self._db.save()
            self._db_changed()

    def set_place_here(self, name):
        """You're docked at a gateway station: use your last /showlocation as its position."""
        with self._lock:
            pend = getattr(self, "_uex_pending", {})
            system = gateways.system_of(name) or pend.get(name)
            if not system:
                return {"ok": False, "error": "Only gateways, Wikelo and UEX-only places can be placed this way"}
            if name in pend:
                return self._place_uex_here(name, system)
            if not self._player or time.time() - self._player_t > 900:
                return {"ok": False, "error": "Type /showlocation in game chat while docked there"}
            if self._player_sys != system:
                return {"ok": False, "error": f"Your last reading is in {self._player_sys}, not {system}"}
            body = self._db.body_near(self._player, system)
            jump = name in gateways.JUMP_POINTS
            if body and (name in gateways.GATEWAYS or jump):  # gateways are far out; Wikelo's orbit planets
                return {"ok": False, "error": f"That reading is near {body.name}, not at the {'Gateway' if jump else 'station'}. "
                                              + ("Take it right at the jump point, before you fly in" if jump
                                                 else "Take it while docked at the station")}
            key = gateways.learn_key(name)
            gateways.save_learned(PLACES_PATH, key, system, self._player)
            self._share_place(key)
            _, self._unplaced = gateways.apply(self._db, self._learned_places())
            self._apply_uex_stations(offline=True)          # keep the UEX-only places alongside
            self._db.save()
            self._db_changed()
            return {"ok": True, "name": name}

    def _place_uex_here(self, name, system):
        """A place known only from UEX a surface outpost is stored relative to its moon or planet (it
        turns with it), a station by its position."""
        if not self._player or time.time() - self._player_t > 900:
            return {"ok": False, "error": "Type /showlocation in game chat while you're there"}
        if self._player_sys != system:
            return {"ok": False, "error": f"Your last reading is in {self._player_sys}, not {system}"}
        cur = self._unplaced.get(name) or self._db.locations.get(name)
        places = gateways.load_learned(PLACES_PATH)
        if cur and cur.kind == "surface" and cur.body:
            b = self._db.bodies.get(cur.body)
            near = self._db.body_near(self._player, system)
            if not b or not near or near.name != b.name:
                return {"ok": False, "error": f"That reading isn't on {cur.body}. Take it while you're at {name}"}
            # The reading itself is kept too (global position and time): the spot on the planet is worked
            # out from it with the planet's current alignment, so lining the planet up later doesn't move it.
            places[name] = {"system": system, "body": b.name, "local": list(b.to_local(self._player, self._player_t)),
                            "offset": b.rotation_offset_deg, "reading": {"pos": list(self._player), "t": self._player_t},
                            "at": time.time()}
        else:
            places[name] = {"system": system, "pos": list(self._player), "at": time.time()}
        PLACES_PATH.write_text(json.dumps({"places": places}, indent=1), encoding="utf-8")
        self._share_place(name)
        self._db.locations.pop(name, None)
        self._unplaced.pop(name, None)
        self._apply_uex_stations(offline=True)
        self._db_changed()
        return {"ok": True, "name": name}

    def update_location(self, name, pad=None, notes=None):
        with self._lock:
            loc = self._db.locations.get(name)
            if not loc:
                return {"ok": False}
            if pad is not None and pad != loc.pad:
                loc.pad = pad
                # Shared: shows for everyone once a second datarunner agrees (or a trusted one says so).
                # "unknown" takes your report back.
                if pad in ("unknown", "none", "vehicle", "small", "medium", "large", "xl", "hangar") and loc.source != "user":
                    self._community.post_pad(name, pad, self._dr_cfg().get("username"))
            if notes is not None:
                loc.notes = notes
            self._db.save()
            self._static_version += 1
            return {"ok": True}

    def rename_location(self, old, new):
        with self._lock:
            new = (new or "").strip()
            loc = self._db.locations.get(old)
            if not loc or not new:
                return {"ok": False, "error": "Enter a name"}
            if new != old and new in self._db.locations:
                return {"ok": False, "error": f"A place called {new} already exists"}
            self._db.locations.pop(old)
            loc.name = new
            self._db.locations[new] = loc
            for t in self._route:
                if t["place"] == old:
                    t["place"] = new
            if self._guide == old:
                self._guide = new
            self._db.save()
            self._db_changed()
            return {"ok": True}

    def set_pinned(self, name, pinned):
        with self._lock:
            if name in self._db.locations:
                self._db.locations[name].pinned = bool(pinned)
                self._db.save()
                self._static_version += 1
            return {"ok": True}

    def delete_location(self, name):
        with self._lock:
            if self._db.locations.pop(name, None):
                self._db.save()
                self._db_changed()
            return {"ok": True}

    def set_guide(self, name):
        with self._lock:
            self._guide = name if name in self._db.locations else None
            self._save_settings()
            return {"ok": True}

    def calibrate_at(self, name):
        """The player is standing at `name`: fix that planet's rotation offset."""
        with self._lock:
            loc = self._db.locations.get(name)
            if not self._player:
                return {"ok": False, "error": "Type /showlocation in game chat while standing there"}
            if not loc or loc.kind != "surface":
                return {"ok": False, "error": "Calibration needs a place on a planet or moon"}
            if loc.system != self._player_sys:
                return {"ok": False, "error": f"You're in {self._player_sys}, not {loc.system}"}
            if not can_align(self._db.bodies.get(loc.body)):
                return {"ok": False, "error": f"{loc.body} has no landable surface to line up"}
            res = self._db.calibrate(loc.body, loc, self._player, self._player_t)
            if res["ok"]:
                self._record_cal("manual", loc.body, loc.name, res["correction"])
                self._static_version += 1
            return res

    def set_autoloc(self, hotkey=None, interval=None, open_chat=None, loc_hotkey=None, *_ignored):
        """hotkey: show/hide Quantum. loc_hotkey: type /showlocation. (interval is ignored: no automatic
        /showlocation any more.)"""
        self._sender.configure(hotkey, 0, open_chat, None, True, loc_hotkey, False)
        st = self._sender.status()
        self._settings["autoloc"] = {k: st[k] for k in ("hotkey", "loc_hotkey", "open_chat")}
        self._settings.setdefault("datarunner", {})["shot_hotkey"] = st["shot_hotkey"]   # may have lost a clash
        self._save_settings()
        return st

    def send_bug_report(self, message, contact=""):
        """Settings > Report a bug: sent to the Quantum server with your UEX name (if you've added your
        Secret Key), the Quantum and game versions, and how to reach you if you chose to say."""
        message, contact = str(message or "").strip(), str(contact or "").strip()
        if len(message) < 5:
            return {"ok": False, "error": "Describe the bug first"}
        try:
            game = " ".join(x for x in self._dr_game_build()[:2] if x) or None
        except Exception:
            game = None
        if self._tracker.build:
            game = f"{game or '?'} (build {self._tracker.build})"
        user = self._dr_cfg().get("username") or (self._dr_cfg().get("uex_user") or {}).get("username")
        r = self._community.post_bug({"message": message[:5000], "contact": contact[:200] or None, "username": user,
                                      "app_version": updater.VERSION, "game_version": game})
        if r.get("status") == "ok":
            return {"ok": True}
        return {"ok": False, "error": {"off": "Community features are turned off, so there's nowhere to send it",
                                       "requests_limit_reached": "Too many bug reports from this connection. Try again in an hour",
                                       "banned": "This UEX account can't send reports to Quantum"}.get(
            r.get("status"), "The Quantum server couldn't be reached. Try again in a minute")}

    def set_option(self, key, value):
        """Simple on/off settings shown in the Settings panel."""
        if key not in ("clear_log_on_start",):
            return {"ok": False}
        self._settings[key] = bool(value)
        self._save_settings()
        return {"ok": True}

    def test_autoloc(self, delay=5):
        self._sender.send_after(delay)
        return {"ok": True}

    def get_services(self, name):
        """Services, jurisdiction and in-game description for one place (None if unknown), plus fuel
        prices from UEX when there's a token."""
        r = self._services.get(name)
        out = dict(r, pad=services.pad_from(r["amenities"])) if r else None
        fuel = self._fuel_at(name)
        if fuel:
            out = dict(out or {"amenities": [], "pad": None}, fuel=fuel)
        return out

    # ------------------------------------------------------------ UEX: trade data
    def _uex_call(self, fn):
        try:
            return fn()
        except uex.UexError as e:
            return {"ok": False, "error": str(e)}

    def _dist_from_you(self, place):
        L = self._db.locations.get(place) if place else None
        if not L or not L.pos or not self._player or L.system != self._player_sys:
            return None
        return dist(self._db.global_pos(L, time.time()), self._player)

    def _fuel_at(self, place):
        if not self._uex.token:
            return None
        try:
            places = self._uex.place_map(self._db.locations)
            rows, _ = self._uex.get("fuel_prices_all")
        except uex.UexError:
            return None
        return [{"what": r["commodity_name"], "price": r["price_buy"]} for r in rows
                if places.get(r["id_terminal"]) == place and r.get("price_buy")] or None

    def set_uex_token(self, token):
        token = (token or "").strip()
        if not token:
            self._uex.token = ""
            self._settings.pop("uex_token", None)
            self._save_settings()
            return {"ok": True, "cleared": True}
        try:
            self._uex.test(token)               # a wrong token is reported and dropped, never kept
        except uex.UexError as e:
            return {"ok": False, "error": str(e) + (". Your saved token is still in use" if self._uex.token else "")}
        old = (self._settings.get("uex_token") or "").strip()
        self._uex.token = token
        self._settings["uex_token"] = token
        self._save_settings()
        self._refresh_uex_places()
        if old and old != token and self._community.url:
            threading.Thread(target=self._backup_move, args=(old,), daemon=True).start()   # a new token
        else:
            threading.Thread(target=self._backup_restore_if_empty, daemon=True).start()   # a fresh install
        return {"ok": True}

    def _backup_move(self, old):
        """You replaced your UEX Bearer Token (a new UEX app, or the old one regenerated). Backups are
        locked with the token, so bring in what the old token's backup has, save it all again under the
        new token, and remove the old one: the backup follows you to the new token instead of being lost."""
        try:
            r = self.backup_restore(token=old)
            if r.get("ok") and r.get("added"):
                self._backup_note = f"Brought in from your previous backup: {r['summary']}"
            if self._settings.get("backup_off"):
                return
            if self.backup_now(force=True).get("ok") and (r.get("ok") or "no backup" in (r.get("error") or "")):
                k = backup.keys(old)
                self._community.backup_get(k["slot"], k["auth"], delete=True)
            elif not r.get("ok"):
                self._backup_restore_if_empty()
        except Exception as e:
            print("backup move:", e, flush=True)

    def _refresh_uex_places(self):
        """Fetch UEX's station list and add the stations Quantum lacks (renames carry into the route)."""
        with self._lock:
            ren = self._apply_uex_stations(offline=False)
            if ren:
                for t in self._route:
                    t["place"] = ren.get(t["place"], t["place"])
                if self._guide in ren:
                    self._guide = ren[self._guide]
                self._save_settings()
            self._db_changed()

    def uex_status(self):
        if not self._uex.token:
            return {"ok": False, "token": False}
        if not (HERE / "uex_cache" / "space_stations.json").exists():
            try:
                self._refresh_uex_places()        # token from before stations were added: fetch them once
            except Exception:
                pass
        st = dict(self._uex.status(self._db.locations), token=True)
        if st.get("ok"):
            # Places reported as not existing in the game (by you, or agreed by datarunners) aren't
            # "not on the map": they're left out, and only counted.
            hk = self._hidden_keys()
            gone = [n for n in st["unmatched"] if _place_key(n) in hk]
            st["terminals"] -= sum(st.get("unmatched_terms", {}).get(n, 1) for n in gone)   # not in the game: not counted
            st["unmatched"] = [n for n in st["unmatched"] if _place_key(n) not in hk]
            st.pop("unmatched_terms", None)
            # Ones Quantum knows but can't place yet: they're "Map a station" jobs, waiting for a /showlocation
            pending = {services._key(n): n for n in self._unplaced}
            st["needs_position"] = sorted(pending[services._key(n)] for n in st["unmatched"] if services._key(n) in pending)
            st["unmatched"] = [n for n in st["unmatched"] if services._key(n) not in pending]
        return st

    # ------------------------------------------------------------ datarunner (UEX price reports)
    def _dr_cfg(self):
        return self._settings.setdefault("datarunner", {})

    def _dr_log(self, text):
        self._sender._event(f"Screenshot: {text}")       # shows in Settings > Log, for troubleshooting

    def _dr_timed(self, what, fn, timeout=2.0):
        """Run a window call with a time limit. Some of them wait on another program (or on Quantum's own
        window thread), and a call that never returns must not stop the screenshot."""
        box = {}
        th = threading.Thread(target=lambda: box.setdefault("r", fn()), daemon=True)
        th.start()
        th.join(timeout)
        if th.is_alive():
            self._dr_log(f"{what} didn't respond, carrying on")
        return box.get("r")

    def _dr_take_shot(self, from_button=False):
        """Add a screenshot of the game to the report being prepared.
        Quantum minimises itself if it's in the way, the game is brought forward, the shot is taken,
        and Quantum is put back the way it was (on top again, or pinned if it was the F9 overlay).
        Every window call is non-blocking or time-limited, so this always finishes."""
        if os.name != "nt":
            return datarunner.capture()                    # raises: Windows only
        u = overlay.user32
        u.ShowWindowAsync.argtypes = (wintypes_hwnd_type(), ctypes_int_type())
        ASYNC = 0x4000                                     # SWP_ASYNCWINDOWPOS: post it, don't wait
        keep = overlay.SWP_NOMOVE | overlay.SWP_NOSIZE | 0x0010   # + SWP_NOACTIVATE
        # The exact title first: a browser tab about Star Citizen also has "star citizen" in its title.
        wins = datarunner.game_windows()                  # biggest "Star Citizen" window = the game
        self._dr_log("game windows: " + ("; ".join(f"{w}×{h} at {x},{y}" for _, (x, y, w, h) in wins) or "none"))
        game = wins[0][0] if wins else None
        if not game:
            raise datarunner.DatarunnerError("Star Citizen isn't open. Open the terminal in game first")
        me = u.FindWindowW(None, overlay.WINDOW_TITLE)
        showing = bool(me) and bool(u.IsWindowVisible(me)) and not u.IsIconic(me)
        pinned = showing and overlay._is_overlay_up(me)
        hide = showing and (from_button or pinned)
        try:
            if hide:
                self._dr_log("minimising Quantum")
                if pinned:
                    u.SetWindowPos(me, overlay.HWND_NOTOPMOST, 0, 0, 0, 0, keep | ASYNC)
                u.ShowWindowAsync(me, 6)                   # SW_MINIMIZE
            if u.IsIconic(game):
                u.ShowWindowAsync(game, 9)                 # SW_RESTORE
            self._dr_log("bringing Star Citizen forward")
            u.SetWindowPos(game, wintypes_hwnd(0), 0, 0, 0, 0, keep | ASYNC)   # HWND_TOP
            u.SetForegroundWindow(game)
            time.sleep(0.8 if hide else 0.15)              # minimise animation, then the game redraws
            self._dr_log("capturing")
            shot = datarunner.capture(game)
        finally:
            if hide:
                self._dr_restore_me(me, pinned)
        return shot

    def _dr_restore_me(self, me, pinned):
        """Put Quantum back in view after a screenshot."""
        u = overlay.user32
        self._dr_log("bringing Quantum back")
        # pywebview's own restore tells WebView2 it's visible again (a plain restore can leave it blank)
        self._dr_timed("restoring the window", lambda: webview.windows[0].restore(), 2.0)
        if u.IsIconic(me):
            u.ShowWindowAsync(me, 9)                       # SW_RESTORE
        keep = overlay.SWP_NOMOVE | overlay.SWP_NOSIZE | 0x0010 | 0x0040 | 0x4000   # + SHOWWINDOW, ASYNC
        # Raising a window above the game needs no focus rights: pin it for a moment, then unpin
        # (or leave it pinned if it was up as the F9 overlay).
        u.SetWindowPos(me, overlay.HWND_TOPMOST, 0, 0, 0, 0, keep)
        if not pinned:
            time.sleep(0.15)
            u.SetWindowPos(me, overlay.HWND_NOTOPMOST, 0, 0, 0, 0, keep)
        self._dr_timed("focusing Quantum", lambda: overlay._force_foreground(me), 1.5)
        self._dr_timed("redrawing", self._nudge_redraw, 1.5)

    def _dr_start_job(self, from_button=False):
        """Screenshot, then read it, on a thread of its own: the page polls dr_job() and is never left
        waiting on a call that can't return."""
        with self._lock:
            if self._dr_job.get("state") == "shooting" and time.time() - self._dr_job.get("started", 0) < 25:
                return "busy with the last screenshot"
            self._dr_job = {"state": "shooting", "n": self._dr_job.get("n", 0) + 1, "started": time.time(),
                            "from_button": from_button}
        threading.Thread(target=self._dr_run_job, args=(from_button,), daemon=True).start()
        return "taking a screenshot"

    def _set_job(self, **kw):
        with self._lock:
            self._dr_job.update(kw)

    def _dr_run_job(self, from_button):
        try:
            shot = self._dr_take_shot(from_button)
        except Exception as e:                            
            self._dr_log(f"failed ({e})")
            return self._set_job(state="error", error=str(e))
        with self._lock:
            self._dr_shots = (self._dr_shots + [shot])[-datarunner.MAX_SHOTS:]
            self._dr_seq += 1
            index = len(self._dr_shots) - 1
        rx, ry = getattr(shot, "rect", (0, 0, 0, 0))[:2]
        self._dr_log(f"saved {shot.w}×{shot.h} ({getattr(shot, 'how', '?')}) from {rx},{ry}")
        self._set_job(state="done", index=index)

    def dr_capture(self, delay=0):
        """Screenshot button (the page counts down first). Returns at once; poll dr_job()."""
        return {"ok": True, "text": self._dr_start_job(from_button=True)}

    def dr_job(self):
        """Where the last screenshot is up to."""
        with self._lock:
            job = dict(self._dr_job)
        if job.get("state") == "shooting" and time.time() - job.get("started", 0) > 25:
            job.update(state="error", error="The screenshot took too long. Settings > Log shows the step it stopped at")
        return job

    def dr_status(self):
        c = self._dr_cfg()
        return {"live": self._dr.live, "has_secret": bool(c.get("secret")), "shot_hotkey": self._sender.shot_hotkey,
                "folder": str(self._dr.test_dir), "shots": len(self._dr_shots), "shot_policy": self._dr_shot_policy()}

    # UEX wants a screenshot with every report during a new datarunner's 90-day evaluation. Its API has
    # no field saying whether that's over, but a report sent without one during evaluation is refused
    # with "screenshot_required" (and nothing is stored), so UEX's own answer is the test.
    EVAL_DAYS, RECHECK_DAYS = 90, 7

    def _dr_shot_policy(self):
        """{optional: UEX has accepted a report from you without a screenshot, can_try: it's been 90
        days since your first report and UEX hasn't said no in the last week}."""
        st = self._dr_cfg().get("shot") or {}
        first = self._dr_first_report()
        now = time.time()
        if st.get("optional"):
            return {"optional": True, "can_try": True, "first": first}
        old_enough = bool(first) and now - first >= self.EVAL_DAYS * 86400
        recent_no = st.get("required_at") and now - st["required_at"] < self.RECHECK_DAYS * 86400
        return {"optional": False, "can_try": old_enough and not recent_no, "first": first,
                "days_left": max(0, int(self.EVAL_DAYS - (now - first) / 86400)) if first else None,
                "refused_at": st.get("required_at")}

    def _dr_first_report(self):
        """When you first reported: the earliest of this PC's log and what the Quantum server knows."""
        times = [e.get("at") for e in self._dr_report_log() if not e.get("test") and e.get("at")]
        if self._dr_cfg().get("first_seen"):
            times.append(self._dr_cfg()["first_seen"])
        return min(times) if times else None

    def dr_set_secret(self, secret):
        secret = (secret or "").strip()
        cfg = self._dr_cfg()
        changed = secret != (cfg.get("secret") or "")
        if secret:
            cfg["secret"] = secret
        else:
            cfg.pop("secret", None)
        old = cfg.pop("session", None) if changed else None
        if changed:
            cfg.pop("uex_user", None)                     # whose key it is gets asked of UEX again
            if cfg.get("username") and secret:
                cfg.pop("username", None)                 # filled in again from the new key's UEX account
        self._save_settings()
        if changed:
            def swap():                   # sign out of the old key's account, then in with the new key
                if old:
                    self._community.logout(old.get("token"))
                if secret:
                    self._sign_in()
            threading.Thread(target=swap, daemon=True).start()
        return {"ok": True, "has_secret": bool(secret)}

    def dr_set_hotkey(self, key):
        self._sender.configure(shot_hotkey=key or "")
        self._dr_cfg()["shot_hotkey"] = self._sender.shot_hotkey
        self._save_settings()
        return {"ok": True, "shot_hotkey": self._sender.shot_hotkey}

    def dr_shot_image(self, index):
        try:
            sh = self._dr_shots[int(index)]
        except (IndexError, ValueError, TypeError):
            return {"ok": False}
        return {"ok": True, "src": datarunner.thumbnail(sh, 1600), "w": sh.w, "h": sh.h}

    def dr_shot_view(self, shot_id):
        """The exact 1920x1080 image a shot goes to UEX as (its own report), to check before sending."""
        with self._lock:
            sh = next((x for x in self._dr_shots if x.id == shot_id), None)
        if not sh:
            return {"ok": False, "error": "That screenshot is gone"}
        try:
            return dict(datarunner.shot_url(sh), ok=True, id=sh.id, shot_w=sh.w, shot_h=sh.h)
        except Exception as e:
            watcher_mod.log_error("shot view")
            return {"ok": False, "error": str(e)}

    def _dr_shot(self, shot_id=None):
        """The shot a report goes with: the one asked for, or the only one."""
        if shot_id is not None:
            return next((x for x in self._dr_shots if x.id == shot_id), None)
        return self._dr_shots[0] if len(self._dr_shots) == 1 else None

    def dr_shots(self):
        return {"shots": [{"id": s.id, "thumb": datarunner.thumbnail(s), "w": s.w, "h": s.h, "at": s.at} for s in self._dr_shots],
                "seq": self._dr_seq}

    def _dr_drop_shot(self, shot_id):
        """A report went out: its screenshot is done (all of them if the report didn't name one)."""
        with self._lock:
            if shot_id is None:
                self._dr_shots = []
            else:
                self._dr_shots = [x for x in self._dr_shots if x.id != shot_id]
            self._dr_seq += 1

    def dr_clear_shots(self, index=None):
        with self._lock:
            if index is None:
                self._dr_shots = []
            elif 0 <= int(index) < len(self._dr_shots):
                self._dr_shots.pop(int(index))
            self._dr_seq += 1
        return self.dr_shots()

    def _dr_terminals(self):
        return {i: t for i, t in self._uex.terminals().items() if t.get("type", "commodity") == "commodity"}

    def _dr_game_build(self):
        running = self._game_on()
        path = self._tracker.log_path or ""
        env = next((c for c in ("EPTU", "PTU", "TECH-PREVIEW", "HOTFIX", "LIVE")
                    if f"\\{c}\\" in path.upper().replace("/", "\\")), "LIVE")
        # The log knows the release (Branch: sc-alpha-4.10.0, FileVersion: 4.10.193.11644) but not
        # which patch of it: a 4.10.1 hotfix still says 4.10.0 / 4.10.193. So the log gives major.minor,
        # and UEX's own version list (the numbering the community uses) gives the patch, as long as
        # both agree on the release. If they don't (a new release UEX hasn't listed), the log wins.
        logged = None
        try:
            with open(path, "r", encoding="utf-8", errors="replace") as fh:
                head = fh.read(200_000)
            m = (re.search(r"Branch:\s*sc-alpha-(\d+\.\d+(?:\.\d+)?)", head)
                 or re.search(r"(?:File|Product)Version:\s*(\d+\.\d+)\.", head)
                 or re.search(r"sc-alpha-(\d+\.\d+(?:\.\d+)?)", head))
            logged = m.group(1) if m else None
        except OSError:
            pass
        version = logged
        if logged:
            release = ".".join(logged.split(".")[:2])
            try:
                rows, _ = self._uex.get("game_versions")
                listed = (rows[0] if rows else {}).get("ptu" if "PTU" in env else "live") or ""
            except uex.UexError:
                listed = ""
            if listed == release or listed.startswith(release + "."):
                version = listed
        return version, env, running

    def _dr_game_version(self):
        """LIVE or PTU version for the report: from UEX's version list, picked by which Game.log is read."""
        ptu = "ptu" in (self._tracker.log_path or "").lower().replace("/", "\\").split("\\")
        try:
            rows, _ = self._uex.get("game_versions")
            v = rows[0] if rows else {}
        except uex.UexError:
            v = {}
        return (v.get("ptu") if ptu else v.get("live")) or "", "PTU" if ptu else "LIVE"

    def _dr_params(self):
        try:
            rows, _ = self._uex.get("data_parameters")
            p = rows[0] if rows else {}
        except uex.UexError:
            return {}
        com = p.get("commodity") if isinstance(p.get("commodity"), dict) else p
        glob = p.get("global") if isinstance(p.get("global"), dict) else p
        return {"accepting": glob.get("is_accepting_reports", 1), "accepting_ptu": glob.get("is_accepting_ptu_reports"),
                "commodity_accepted": com.get("is_accepted", 1), "price_variation": com.get("price_variation")}

    def dr_prefill(self, id_terminal=None):
        """Everything the report form can fill in by itself: the terminal where the game log puts you,
        what it trades with UEX's current numbers, the game version and UEX's limits."""
        def run():
            terms = self._dr_terminals()
            places = self._uex.place_map(self._db.locations)
            spot, _, how = self._log_spot(self._tracker.cur or {}) if self._game_on() else (None, 0, None)
            here = {i for i, p in places.items() if p and p == spot and i in terms}
            tid = int(id_terminal) if id_terminal else (min(here) if here else None)
            self._dr_terminal = tid
            listing = sorted(({"id": i, "name": t.get("name"), "where": uex.where(t), "system": t.get("star_system_name"),
                               "here": i in here} for i, t in terms.items()),
                             key=lambda x: (not x["here"], x["system"] or "", x["where"] or "", x["name"] or ""))
            rows, at = self._uex.get("commodities_prices_all")
            rows = self._community.overlay(rows)
            coms, _ = self._uex.get("commodities")
            names = {c["id"]: c["name"] for c in coms}
            out, boxes = [], set()
            for r in rows:
                if r.get("id_terminal") != tid:
                    continue
                for side, scu_key in (("buy", "scu_buy"), ("sell", "scu_sell_stock")):
                    if r.get(f"price_{side}"):
                        out.append({"id_commodity": r["id_commodity"], "name": names.get(r["id_commodity"], r.get("commodity_name")),
                                    "side": side, "price": r[f"price_{side}"], "scu": r.get(scu_key) or r.get(f"scu_{side}"),
                                    "status": r.get(f"status_{side}"), "avg": r.get(f"price_{side}_avg"),
                                    "updated": (r.get(f"community_{side}") or {}).get("at") or r.get("date_modified"),
                                    "community": r.get(f"community_{side}")})
                for b in str(r.get("container_sizes") or "").replace(";", ",").split(","):
                    if b.strip().isdigit() and int(b) in datarunner.CONTAINER_SIZES:
                        boxes.add(int(b))
            out.sort(key=lambda x: (x["side"] != "buy", x["name"] or ""))
            version, env, running = self._dr_game_build()
            t = terms.get(tid) or {}
            return {"ok": True, "terminals": listing, "id_terminal": tid, "terminal": t.get("name"),
                    "where": uex.where(t) if t else None, "you_are_at": spot, "how": how,
                    "rows": out, "commodities": sorted(({"id": i, "name": n} for i, n in names.items()), key=lambda c: c["name"]),
                    "uex_sizes": sorted(boxes), "game_running": running, "game_version": version, "env": env,
                    "params": self._dr_params(), "status_names": datarunner.STATUS, "at": at,
                    "stats": self.dr_stats(), "cooldown": self._dr_cooldowns(tid),
                    "ack": bool(self._dr_cfg().get("ack")), "reports_count": sum(1 for e in self._dr_report_log() if not (self._dr.live and e.get("test"))), **self.dr_status()}
        return self._uex_call(run)

    def _dr_build(self, form):
        """One report: the rows in the form, with the screenshot form["shot_id"] names (UEX takes one
        screenshot per report, with only the items it shows). Checking the whole list before it's split
        up (no shot_id, several shots), any shot stands in, so "no screenshot" isn't flagged."""
        version, env, running = self._dr_game_build()
        form = dict(form, game_version=version or "")      # from Game.log only, never typed in
        terms = self._dr_terminals()
        coms = {c["id"] for c in self._uex.get("commodities")[0]}
        with self._lock:
            sh = self._dr_shot(form.get("shot_id")) or (self._dr_shots[0] if self._dr_shots and form.get("shot_id") is None else None)
        shot = datarunner.shot_b64(sh)["b64"] if sh else None
        body = datarunner.build_payload(form, shot, production=self._dr.live)
        pol = self._dr_shot_policy()
        no_shot = bool(form.get("no_screenshot")) and not body.get("screenshot") and (pol["optional"] or pol["can_try"])
        errs = datarunner.validate(body, terms, coms, need_screenshot=not no_shot, history=self._dr.history())
        if not running:
            errs.insert(0, "game_not_running")
        elif not version:
            errs.insert(0, "game_version_unknown")
        params = self._dr_params()
        if params and not params.get("accepting"):
            errs.insert(0, "service_unavailable")
        avg = {}
        for r in self._uex.get("commodities_prices_all")[0]:
            if r.get("id_terminal") == body.get("id_terminal"):
                for side in ("buy", "sell"):
                    avg[(r["id_commodity"], side)] = r.get(f"price_{side}_avg") or r.get(f"price_{side}")
        warns = datarunner.price_warnings(body, avg, params.get("price_variation"))
        return body, errs, warns, terms

    def _dr_after_send(self, body, form, t, res):
        """Bookkeeping once UEX has accepted a report. Each step on its own: the report is already at
        UEX, so a problem here must never turn into "not sent" (and a retry UEX refuses as a duplicate)."""
        import traceback
        sides = [r.get("side") for r in form.get("rows") or [] if r.get("include")]
        data = res.get("data") or {}
        for step in (lambda: res.__setitem__("refreshed_days", self._dr_count(body)),
                     lambda: self._dr_log_report(body, form, t, res),
                     lambda: res.__setitem__("community", self._community.post(
                         body, sides, report_ids(data.get("ids_reports")),
                         data.get("username") or self._dr_cfg().get("username"), data.get("date_added"),
                         test=bool(res.get("test")), display=(self._dr_cfg().get("uex_user") or {}).get("username"),
                         avatar=(self._dr_cfg().get("uex_user") or {}).get("avatar"))),
                     lambda: self._dr_drop_shot(form.get("shot_id"))):
            try:
                step()
            except Exception:
                traceback.print_exc()

    def _dr_explain_duplicate(self, body, form, t, res):
        """UEX says it already has these items from the last 5 minutes. Look up what it has from this
        datarunner at this terminal: usually an earlier click that did go through. If so, say so, and
        add it to My Reports so nothing is lost."""
        secret, user = self._dr_cfg().get("secret"), self._dr_cfg().get("username")
        if not secret:
            return
        try:
            params = {"type": "commodity", "id_terminal": body.get("id_terminal"), "limit": 20}
            if user:
                params["username"] = user
            rows = self._uex._fetch("data_info", params, headers={"secret-key": secret}, timeout=15)
        except uex.UexError:
            return
        now = time.time()
        mine = [r for r in rows if r.get("is_owner", 1) and now - (r.get("date_added") or 0) < 900]
        if not mine:
            return
        names = {}
        try:
            names = {c["id"]: c["name"] for c in self._uex.get("commodities", offline=True)[0]}
        except uex.UexError:
            pass
        mins = max(1, round((now - max(r.get("date_added") or now for r in mine)) / 60))
        items = ", ".join(sorted({names.get(r.get("id_commodity"), "#" + str(r.get("id_commodity"))) for r in mine}))
        res["errors"] = [{"code": "duplicated_report",
                          "text": f"Your report of {items} here already reached UEX {mins} min ago "
                                  f"({mine[0].get('status') or 'pending'}), so this one is a repeat. Nothing more to do: "
                                  "it's in My Reports now."}]
        res["already_sent"] = True
        known = {i for e in self._dr_report_log() for i in e.get("ids", [])}
        ids = [str(r.get("id")) for r in mine]
        if not set(ids) & known:
            fake = {"ok": True, "test": False, "data": {"ids_reports": ",".join(ids), "date_added": min(r.get("date_added") or now for r in mine),
                                                         "username": mine[0].get("username")}}
            try:
                self._dr_log_report(body, form, t, fake)
                self._dr_count(body)
                self._dr._sides = [r.get("side") for r in form.get("rows") or [] if r.get("include")]
                self._dr._remember(body, min(r.get("date_added") or now for r in mine), self._dr._sides)
            except Exception:
                pass

    def _dr_dup_text(self, body, form):
        """Which rows Quantum's own 5-minute check holds back, and for how long."""
        now, hist, names = time.time(), self._dr.history(), {}
        try:
            names = {c["id"]: c["name"] for c in self._uex.get("commodities", offline=True)[0]}
        except uex.UexError:
            pass
        sides = [r.get("side") for r in form.get("rows") or [] if r.get("include")]
        out = []
        for i, p in enumerate(body.get("prices") or []):
            side = sides[i] if i < len(sides) else "buy"
            t = hist.get(f"{body.get('id_terminal')}:{p.get('id_commodity')}:{side}")
            if t and now - t < datarunner.DUPLICATE_WINDOW:
                out.append(f"{names.get(p.get('id_commodity'), '#' + str(p.get('id_commodity')))} "
                           f"(again in {max(1, round((datarunner.DUPLICATE_WINDOW - (now - t)) / 60))} min)")
        return ("You sent " + ", ".join(out) + " from here less than 5 minutes ago. "
                "UEX takes each item once every 5 minutes; untick those rows or wait") if out else None

    def dr_check(self, form):
        """Step 6 of the UEX guide, "review one final time": everything the report would send, the
        problems UEX would refuse it for, and prices far enough off to double-check. Nothing is saved."""
        def run():
            body, errs, warns, terms = self._dr_build(form)
            t = terms.get(body.get("id_terminal")) or {}
            return {"ok": True, "live": self._dr.live, "terminal": t.get("name"), "where": uex.where(t) if t else None,
                    "prices": body.get("prices") or [], "shots": len(self._dr_shots),
                    "container_sizes": body.get("container_sizes"), "game_version": body.get("game_version"),
                    "errors": [{"code": c, "text": (self._dr_dup_text(body, form) or datarunner.message(c))
                                if c == "duplicated_report" else datarunner.message(c)} for c in errs], "warnings": warns}
        return self._uex_call(run)

    def dr_submit(self, form):
        """Save the report (test mode) or send it (live). The page reviews it with dr_check first.
        With several screenshots the page sends one report per shot: form["shot_id"] and its rows."""
        def run():
            with self._lock:
                many = len(self._dr_shots) > 1
            if many and not self._dr_shot(form.get("shot_id")):
                return {"ok": False, "status": "shot_unassigned", "errors": [
                    {"code": "shot_unassigned", "text": "Match your items to your screenshots first: UEX takes one screenshot per report"}]}
            body, errs, warns, terms = self._dr_build(form)
            if errs and self._dr.live:         # live: don't send what UEX will refuse anyway
                dup = self._dr_dup_text(body, form) if "duplicated_report" in errs else None
                return {"ok": False, "status": errs[0], "errors": [
                    {"code": c, "text": dup if c == "duplicated_report" and dup else datarunner.message(c)} for c in errs]}
            t = terms.get(body.get("id_terminal")) or {}
            res = self._dr.submit(body, self._uex.token, self._dr_cfg().get("secret", ""),
                                  f"{t.get('name') or ''} {uex.where(t) if t else ''}", errs, warns,
                                  sides=[r.get("side") for r in form.get("rows") or [] if r.get("include")])
            res["warnings"] = warns
            res["rows"] = len(body.get("prices") or [])
            if not body.get("screenshot") and not res.get("test"):     # tried without a screenshot: UEX's answer
                shot = self._dr_cfg().setdefault("shot", {})
                if res.get("ok"):
                    shot.update(optional=True, confirmed_at=int(time.time()))
                    shot.pop("required_at", None)
                elif res.get("status") == "screenshot_required":
                    shot.update(optional=False, required_at=int(time.time()))
                    res["error"] = ("UEX still needs a screenshot from you (you're in its evaluation period). "
                                    "Take one and send again; Quantum will offer to skip it again in a week.")
                self._save_settings()
                res["shot_policy"] = self._dr_shot_policy()
            if res.get("ok"):
                self._dr_after_send(body, form, t, res)
            elif res.get("status") == "duplicated_report" and not res.get("test"):
                self._dr_explain_duplicate(body, form, t, res)
            res["shot_id"] = form.get("shot_id")
            res["stats"] = self.dr_stats()
            return res
        return self._uex_call(run)

    def _dr_count(self, body):
        """A sent report into the stats: this session's and all-time (test reports kept apart).
        Also how stale the data it replaced was, which is the fun number."""
        now, tid = time.time(), body.get("id_terminal")
        ages = {}
        try:
            for r in self._uex.get("commodities_prices_all", offline=True)[0]:
                if r.get("id_terminal") == tid and r.get("date_modified"):
                    ages[r["id_commodity"]] = max(0.0, (now - r["date_modified"]) / 86400)
        except uex.UexError:
            pass
        days = sum(ages.get(p.get("id_commodity"), 0) for p in body.get("prices") or [])
        n = len(body.get("prices") or [])
        ses = self._dr_session
        ses["reports"] += 1
        ses["prices"] += n
        ses["days"] += days
        if tid not in ses["terminals"]:
            ses["terminals"].append(tid)
        key = "stats_test" if not self._dr.live else "stats"
        all_ = self._dr_cfg().setdefault(key, {"reports": 0, "prices": 0, "days": 0.0, "terminals": []})
        all_["reports"] += 1
        all_["prices"] += n
        all_["days"] = round(all_["days"] + days, 1)
        if tid not in all_["terminals"]:
            all_["terminals"].append(tid)
        all_["last"] = now
        self._save_settings()
        return round(days, 1)

    def dr_stats(self):
        ses = self._dr_session
        all_ = self._dr_cfg().get("stats_test" if not self._dr.live else "stats") or {}
        return {"session": {"reports": ses["reports"], "prices": ses["prices"], "terminals": len(ses["terminals"]),
                            "days": round(ses["days"], 1)},
                "all": {"reports": all_.get("reports", 0), "prices": all_.get("prices", 0),
                        "terminals": len(all_.get("terminals", [])), "days": all_.get("days", 0)},
                "test": not self._dr.live, "rating": self._dr_cfg().get("rating")}

    def _dr_cooldowns(self, tid):
        """Rows sent from here in the last 5 minutes, which UEX won't take again yet: {"id:side": seconds left}."""
        now, out = time.time(), {}
        for k, t in self._dr.history().items():
            t_id, cid, side = k.split(":")
            left = datarunner.DUPLICATE_WINDOW - (now - t)
            if str(t_id) == str(tid) and left > 0:
                out[f"{cid}:{side}"] = int(left)
        return out

    # ---- the datarunner's own reports and what UEX did with them
    REPORT_STATUS = ("pending", "under_review", "queued", "approved", "consolidated", "declined", "expired")

    def _dr_report_log(self):
        try:
            log = json.loads((HERE / "datarunner_reports.json").read_text(encoding="utf-8"))
        except Exception:
            return []
        for e in log:
            e["ids"] = report_ids(",".join(map(str, e.get("ids") or [])))
        return log

    def _dr_log_report(self, body, form, term, res):
        """Every report sent (or saved in test mode), newest first, so the "My reports" view can follow
        it through UEX's review. UEX returns its report IDs; their status comes from /data_info."""
        names = {}
        try:
            names = {c["id"]: c["name"] for c in self._uex.get("commodities", offline=True)[0]}
        except uex.UexError:
            pass
        data = res.get("data") or {}
        ids = report_ids(data.get("ids_reports")) if not res.get("test") else []
        sides = [r.get("side") for r in form.get("rows") or [] if r.get("include")]
        rows = []
        for i, p in enumerate(body.get("prices") or []):
            side = sides[i] if i < len(sides) else "buy"
            rows.append({"id_commodity": p.get("id_commodity"), "name": names.get(p.get("id_commodity")), "side": side,
                         "price": p.get(f"price_{side}"), "scu": p.get(f"scu_{side}"), "status": p.get(f"status_{side}"),
                         "missing": bool(p.get("is_missing"))})
        entry = {"at": int(data.get("date_added") or time.time()), "test": bool(res.get("test")), "ids": ids,
                 "username": data.get("username"), "id_terminal": body.get("id_terminal"), "terminal": term.get("name"),
                 "where": uex.where(term) if term else None, "rows": rows}
        try:
            entry["shot"] = self._dr_keep_shot(body.get("screenshot"))
        except Exception:                                  # keeping a copy is a nicety: never stop the log for it
            watcher_mod.log_error("keep report screenshot")
        log = [entry] + self._dr_report_log()
        try:
            (HERE / "datarunner_reports.json").write_text(json.dumps(log[:300], indent=1), encoding="utf-8")
        except OSError:
            pass
        if data.get("username"):
            self._dr_cfg()["username"] = data["username"]
            self._save_settings()

    # The screenshot each report went to UEX with, kept on this PC for SHOT_KEEP_DAYS so My Reports can
    # show what was sent next to UEX's decision. UEX's API doesn't hand its own copy back.
    SHOT_KEEP_DAYS = 14
    _SHOT_NAME = re.compile(r"\d+-[0-9a-f]{8}\.(jpg|png)")

    def _dr_shots_dir(self):
        return HERE / "report_screenshots"

    def _dr_keep_shot(self, b64):
        ext = "jpg" if (b64 or "").startswith("/9j/") else "png" if (b64 or "").startswith("iVBOR") else None
        if not ext:
            return None
        d = self._dr_shots_dir()
        d.mkdir(exist_ok=True)
        name = f"{int(time.time())}-{secrets.token_hex(4)}.{ext}"
        (d / name).write_bytes(base64.b64decode(b64))
        self._dr_prune_shots()
        return name

    def _dr_prune_shots(self):
        """Screenshots older than SHOT_KEEP_DAYS are deleted."""
        cut = time.time() - self.SHOT_KEEP_DAYS * 86400
        try:
            for p in self._dr_shots_dir().iterdir():
                if p.is_file() and self._SHOT_NAME.fullmatch(p.name) and p.stat().st_mtime < cut:
                    p.unlink(missing_ok=True)
        except OSError:
            pass

    def _dr_shot_ok(self, name):
        return bool(name and self._SHOT_NAME.fullmatch(str(name)) and (self._dr_shots_dir() / name).is_file())

    def dr_report_shot(self, name):
        """The screenshot a report was sent with, as a data URL, while it's kept."""
        name = str(name or "")
        if not self._dr_shot_ok(name):
            return {"ok": False, "error": f"That screenshot isn't kept any more (they're deleted after {self.SHOT_KEEP_DAYS} days)"}
        raw = (self._dr_shots_dir() / name).read_bytes()
        mime = "jpeg" if name.endswith(".jpg") else "png"
        return {"ok": True, "src": f"data:image/{mime};base64," + base64.b64encode(raw).decode("ascii")}

    def dr_reports(self, refresh=False):
        try:
            return self._dr_reports(refresh)
        except Exception as e:
            import traceback
            traceback.print_exc()                        # shows in the console window, for troubleshooting
            return {"ok": False, "error": f"{type(e).__name__}: {e}", "reports": [], "summary": {}}

    def _dr_reports(self, refresh=False):
        """The "My reports" view: what was sent, and each report's state at UEX (pending, under review,
        approved, live, declined, expired). Test reports were never sent, so they have none."""
        self._dr_prune_shots()
        log = self._dr_report_log()
        if self._dr.live:                                  # test reports were never sent: not in the live list
            log = [e for e in log if not e.get("test")]
        secret, user = self._dr_cfg().get("secret"), self._dr_cfg().get("username")
        # Reports this PC doesn't know about (a reinstall, another PC) come back from the server.
        prof = self._community.profile(user) if user else None
        if prof and prof.get("history"):
            known = {i for e in log for i in e.get("ids", [])}
            try:
                terms, names = self._uex.terminals(), {c["id"]: c["name"] for c in self._uex.get("commodities", offline=True)[0]}
            except uex.UexError:
                terms, names = {}, {}
            for h in prof["history"]:
                if h.get("test") or set(h.get("ids", [])) & known:
                    continue
                t = terms.get(h["id_terminal"]) or {}
                log.append({"at": h["at"], "test": False, "ids": h["ids"], "username": user, "id_terminal": h["id_terminal"],
                            "terminal": t.get("name"), "where": uex.where(t) if t else None, "from_server": True,
                            "rows": [dict(r, name=names.get(r["id_commodity"])) for r in h["rows"]]})
            log.sort(key=lambda e: -e.get("at", 0))
        # Only reports still waiting on UEX are looked up: ones UEX has decided are kept as they are,
        # and after 14 days without a decision Quantum stops asking (see FOLLOW_FOR).
        now = time.time()
        done = lambda e: e.get("final") and all(s in self.FINAL for s in e.get("states") or ["?"])
        waiting = [e for e in log if not e.get("test") and e.get("ids") and not done(e)
                   and now - e.get("at", 0) <= self.FOLLOW_FOR]
        found, error, asked = {}, None, False
        if waiting and secret and self._uex.token:
            cache = getattr(self, "_dr_info_cache", None)
            if cache and time.time() - cache[0] < (60 if refresh else 300):   # gentle on UEX: 5 min, Refresh 1 min
                found = cache[1]
            else:
                try:
                    params = {"type": "commodity", "limit": 100}
                    if user:
                        params["username"] = user
                    for r in self._uex._fetch("data_info", params, headers={"secret-key": secret}, timeout=15):
                        if r.get("is_owner", 1):
                            found.setdefault(str(r.get("id")), []).append(r)
                    self._dr_info_cache = (time.time(), found)
                    asked = True
                except uex.UexError as e:
                    error = str(e)
        self._dr_backfill(log, prof)
        out, changed = [], False
        for e in log:
            rows = [dict(r) for r in e.get("rows", [])]
            states = []
            if e.get("final") or (not e.get("test") and now - e.get("at", 0) > self.FOLLOW_FOR):
                # decided earlier, or no longer followed: show what UEX last said
                states = list(e.get("states") or [])
                for row in rows:
                    row.setdefault("uex", (e.get("row_states") or {}).get(str(row["id_commodity"])))
                    row.setdefault("reason", (e.get("row_reasons") or {}).get(str(row["id_commodity"])))
                    row.setdefault("uex_id", (e.get("row_ids") or {}).get(str(row["id_commodity"])))
                out.append(self._dr_out(e, rows, states, now))
                continue
            if not e.get("test"):
                for rid in e.get("ids", []):
                    for r in found.get(rid, []):
                        if abs((r.get("date_added") or e["at"]) - e["at"]) > 86400:
                            continue                       # the same ID in another partition of UEX's table
                        states.append(r.get("status"))
                        for row in rows:
                            if row["id_commodity"] == r.get("id_commodity") and "uex" not in row:
                                row["uex"] = r.get("status")
                                row["uex_id"] = rid
                                row["checked"] = r.get("date_checked")
                                if r.get("status") in ("declined", "expired") or r.get("is_contested"):
                                    row["reason"] = uex.decline_reason(r)
                                break
            if not states and e.get("states"):
                states = list(e["states"])                 # nothing new from UEX this time: keep what it said
                for row in rows:
                    row.setdefault("uex", (e.get("row_states") or {}).get(str(row["id_commodity"])))
                    row.setdefault("reason", (e.get("row_reasons") or {}).get(str(row["id_commodity"])))
                    row.setdefault("uex_id", (e.get("row_ids") or {}).get(str(row["id_commodity"])))
            elif states and states != e.get("states"):
                e["states"], changed = states, True
                e["row_states"] = {str(r["id_commodity"]): r.get("uex") for r in rows if r.get("uex")}
                e["row_ids"] = {str(r["id_commodity"]): r["uex_id"] for r in rows if r.get("uex_id")}
                e["row_reasons"] = {str(r["id_commodity"]): r["reason"] for r in rows if r.get("reason")}
                if all(st in self.FINAL for st in states):
                    e["final"] = True                          # UEX is done with it: never asked about again
            out.append(self._dr_out(e, rows, states, now))
        if changed:
            self._dr_save_states(log)
        counted = [s for e in out for s in e["states"] if not e.get("no_decision")]

        summary = {k: counted.count(k) for k in self.REPORT_STATUS if counted.count(k)}
        decided = sum(summary.get(k, 0) for k in ("approved", "consolidated", "declined"))
        ok = summary.get("approved", 0) + summary.get("consolidated", 0)
        return {"ok": True, "reports": out, "summary": summary, "approval": round(ok / decided * 100) if decided else None,

                "error": error, "can_check": bool(secret and self._uex.token), "live": self._dr.live,
                "asked": asked, "waiting": len(waiting),
                "checked_ago": time.time() - getattr(self, "_dr_info_cache", (time.time(),))[0]}

    def _dr_out(self, e, rows, states, now):
        """One report for My Reports: each row with its own UEX report number where known, and whether
        the screenshot it was sent with is still kept on this PC."""
        if e.get("from_server") and len(e.get("ids") or []) == len(rows):
            for row, rid in zip(rows, e["ids"]):            # the server lists them in the same order
                row.setdefault("uex_id", rid)
        for row in rows:
            row["uex_url"] = self._uex_price_url(row.get("id_commodity"), e.get("id_terminal"), row.get("side"))
        return dict(e, rows=rows, states=states, no_decision=self._dr_no_decision(e, states, now),
                    shot=e.get("shot") if self._dr_shot_ok(e.get("shot")) else None)

    def _uex_price_url(self, id_commodity, id_terminal, side):
        """UEX's page for one commodity's price at one terminal (where a report shows up once it's live).
        UEX's API has no page for a single report. side "buy": you bought, so the terminal sells it."""
        if not id_commodity or not id_terminal:
            return None
        slugs = getattr(self, "_com_slugs", None)
        if slugs is None or time.time() - slugs[0] > 3600:
            try:
                rows = self._uex.get("commodities", offline=True)[0]
            except uex.UexError:
                rows = []
            slugs = self._com_slugs = (time.time(), {c["id"]: c.get("slug") or re.sub(r"[^a-z0-9]+", "-", str(c.get("name") or "").lower()).strip("-")
                                                     for c in rows if c.get("id")})
        slug = slugs[1].get(id_commodity)
        if not slug:
            return None
        tab = "locations_selling" if side == "buy" else "locations_buying"
        return (f"https://uexcorp.space/commodities/info/name/{urllib.parse.quote(slug)}/tab/{tab}/"
                f"id_terminal/{int(id_terminal)}/highlight/price_last/")

    def demo_config(self):
        return dict(DEMO)

    def demo_snapshot(self):
        import copy
        with self._lock:
            self._demo_saved = {"route": copy.deepcopy(self._route), "guide": self._guide}
            self._route, self._guide = [], None
        return {"ok": True}

    def demo_restore(self):
        saved = getattr(self, "_demo_saved", None)
        if not saved:
            return {"ok": False}
        with self._lock:
            self._route = [t for t in saved["route"] if t.get("place") in self._db.locations]
            self._guide = saved["guide"] if saved["guide"] in self._db.locations else None
            self._demo_saved = None
        self._save_settings()
        return {"ok": True}

    def community_status(self):
        """The Quantum API server: whether community features are on, and whether it answers."""
        return {"url": self._community.url, "enabled": bool(self._community.url), **self._community.health()}

    def set_community_enabled(self, on):
        """Turn the community features (the Quantum API) on or off from Settings, in place of editing
        "community_url" in settings.json. Off: Quantum uses UEX's data alone. A server address you set
        yourself is kept and comes back when you turn them on again."""
        cur = self._settings.get("community_url")
        if on:
            back = self._settings.pop("community_url_was", None)
            if back and str(back).lower() != "off":
                self._settings["community_url"] = back
            else:
                self._settings.pop("community_url", None)         # the built-in server
        else:
            if cur and str(cur).lower() != "off":
                self._settings["community_url_was"] = cur
            self._settings["community_url"] = "off"
        self._save_settings()
        try:
            self._community.prices(fresh=True)
        except Exception:
            pass
        self._owner_at = None
        if on:
            self._sign_in_soon()
        return self.community_status()

    def uex_key_status(self):
        """Whether the UEX Secret Key works: the UEX name it belongs to (asked of UEX, cached)."""
        cfg = self._dr_cfg()
        if not cfg.get("secret"):
            return {"has_secret": False, "ok": False}
        if not self._uex.token:
            return {"has_secret": True, "ok": False, "error": "Add your UEX Bearer Token too"}
        u = self._dr_uex_user() or {}
        if not u.get("username"):
            return {"has_secret": True, "ok": False, "error": "UEX didn't accept this key, or can't be reached"}
        return {"has_secret": True, "ok": True, "username": u["username"],
                "datarunner": bool(u.get("is_datarunner")), "signed_in": bool(self._session_token())}

    # ------------------------------------------------------------ Quantum server sign-in
    # Quantum signs in to the Quantum server with your UEX datarunner secret key: the server asks UEX
    # whose key it is, forgets the key, and sends back a session token kept here in settings.json. Any
    # PC with your secret key (a new one, a reinstall, a second gaming PC) signs in the same way.
    def _session_token(self):
        return (self._dr_cfg().get("session") or {}).get("token")

    def _sign_in(self):
        """Sign in now (blocking). Returns the server's answer, or None without a secret key or server."""
        cfg = self._dr_cfg()
        secret = cfg.get("secret")
        if not secret or not self._community.url:
            return None
        r = self._community.login(secret)
        if r.get("status") == "ok" and r.get("session"):
            cfg["session"] = {"token": r["session"], "username": r.get("username"), "at": int(time.time())}
            if r.get("username") and not cfg.get("username"):
                cfg["username"] = r["username"]
            self._settings.pop("device_key", None)            # the old per-PC key isn't used any more
            self._settings.pop("trust_key", None)
            self._save_settings()
        else:
            self._sender._event(f"Quantum server sign-in: {r.get('status')}")    # shows in Settings > Log
        self._sign_in_status = r.get("status")
        return r

    def _sign_in_soon(self):
        """Sign in in the background, at most once a minute (so a server that keeps refusing isn't hammered)."""
        if time.time() - getattr(self, "_sign_in_at", 0) < 60:
            return
        self._sign_in_at = time.time()
        threading.Thread(target=self._sign_in, daemon=True).start()

    def _session_lost(self):
        """The server no longer accepts this sign-in (it expired, or the owner ended it): sign in again."""
        if self._dr_cfg().pop("session", None) is not None:
            self._save_settings()
        self._sign_in_soon()

    def trust_status(self):
        """Trusted contributor status and progress, for the FAQ."""
        cfg = self._dr_cfg()
        user = cfg.get("username") or (cfg.get("uex_user") or {}).get("username")
        if cfg.get("secret") and not self._session_token():
            self._sign_in()
        r = self._community.trust(user) if user else None
        return {"ok": bool(r), "user": user, "trusted": bool(r and r.get("trusted")),
                "signed_in": bool(r and r.get("signed_in")), "has_secret": bool(cfg.get("secret")),
                "sign_in_status": getattr(self, "_sign_in_status", None), "info": (r or {}).get("info")}

    def set_community_url(self, url):
        """The Quantum API server for community prices; empty turns them off."""
        url = (url or "").strip().rstrip("/")
        if url and not url.startswith(("https://", "http://")):
            url = "https://" + url
        self._settings["community_url"] = url
        self._save_settings()
        self._community.prices(fresh=True)
        return self.community_status()

    # By approved reports, one per item (each price row, picture, station position, planet alignment):
    # the same table as the server, whose own copy wins when it can be reached.
    RANKS = [(0, "Unranked"), (1, "Trainee"), (50, "Runner"), (250, "Field Analyst"),
             (750, "Trade Analyst"), (2000, "Quantum Analyst")]

    def _dr_rank(self, n):
        name, nxt = self.RANKS[0][1], None
        for i, (at, nm) in enumerate(self.RANKS):
            if n >= at:
                name, nxt = nm, (self.RANKS[i + 1] if i + 1 < len(self.RANKS) else None)
        return {"name": name, "count": n, "next": {"name": nxt[1], "at": nxt[0]} if nxt else None}

    def _dr_rating(self, states):
        """Star rating from what UEX decided: each approved row counts 5 stars, each declined one 1,
        averaged. Nothing decided yet: no rating (0 stars). Same formula as the server; this local
        one is only used when the server can't be reached."""
        good = sum(1 for s in states if s in ("approved", "consolidated"))
        bad = sum(1 for s in states if s == "declined")
        return {"stars": round((5 * good + bad) / (good + bad), 2) if good + bad else 0, "rated": good + bad > 0,
                "approved": good, "declined": bad}

    def _dr_uex_user(self, refresh=False):
        """The datarunner's UEX username and avatar, from UEX's /user (needs the secret key).
        Cached for 6 hours."""
        cfg = self._dr_cfg()
        cached = cfg.get("uex_user")
        if cached and not refresh and time.time() - cached.get("at", 0) < (6 * 3600 if cached.get("avatar") else 600):
            return cached
        if not (cfg.get("secret") and self._uex.token):
            return cached
        try:
            rows = self._uex._fetch("user", {}, headers={"secret-key": cfg["secret"]}, timeout=10)
            u = rows[0] if rows else {}
        except uex.UexError:
            return cached
        if u.get("username"):
            cached = {"username": u["username"], "name": u.get("name"), "avatar": u.get("avatar"), "at": int(time.time()),
                      "is_datarunner": u.get("is_datarunner"), "is_datarunner_banned": u.get("is_datarunner_banned")}
            cfg["uex_user"], cfg["username"] = cached, u["username"]
            self._save_settings()
        return cached

    @staticmethod
    def _dr_avatar_urls(raw):
        raw = str(raw).strip()
        if raw.startswith("//"):
            return ["https:" + raw]
        if raw.startswith(("http://", "https://", "data:")):
            return [raw]
        path = raw.lstrip("/")
        return [f"https://{host}/{path}" for host in ("edge.uexcorp.space", "assets.uexcorp.space", "uexcorp.space")]

    def _dr_avatar(self, raw):
        """The UEX avatar as a data: URL. Downloaded here rather than linked from the page: UEX may
        hand back a path rather than a full address, and its image servers may not serve pictures
        to other sites. Kept on disk, so it's fetched once per avatar."""
        if not raw:
            return None
        import base64
        import hashlib
        raw = str(raw).strip()
        if raw.startswith("data:"):
            return raw
        tries = self._dr_avatar_urls(raw)
        cache = HERE / "uex_cache" / f"avatar_{hashlib.sha1(raw.encode()).hexdigest()[:12]}"
        if raw in getattr(self, "_avatar_direct", set()):
            return None                        # the page loads this one straight from UEX (see below)
        try:
            kind, data = cache.read_text(encoding="utf-8").split("\n", 1)
            return f"data:{kind};base64,{data}"
        except Exception:
            pass
        for url in tries:
            try:
                req = urllib.request.Request(url, headers={"User-Agent": "Mozilla/5.0 Quantum", "Referer": "https://uexcorp.space/",
                                                           "Accept": "image/*"})
                with urllib.request.urlopen(req, timeout=8) as r:
                    kind = (r.headers.get("Content-Type") or "").split(";")[0].strip()
                    body = r.read(3_000_000)
                if not kind.startswith("image/") or not body:
                    continue
                data = base64.b64encode(body).decode("ascii")
                try:
                    cache.parent.mkdir(parents=True, exist_ok=True)
                    cache.write_text(f"{kind}\n{data}", encoding="utf-8")
                except OSError:
                    pass
                return f"data:{kind};base64,{data}"
            except Exception:
                continue
        # UEX's image CDN only serves browsers, which is normal; the page then loads it directly.
        # Remember that so it isn't tried (and reported) on every visit.
        if not hasattr(self, "_avatar_direct"):
            self._avatar_direct = set()
        self._avatar_direct.add(raw)
        return None

    def _dr_share_user(self, user):
        """Send the server your UEX avatar and name when they change (or once a day), so other
        datarunners see your picture on the Top 10. Only what UEX's /user said, nothing else."""
        if not user or not user.get("username"):
            return
        cfg = self._dr_cfg()
        key = [user["username"], user.get("avatar")]
        sent = cfg.get("user_shared") or {}
        if sent.get("key") == key and time.time() - sent.get("at", 0) < 86400:
            return
        if self._community.update_user(user["username"], user["username"], user.get("avatar")):
            cfg["user_shared"] = {"key": key, "at": int(time.time())}
            self._save_settings()

    def dr_leaderboard(self):
        """Top 10 Quantum datarunners from the community server, with their UEX avatars."""
        if not self._community.url:
            return {"ok": False, "error": "Community features are off, so there's no leaderboard"}
        user = self._dr_uex_user() or {}
        me = (user.get("username") or self._dr_cfg().get("username") or "").strip()
        self._dr_share_user(user)
        r = self._community.leaderboard(me or None)
        if not r:
            return {"ok": False, "error": "The Quantum server couldn't be reached. Try again in a minute"}
        rows = list(r.get("top") or []) + ([r["me"]] if r.get("me") else [])
        from concurrent.futures import ThreadPoolExecutor

        def pic(x):
            raw = x.get("avatar")
            if me and x.get("username", "").lower() == me.lower() and user.get("avatar"):
                raw = user["avatar"]                           # yours: straight from UEX, always current
            # Downloaded here when UEX allows it; its image CDN often only serves browsers, so the
            # page also gets the direct link and loads it itself (like the My Reports card does).
            x["avatar_url"] = self._dr_avatar_urls(raw)[0] if raw else None
            try:
                x["avatar"] = self._dr_avatar(raw) if raw else None
            except Exception:
                x["avatar"] = None
        with ThreadPoolExecutor(max_workers=6) as ex:
            list(ex.map(pic, rows))
        return {"ok": True, "top": r.get("top") or [], "me": r.get("me"), "total": r.get("total", 0),
                "you": me.lower() or None, "at": time.time()}

    def dr_profile(self, refresh=False):
        try:
            return self._dr_profile(refresh)
        except Exception as e:
            import traceback
            traceback.print_exc()
            return {"ok": False, "error": f"{type(e).__name__}: {e}"}

    FOLLOW_FOR = 14 * 86400                # stop asking UEX about a report after this long
    DECIDED = ("approved", "consolidated", "declined", "expired")
    # Nothing more will happen to these. "approved" isn't one: UEX approves a row first and merges it
    # into its data (consolidated, "Live on UEX") a little later, so approved reports are still followed.
    FINAL = ("consolidated", "declined", "expired")

    def _dr_no_decision(self, e, states, now):
        """Sent more than 14 days ago and UEX never decided: shown as such, left out of the counts."""
        return (not e.get("test") and bool(e.get("ids")) and now - e.get("at", 0) > self.FOLLOW_FOR
                and not all(s in self.DECIDED for s in states or ["?"]))

    def _dr_save_states(self, log):
        """Keep UEX's latest answer for each report in the log, so decided reports aren't asked about
        again and a report keeps its last known status once Quantum stops following it."""
        full = self._dr_report_log()
        by = {(tuple(e.get("ids") or []), e.get("at")): e for e in log}
        for e in full:
            got = by.get((tuple(e.get("ids") or []), e.get("at")))
            if got:
                for k in ("states", "row_states", "row_reasons", "row_ids", "final"):
                    if k in got:
                        e[k] = got[k]
        try:
            (HERE / "datarunner_reports.json").write_text(json.dumps(full[:300], indent=1), encoding="utf-8")
        except OSError:
            pass

    def _dr_backfill(self, log, prof):
        """Send the community server any recent live report it doesn't have yet (a send that failed,
        or one from before it existed). The server checks each against UEX as usual."""
        if not self._community.url:
            return
        have = {i for h in (prof or {}).get("history", []) for i in h.get("ids", [])}
        for e in log:
            if e.get("test") or not e.get("ids") or e.get("shared") or set(e["ids"]) & have:
                continue
            if time.time() - e.get("at", 0) > 6 * 86400:
                continue
            body = {"id_terminal": e.get("id_terminal"), "prices": []}
            for r in e.get("rows", []):
                p = {"id_commodity": r["id_commodity"]}
                if r.get("missing"):
                    p["is_missing"] = 1
                else:
                    p.update({f"price_{r['side']}": r.get("price"), f"scu_{r['side']}": r.get("scu"),
                              f"status_{r['side']}": r.get("status")})
                body["prices"].append(p)
            got = self._community.post(body, [r.get("side") for r in e.get("rows", [])], e["ids"],
                                       e.get("username") or self._dr_cfg().get("username"), e.get("at"), test=False,
                                       display=(self._dr_cfg().get("uex_user") or {}).get("username"),
                                       avatar=(self._dr_cfg().get("uex_user") or {}).get("avatar"))
            if got and got.get("ok"):
                self._dr_mark_shared(e)

    def _dr_mark_shared(self, entry):
        full = self._dr_report_log()
        for e in full:
            if e.get("ids") == entry.get("ids") and e.get("at") == entry.get("at"):
                e["shared"] = True
        try:
            (HERE / "datarunner_reports.json").write_text(json.dumps(full[:300], indent=1), encoding="utf-8")
        except OSError:
            pass

    def _dr_profile(self, refresh=False):
        """The My Reports header: who you are at UEX, your rank and star rating. The server keeps it
        (so it survives a reinstall); without the server it's worked out from this PC's report log."""
        user = self._dr_uex_user(refresh) or {}
        name = user.get("username") or self._dr_cfg().get("username")
        threading.Thread(target=self._dr_share_user, args=(user,), daemon=True).start()
        prof = self._community.profile(name) if name else None
        if prof:
            out = dict(prof, source="server")
            if prof.get("first_seen") and prof["first_seen"] != self._dr_cfg().get("first_seen"):
                self._dr_cfg()["first_seen"] = prof["first_seen"]       # for the 90-day screenshot rule
                self._save_settings()
            for c in out.get("contrib") or []:                 # pictures: a full link to the server's copy
                if isinstance(c.get("url"), str) and c["url"].startswith("/"):
                    c["url"] = self._community.url + c["url"]
            local_sent = sum(1 for e in self._dr_report_log() if not e.get("test") and e.get("ids"))
            out["reports"] = max(out.get("reports") or 0, local_sent)
        else:
            reps = self._dr_reports()
            states = [s for e in reps["reports"] if not e.get("test") for s in e["states"]]
            r = self._dr_rating(states)
            accepted = r["approved"]                       # one per approved price row, like the server
            out = {"username": name, "stars": r["stars"], "rated": r["rated"], "accepted": accepted,
                   "reports": sum(len(e.get("rows") or []) for e in reps["reports"] if not e.get("test")),
                   "rows": {"approved": r["approved"], "declined": r["declined"]}, "rank": self._dr_rank(accepted),
                   "decided": {"approved": r["approved"], "rejected": r["declined"]},
                   "banned": False, "source": "local"}
        raw = user.get("avatar") or out.get("avatar")
        out.update(ok=True, name=user.get("name"), avatar=self._dr_avatar(raw), avatar_url=self._dr_avatar_urls(raw)[0] if raw else None,
                   avatar_raw=raw, uex_datarunner=user.get("is_datarunner"), uex_banned=user.get("is_datarunner_banned"),
                   has_secret=bool(self._dr_cfg().get("secret")), test=not self._dr.live,
                   ranks=[tuple(x) for x in out.get("ranks") or self.RANKS])
        self._dr_cfg()["rating"] = {"stars": out["stars"], "rated": out["rated"], "rank": out["rank"]["name"]}
        self._save_settings()
        return out

    def _align_target(self, body):
        """For a /showlocation on `body`: the known place you're at, from what the log says (where you
        landed or docked) or else from the reading's latitude and height, which don't depend on the
        planet's rotation. -> (place, mode, lat_tol, alt_tol) or (None, why)."""
        w = self._tracker.where or {}
        anchor_name = self._tracker.place_for_code(w["code"]) if w.get("code") and \
            abs((w.get("at") or 0) - (self._player_t or 0)) < 1800 else None
        anchor = self._db.locations.get(anchor_name) if anchor_name else None
        if anchor is not None and anchor.kind == "surface" and anchor.body == body.name:
            kind = classify(anchor.name, anchor.category)
            if kind == "city" or "spaceport" in anchor.name.lower():
                city = next((c for c in CITY_ANCHOR if c.lower() in anchor.name.lower()
                             or anchor.name == CITY_ANCHOR[c]), None)
                return self._db.locations.get(CITY_ANCHOR.get(city, ""), anchor), "hangar", 0.5, 6_000
            return anchor, "place", 0.3, 15_000
        lat_p, _, alt_p = body.lat_lon_alt(body.to_local(self._player, self._player_t))
        matches = []
        for loc in self._db.locations.values():
            if loc.source != "db" or loc.kind != "surface" or loc.body != body.name or loc.pos is None:
                continue
            lat, _, alt = body.lat_lon_alt(loc.pos)
            score = max(abs(lat - lat_p) / 0.02, abs(alt - alt_p) / (3_000 if alt > 20_000 else 600))
            if score < 1.0:
                matches.append((score, loc))
        if not matches:
            return None, (f"Your reading isn't at any place Quantum knows on {body.name}. Land at an outpost, "
                          "city or landing zone that's on the map, then take another /showlocation")
        matches.sort(key=lambda m: m[0])
        if any(dist(m[1].pos, matches[0][1].pos) > 5_000 for m in matches[1:]):
            names = ", ".join(sorted({m[1].name for m in matches[:4]}))
            return None, (f"That reading fits more than one place ({names}). Open the card of the place you're "
                          "at on the map and use \"I'm here: calibrate\", or land somewhere else")
        return matches[0][1], "place", 0.3, 15_000

    def dr_align_reading(self, body_name, arrived_ms=0):
        """Planet alignment job, steps 3 and 4: a /showlocation taken on that planet or moon after you
        pressed "I've arrived", and the place it's at. -> {ok, place, age} or {ok: False, why}."""
        with self._lock:
            body = self._db.bodies.get(body_name)
            if not body:
                return {"ok": False, "why": "unknown"}
            if not self._player or not self._player_t:
                return {"ok": False, "why": "none"}
            age = time.time() - self._player_t
            if (arrived_ms and self._player_t * 1000 < arrived_ms - 2000) or age > 900:
                return {"ok": False, "why": "old"}
            if self._player_sys != body.system:
                return {"ok": False, "why": f"That reading is in {self._player_sys}, not {body.system}."}
            near = self._db.body_near(self._player, self._player_sys)
            if near is not body:
                return {"ok": False, "why": f"That reading isn't on {body.name}"
                                            f"{f' (it is near {near.name})' if near else ''}. Take it once you've landed there."}
            lat, _, alt = body.lat_lon_alt(body.to_local(self._player, self._player_t))
            if alt > 3_000:
                return {"ok": False, "why": f"You're {alt / 1000:.1f} km up. Land first, then take the /showlocation."}
            tgt = self._align_target(body)
            if tgt[0] is None:
                return {"ok": False, "why": tgt[1]}
            return {"ok": True, "place": tgt[0].name, "age": age}

    def dr_align_submit(self, body_name, arrived_ms=0):
        """Planet alignment job, step 5: line the planet up from your reading and send it, even if it was
        lined up before (an earlier version, or by the community): this is the alignment for this build."""
        with self._lock:
            chk = self.dr_align_reading(body_name, arrived_ms)
            if not chk.get("ok"):
                why = chk.get("why")
                return {"ok": False, "error": {"none": "Type /showlocation in game first", "old": "Take a new /showlocation: "
                        "the last one is from before you arrived"}.get(why, why)}
            if not self._tracker.build:
                return {"ok": False, "error": "Quantum hasn't read the game version from Game.log yet. Give it a moment and try again"}
            body = self._db.bodies[body_name]
            target, mode, lat_tol, alt_tol = self._align_target(body)
            res = self._db.auto_calibrate(body.name, target, self._player, self._player_t, lat_tol, alt_tol, mode)
            if not res.get("ok"):
                return {"ok": False, "error": f"Your reading doesn't line up with {target.name} (latitude or height is off). "
                                              "Stand at the place itself and take another /showlocation"}
            self._record_cal("manual", body.name, target.name, res["correction"])
            self._calibration = {"body": body.name, "place": target.name, "correction": res["correction"],
                                 "at": time.time(), "quality": mode}
            self._settings["last_calibration"] = self._calibration
            self._static_version += 1
            self._save_settings()
            user = self._dr_cfg().get("username") or (self._dr_cfg().get("uex_user") or {}).get("username")
            return {"ok": True, "place": target.name, "correction": res["correction"], "shared": bool(user and self._community.url),
                    "note": None if user else "Saved on your map. Add your UEX Secret Key in Settings so alignments are shared"}

    def dr_align_jobs(self):
        """Planet alignment jobs: every planet and moon you can land on, for this game build: agreed (live for
        everyone), waiting for a second alignment, aligned by you, or still to do."""
        build = self._game_build()
        if not build:
            return {"ok": False, "error": "Start Star Citizen once so Quantum can read the game version from Game.log"}
        r = self._community.alignments(build)
        if r is None:
            r = {"agreed": {}, "waiting": {}}
            offline = True
        else:
            offline = False
            self._align_server = dict(r, build=build, at=time.time())
        hist = [e for e in self._cal_file().get("history", []) if str(e.get("build")) == build
                and (str(e.get("kind", "")).startswith("auto-") or e.get("kind") == "manual")]
        mine = {e["body"]: e for e in hist}
        places = {}
        for L in self._db.locations.values():
            if L.kind == "surface" and L.source == "db" and L.body:
                places.setdefault(L.body, []).append(L.name)
        jobs = []
        for b in sorted(self._db.bodies.values(), key=lambda b: (b.system, b.kind != "planet", b.name)):
            if not can_align(b):
                continue
            a = r["agreed"].get(b.name)
            st = "live" if a else "mine" if b.name in mine else "waiting" if r["waiting"].get(b.name) else "open"
            pl = sorted(places.get(b.name, []))
            jobs.append({"body": b.name, "system": b.system, "kind": b.kind, "status": st,
                         "others": r["waiting"].get(b.name, 0) - (1 if b.name in mine else 0),
                         "reporters": a["reporters"] if a else None, "mine_at": mine[b.name]["reading_utc"] if b.name in mine else None,
                         "places": pl[:4], "place_count": len(pl), "you_here": self._player_sys == b.system and bool(
                             self._player and self._db.body_near(self._player, b.system) is b)})
        return {"ok": True, "build": build, "jobs": jobs, "offline": offline, "you_in": self._player_sys,
                "systems": sorted({j["system"] for j in jobs})}

    def dr_photo_jobs(self, refresh=False):
        """Picture jobs: ships and vehicles, components and commodities that have no picture yet (none on
        the Star Citizen Wiki, none approved on Quantum). Worked out at most every 10 minutes."""
        c = getattr(self, "_photo_jobs", None)
        if c and not refresh and time.time() - c[0] < 600:
            return c[1]

        def run():
            mine = self._community.photos() or {}
            jobs = []
            vehicles, _ = self._uex.get("vehicles")
            for v in vehicles:
                if is_concept(v) or v.get("is_addon") or v.get("url_photo"):
                    continue
                name = v.get("name_full") or v.get("name")
                if name and self._pic_key(name) not in mine:
                    jobs.append({"kind": "vehicle", "name": name, "label": name, "title": name,
                                 "group": "Ship" if not v.get("is_ground_vehicle") else "Ground vehicle"})
            refs = []
            rows, _ = self._uex.get("commodities")
            for co in rows:
                if co.get("is_available_live", 1) and (co.get("is_buyable") or co.get("is_sellable")):
                    refs.append(("commodity", co.get("wiki") or co.get("name"), co.get("name"), co.get("kind") or "Commodity"))
            cats = self.uex_component_categories()
            for cat in (cats.get("items") or []) if cats.get("ok") else []:
                try:
                    items, _ = self._uex.get("items", {"id_category": int(cat["id"])})
                except uex.UexError:
                    continue
                for i in items:
                    if not i.get("is_commodity") and i.get("name"):
                        refs.append(("component", i.get("wiki") or i.get("name"), i.get("name"), cat.get("name") or "Component"))
            pics = self._wikiapi.pictures([r[1] for r in refs])
            seen = set()
            for kind, ref, label, group in refs:
                key = (kind, self._pic_key(ref))
                if key in seen or pics.get(ref) or self._pic_key(ref) in mine:
                    continue
                seen.add(key)
                # title: the name the server keeps the picture under (and the job's claim is held under)
                jobs.append({"kind": kind, "name": ref, "label": label, "group": group,
                             "title": urllib.parse.unquote(str(ref).rstrip("/").rsplit("/", 1)[-1]).replace("_", " ").strip()})
            jobs.sort(key=lambda j: ({"vehicle": 0, "component": 1, "commodity": 2}[j["kind"]], j["group"], j["label"]))
            out = {"ok": True, "jobs": jobs, "counts": {k: sum(1 for j in jobs if j["kind"] == k) for k in ("vehicle", "component", "commodity")}}
            self._photo_jobs = (time.time(), out)
            return out
        return self._uex_call(run)

    def dr_jobs(self, system=None, sort="oldest"):
        """Datarunner jobs: commodity terminals whose prices are the most out of date, oldest first
        (or nearest first). Uses UEX's data with newer Quantum community reports laid over it, so a
        terminal someone just reported drops down the list for everybody."""
        def run():
            now = time.time()
            terms = self._dr_terminals()
            places = self._uex.place_map(self._db.locations)
            rows, at = self._uex.get("commodities_prices_all")
            rows = self._community.overlay(rows)
            by = {}
            for r in rows:
                if r.get("id_terminal") not in terms:
                    continue
                for side in ("buy", "sell"):
                    if r.get(f"price_{side}"):
                        # None: UEX has never had a report for this price (kept apart from real ages,
                        # so a price that's 400 days old isn't called "never reported")
                        by.setdefault(r["id_terminal"], []).append(
                            max(0.0, (now - r["date_modified"]) / 86400) if r.get("date_modified") else None)
            mine = {}
            for e in self._dr_report_log():
                if not e.get("test") or not self._dr.live:
                    mine[e.get("id_terminal")] = max(mine.get(e.get("id_terminal"), 0), e.get("at", 0))
            spot = None
            if self._game_on():
                spot = self._log_spot(self._tracker.cur or {})[0]
            jobs = []
            hk = self._hidden_keys()
            unplaced = {services._key(n): n for n in self._unplaced}
            NEVER = 100000.0                                     # sorts after every real age
            for tid, raw in by.items():
                t = terms[tid]
                if system and t.get("star_system_name") != system:
                    continue
                if not uex.is_live(t) or _place_key(uex.place_name(t)) in hk:
                    continue                                 # not in the game: no job to do there
                known = sorted(a for a in raw if a is not None)
                never = len(raw) - len(known)
                ages = known + [NEVER] * never
                # a place with no position yet (a new outpost or depot) is still named, so its job can
                # offer "Map it too" instead of nothing
                place = places.get(tid) or unplaced.get(services._key(uex.place_name(t)))
                jobs.append({"id": tid, "name": t.get("name"), "where": uex.where(t), "system": t.get("star_system_name"),
                             "place": place, "here": bool(spot and place == spot), "dist": self._dist_from_you(place),
                             "rows": len(ages), "stale": sum(1 for a in ages if a >= 3),
                             # oldest / median: real ages in days; None when no price there was ever reported
                             "oldest": round(known[-1], 1) if known else None,
                             "median": round(ages[len(ages) // 2], 1) if ages[len(ages) // 2] < NEVER else None,
                             "sort": ages[len(ages) // 2], "sort_oldest": ages[-1],
                             "days": round(sum(min(a, 60) for a in ages), 1),
                             # the average age of prices that have been reported, and how many never were
                             "avg": round(sum(known) / len(known), 1) if known else None,
                             "never": never,
                             "mine": mine.get(tid) if mine.get(tid, 0) > now - 86400 else None})
            if sort == "nearest":
                jobs.sort(key=lambda j: (j["dist"] is None, j["dist"] or 0, -j["sort"]))
            else:
                jobs.sort(key=lambda j: (-j["sort"], -j["sort_oldest"]))
            for j in jobs:
                j.pop("sort"), j.pop("sort_oldest")
            systems = sorted({t.get("star_system_name") for t in terms.values() if t.get("star_system_name")})
            return {"ok": True, "jobs": jobs[:80], "total": len(jobs), "systems": systems, "you_in": self._player_sys,
                    "at": at}
        return self._uex_call(run)

    # ------------------------------------------------------------ updates
    def _check_update(self, delay=6):
        time.sleep(delay)                          # after start-up, so the window isn't kept waiting
        self._update = self._updater.check()

    def update_status(self, recheck=False):
        if recheck:
            self._update = self._updater.check()
        return {"current": updater.VERSION, "latest": self._update, "progress": self._updater.progress(),
                "skipped": self._settings.get("skip_update"), "just_updated": "--updated" in sys.argv}

    def update_download(self):
        return self._updater.download()

    def update_install(self):
        """Swap in the downloaded, verified version and restart into it."""
        r = self._updater.install_and_restart()
        if r.get("ok"):
            def close():
                time.sleep(0.4)
                try:
                    self.shutdown()
                finally:
                    os._exit(0)
            threading.Thread(target=close, daemon=True).start()
        return r

    def update_skip(self, version):
        self._settings["skip_update"] = version
        self._save_settings()
        return {"ok": True}

    def dr_ack(self):
        """The user has read the warning that reports are tied to their UEX account."""
        self._dr_cfg()["ack"] = int(time.time())
        self._save_settings()
        return {"ok": True}

    def dr_open_folder(self):
        self._dr.test_dir.mkdir(parents=True, exist_ok=True)
        if os.name == "nt":
            os.startfile(self._dr.test_dir)
        return {"ok": True, "folder": str(self._dr.test_dir)}

    def uex_commodities(self):
        def run():
            rows, at = self._uex.get("commodities")
            out = [{"id": c["id"], "name": c["name"], "code": c["code"], "kind": c.get("kind"), "wiki": c.get("wiki"),
                    "raw": bool(c.get("is_raw")), "mineral": bool(c.get("is_mineral")),
                    "harvestable": bool(c.get("is_harvestable")), "volatile": bool(c.get("is_volatile_qt")),
                    "illegal": bool(c.get("is_illegal")), "buy": c.get("price_buy"), "sell": c.get("price_sell")}
                   for c in rows if c.get("is_available_live", 1) and (c.get("is_buyable") or c.get("is_sellable"))]
            return {"ok": True, "items": sorted(out, key=lambda c: c["name"]), "at": at}
        return self._uex_call(run)

    def uex_market(self, id_commodity):
        """Where to buy and sell one commodity, best price first."""
        def run():
            terms = self._uex.terminals()
            places = self._uex.place_map(self._db.locations)
            rows, at = self._uex.get("commodities_prices_all")
            rows = self._community.overlay(rows)              # newer datarunner reports from Quantum users
            buy, sell = [], []
            for r in rows:
                t = terms.get(r["id_terminal"])
                if r["id_commodity"] != id_commodity or not t:
                    continue
                place = places.get(r["id_terminal"])
                base = {"terminal": t.get("name"), "where": uex.where(t), "system": t.get("star_system_name"),
                        "place": place, "dist": self._dist_from_you(place), "updated": r.get("date_modified"),
                        "max_box": t.get("max_container_size"), "containers": r.get("container_sizes")}
                if r.get("price_buy"):
                    buy.append(dict(base, price=r["price_buy"], avg=r.get("price_buy_avg"), scu=r.get("scu_buy"),
                                    status=r.get("status_buy"), community=r.get("community_buy")))
                if r.get("price_sell"):
                    sell.append(dict(base, price=r["price_sell"], avg=r.get("price_sell_avg"),
                                     scu=r.get("scu_sell_stock"), status=r.get("status_sell"), community=r.get("community_sell")))
            buy.sort(key=lambda x: x["price"])
            sell.sort(key=lambda x: -x["price"])
            return {"ok": True, "buy": buy, "sell": sell, "at": at}
        return self._uex_call(run)

    def uex_vehicles(self):
        """Every ship and ground vehicle, with where to buy and rent it in game and for how much."""
        def run():
            vehicles, at = self._uex.get("vehicles")
            vehicles = with_extra_vehicles(vehicles)
            terms = self._uex.terminals()
            places = self._uex.place_map(self._db.locations)
            spots = {}

            def add(kind, rows, price_keys):
                for r in rows:
                    t = terms.get(r.get("id_terminal"))
                    price = next((r[k] for k in price_keys if r.get(k)), None)
                    if not t or not price:
                        continue
                    place = places.get(r["id_terminal"])
                    spots.setdefault(r.get("id_vehicle"), {"buy": [], "rent": []})[kind].append({
                        "where": uex.where(t), "place": place, "system": t.get("star_system_name"),
                        "price": price, "dist": self._dist_from_you(place), "updated": r.get("date_modified")})
            add("buy", self._uex.get("vehicles_purchases_prices_all")[0], ("price_buy",))
            add("rent", self._uex.get("vehicles_rentals_prices_all")[0], ("price_rent", "price", "price_buy"))
            roles = VEHICLE_ROLES
            wiki = self._wikiapi.vehicle_summary(wait=True)    # medical beds and cargo grid, from the wiki
            out = []
            for v in vehicles:
                # Concepts are shown too (flagged), so a ship you've pledged for, like a new Constellation
                # Mk V, can be looked up; add-on modules that aren't ships stay out.
                if not listed_vehicle(v) and not (is_concept(v) and not v.get("is_addon")):
                    continue
                sp = spots.get(v["id"], {"buy": [], "rent": []})
                for k in ("buy", "rent"):
                    sp[k].sort(key=lambda x: x["price"])
                out.append({
                    "id": v["id"], "name": v.get("name"), "full": v.get("name_full") or v.get("name"),
                    "maker": v.get("company_name") or "", "scu": v.get("scu") or 0, "crew": v.get("crew") or "",
                    "pad": v.get("pad_type"), "ground": bool(v.get("is_ground_vehicle")),
                    "roles": self._vehicle_roles(v, wiki),
                    "qfuel": v.get("fuel_quantum"), "hfuel": v.get("fuel_hydrogen"),
                    "addon": bool(v.get("is_addon")), "concept": is_concept(v), "aka": vehicle_aka(v),
                    "store": store_url(v), "photo": self._vehicle_photo(v), "buy": sp["buy"], "rent": sp["rent"]})
            out.sort(key=lambda v: (v["buy"][0]["price"] if v["buy"] else 9e12, v["full"]))
            return {"ok": True, "vehicles": out, "at": at}
        return self._uex_call(run)

    CARGO_MIN = 40          # SCU of cargo grid that makes a ship a cargo hauler too (Cutlass Black 46, Carrack 456)

    def _vehicle_roles(self, v, wiki):
        """UEX's roles, plus what the ship can actually do: Medical when it has a medical bed, Cargo when it
        has a real cargo grid (from the wiki's numbers when it has them, else UEX's SCU)."""
        out = []
        for _, label in VEHICLE_ROLES:
            if label not in out and any(v.get(f) for f, l in VEHICLE_ROLES if l == label):
                out.append(label)
        w = next((wiki[str(k).lower()] for k in (v.get("uuid"), v.get("name"), v.get("slug"), v.get("name_full"))
                  if k and str(k).lower() in wiki), None) or {}
        if not v.get("is_ground_vehicle"):
            if w.get("medical_beds") and "Medical" not in out:
                out.append("Medical")
            cargo = w.get("cargo") if w else v.get("scu")
            if (cargo or 0) >= self.CARGO_MIN and "Cargo" not in out:
                out.insert(0, "Cargo")
        return out

    def wiki_image(self, ref):
        """The picture for an item page: one you (the server owner) put in its place, else the wiki's,
        else one a Quantum user sent in and you approved."""
        key = self._pic_key(ref)
        over = self._community.photo_overrides().get(key)
        return over or self._wiki_image(ref) or self._community.photos().get(key) or \
            self._part_images.get(str(ref or "").lower())

    def _wiki_image(self, ref):
        """Picture for an item from the Star Citizen Wiki (its page's main image), cached. ref is the
        wiki URL UEX gives, or a page title. A page about armour or clothing (a name a ship part shares)
        counts as no picture."""
        if not ref:
            return None
        try:
            return self._wikiapi.pictures([ref], size=720).get(ref)
        except Exception:
            return None

    def _item_spots(self):
        """id_item -> where it's sold, cheapest first."""
        terms = self._uex.terminals()
        places = self._uex.place_map(self._db.locations)
        spots = {}
        for r in self._uex.get("items_prices_all")[0]:
            t = terms.get(r.get("id_terminal"))
            if not t or not r.get("price_buy"):
                continue
            place = places.get(r["id_terminal"])
            spots.setdefault(r["id_item"], []).append({
                "where": uex.where(t), "shop": r.get("terminal_name"), "place": place,
                "system": t.get("star_system_name"), "price": r["price_buy"],
                "dist": self._dist_from_you(place), "updated": r.get("date_modified")})
        for v in spots.values():
            v.sort(key=lambda x: x["price"])
        return spots

    COMPONENT_HINTS = ("vehicle", "ship", "cooler", "power plant", "quantum drive", "shield generator", "missile",
                       "turret", "mining laser", "mining module", "gadget", "salvage", "tractor", "radar", "bomb",
                       "jump module", "jump drive")
    COMPONENT_SKIP = ("clothing", "armor", "undersuit", "jumpsuit", "helmet", "personal", "fps", "food", "drink",
                      "medical", "tool", "decoration", "flair", "paint", "livery", "utility")

    # Categories UEX lists that hold no ship components (whole ships are on the Vehicles tab)
    COMPONENT_EMPTY = ("vehicle",)

    # Parts UEX doesn't list yet (new ones like the RSI Discovery's cooler, power plants and radar, the
    # Helix mining lasers, flight blades) come from the Star Citizen Wiki, which reads the game files:
    # (words in a UEX category's name, the wiki's item type, a test on the part's class name or None).
    # Kinds UEX has no category for at all get one of their own (WIKI_ONLY).
    WIKI_KINDS = (("mining laser", "WeaponMining", None),
                  ("flight blade", "FlightController", r"_blade_(spd|hnd)$|_flight_blade_(spd|hnd)$"),
                  ("cooler", "Cooler", None), ("power plant", "PowerPlant", None), ("radar", "Radar", None),
                  ("quantum drive", "QuantumDrive", None), ("shield", "Shield", None))
    WIKI_ONLY = {"WeaponMining": ("Mining Lasers", "Mining"), "FlightController": ("Flight Blades", "Systems")}

    @classmethod
    def _wiki_kind(cls, category_name):
        nm = (category_name or "").lower()
        if any(k in nm for k in ("rack", "turret", "module", "gadget", "mount")) and "mining laser" not in nm:
            return None
        return next(((t, test) for words, t, test in cls.WIKI_KINDS if words in nm), None)

    @staticmethod
    def _blade_ship(class_name):
        """'controller_flight_aegs_gladius_blade_spd' -> ('Aegis Gladius', 'Speed')."""
        m = re.match(r"(?i)controller_flight_([a-z]{4})_(.+?)_(?:flight_)?blade_(spd|hnd)$", class_name or "")
        if not m:
            return None, None
        maker = gamelog.MAKERS.get(m.group(1).upper(), m.group(1).upper())
        ship = " ".join(w.capitalize() if not re.match(r"^[a-z]?\d", w) else w.upper() for w in m.group(2).split("_"))
        return f"{maker} {ship}", {"spd": "Speed", "hnd": "Handling"}[m.group(3).lower()]

    def _wiki_parts(self, wtype, test=None):
        """The wiki's parts of one kind, as Components-tab rows (no UEX id; the uuid is the id)."""
        try:
            raw = self._wikiapi.items_of_type(wtype)
        except Exception:
            return []
        terms = places = None
        out = []
        for d in raw:
            if not d.get("name") or (test and not re.search(test, d.get("class_name") or "", re.I)):
                continue
            if wtype != "FlightController" and re.search(r"(?i)\b(test|template|placeholder)\b|_ai_|_npc", f"{d.get('class_name')} {d['name']}"):
                continue
            name, vehicle = d["name"], None
            if wtype == "FlightController":
                vehicle, kind = self._blade_ship(d.get("class_name"))
                if vehicle and "blade" in name.lower() and vehicle.split(" ", 1)[-1].lower() not in name.lower():
                    name = f"{vehicle.split(' ', 1)[-1]} {kind} Flight Blade"
            buy = []
            if d.get("prices"):
                if terms is None:
                    try:
                        terms, places = self._uex.terminals(), self._uex.place_map(self._db.locations)
                    except Exception:
                        terms, places = {}, {}
                for p in d["prices"]:
                    t = terms.get(p.get("terminal_id"))
                    place = places.get(p.get("terminal_id"))
                    buy.append({"where": uex.where(t) if t else (p.get("where") or p.get("terminal") or ""),
                                "shop": p.get("terminal"), "place": place, "system": p.get("system"),
                                "price": p["price"], "dist": self._dist_from_you(place), "updated": p.get("updated")})
                buy.sort(key=lambda x: x["price"])
            size = d.get("size")
            game = self._game_view(d.get("uuid"), d["name"], size)
            ref = name                                         # its Star Citizen Wiki page title
            if d.get("image"):
                self._part_images[ref.lower()] = d["image"]     # the wiki API's own picture, if the page has none
            out.append({"id": d.get("uuid") or name, "name": name, "maker": d.get("maker") or "",
                        "size": None if str(size if size is not None else "").strip() in ("", "0") and wtype != "WeaponMining"
                        else size, "grade": d.get("grade"), "category": None, "vehicle": vehicle,
                        "wiki": ref, "web_url": d.get("web_url"), "store": None, "exclusive": False,
                        "note": "From the Star Citizen Wiki (game files): UEX doesn't list it yet, so shop prices may be missing.",
                        "buy": buy, "uuid": d.get("uuid"), "source": "wiki", "image": d.get("image"),
                        "game": game or ({"maker": d.get("maker"), "grade": d.get("grade"), "class": d.get("class"),
                                          "size": size, "stats": {}} if d.get("stats") else None),
                        "extra": d.get("stats") or []})
        return out

    def _with_wiki_parts(self, rows, category_name, cat_id=None, index=False):
        """UEX's parts for a category plus the wiki's ones UEX doesn't have (matched by uuid or name)."""
        kind = self._wiki_kind(category_name)
        if not kind:
            return rows
        have = {(r.get("uuid") or "").lower() for r in rows} | {(r.get("name") or "").lower() for r in rows}
        for w in self._wiki_parts(*kind):
            if (w.get("uuid") or "").lower() in have or w["name"].lower() in have:
                continue
            have.add(w["name"].lower())
            if index:
                rows.append({"id": w["id"], "name": w["name"], "maker": w["maker"], "size": w["size"], "grade": w["grade"],
                             "cat": cat_id, "cat_name": category_name, "wiki": w["wiki"]})
            else:
                rows.append(w)
        return rows

    @staticmethod
    def _slot_type_for(category):
        """The My Fleet slot type a UEX component category fits ("Coolers" -> "Cooler"), or None."""
        nm = (category or "").lower()
        if "jump" in nm:                                  # "Jump Modules": a module, but one you fit like a part
            return "JumpDrive"
        if any(k in nm for k in ("rack", "turret", "module", "gadget", "mount", "gimbal", "attachment")):
            return None
        for typ, (_, words) in fleet.SLOT_TYPES.items():
            if any(w in nm for w in words):
                return typ
        return None

    def component_fit_targets(self, category):
        """For the Components tab's "Fit to a ship": every ship in My Fleet with its slots of the kind
        this category fits, and what's in each now (your swap, else stock)."""
        slot = self._slot_type_for(category)
        if not slot:
            return {"ok": True, "slot": None, "ships": []}
        return self._uex_call(lambda: self._fit_targets(slot))

    def _fit_targets(self, slot):
        rows = self._vehicle_rows()
        fl = list(self._fleet())

        def one(f):
            v = rows.get(f["vehicle_id"], {})
            name = v.get("name") or f["name"]
            out = {"uid": f["uid"], "name": v.get("name_full") or f["name"], "main": bool(f.get("main")),
                   "photo": self._vehicle_photo(v), "slots": []}
            try:
                data = self._wikiapi.vehicle([v.get("uuid"), name, v.get("slug"), name.lower().replace(" ", "-"),
                                              v.get("name_full")])
            except Exception:
                data = None
            if not data:
                out["error"] = "The Star Citizen Wiki has no loadout for this ship (or it can't be reached)"
                return out
            fitted = self._loadout_of(f, "primary")["loadout"]       # the Components tab fits your primary loadout
            for s_ in fleet.Wiki.loadout(data)["slots"]:
                if s_["type"] != slot:
                    continue
                fit = fitted.get(s_["port"])
                fit = {"name": fit} if isinstance(fit, str) else fit
                out["slots"].append({"port": s_["port"], "label": s_["label"], "size": s_.get("size"),
                                     "where": s_.get("where") or "", "stock": (s_.get("stock") or {}).get("name"),
                                     "fitted": fit["name"] if fit else None})
            return out
        from concurrent.futures import ThreadPoolExecutor
        with ThreadPoolExecutor(max_workers=6) as ex:
            ships = list(ex.map(one, fl))
        return {"ok": True, "slot": slot, "label": fleet.SLOT_TYPES[slot][0], "ships": ships}

    def _game_view(self, uuid, name, size):
        """A component's numbers from the game files, for its detail page."""
        try:
            sz = int(size) if str(size or "").strip() not in ("", "0") else None
        except ValueError:
            sz = None
        g = self._game.find(uuid, name, sz)
        if not g:
            return None
        st = dict(g.get("stats") or {})
        pw = g.get("power") or {}
        for k in ("power_use", "power_min", "coolant_make", "power_make"):
            if pw.get(k) is not None:
                st[k] = pw[k]
        return {"type": g.get("type"), "class": g.get("class"), "grade": g.get("grade"), "size": g.get("size"),
                "maker": g.get("maker"), "stats": st}

    def uex_component_categories(self):
        """Ship upgrade categories: coolers, power plants, quantum drives, shields, weapons, mining…"""
        def run():
            rows, _ = self._uex.get("categories")
            items = [c for c in rows if (c.get("type") or "item") == "item"]
            def txt(c):
                return f"{c.get('section') or ''} {c.get('name') or ''}".lower()
            pick = [c for c in items if any(h in txt(c) for h in self.COMPONENT_HINTS)
                    and not any(k in txt(c) for k in self.COMPONENT_SKIP)
                    and (c.get("name") or "").strip().lower().rstrip("s") not in self.COMPONENT_EMPTY] or items
            out = [{"id": c["id"], "name": c.get("name"), "section": c.get("section") or "Other",
                    "slot": self._slot_type_for(c.get("name"))} for c in pick]
            for wtype, (label, section) in self.WIKI_ONLY.items():      # kinds UEX has no category for
                if not any((self._wiki_kind(c["name"]) or (None,))[0] == wtype for c in out):
                    out.append({"id": f"wiki:{wtype}", "name": label, "section": section, "slot": None, "wiki": True})
            out.sort(key=lambda c: (c["section"], c["name"] or ""))
            return {"ok": True, "items": out}
        return self._uex_call(run)

    # Ship guns by how they fire, for the Components tab: (id, label, words in the name). Checked in this
    # order, so "Distortion Repeater" is a distortion weapon and "Scattergun" isn't a plain gun.
    WEAPON_TYPES = (("distortion", "Distortion", ("distortion",)), ("scattergun", "Scatterguns", ("scattergun", "scatter gun")),
                    ("gatling", "Gatlings", ("gatling",)), ("repeater", "Repeaters", ("repeater",)),
                    ("cannon", "Cannons", ("cannon",)), ("beam", "Beams", ("beam",)),
                    ("massdriver", "Mass drivers", ("mass driver", "railgun", "rail gun")))

    @classmethod
    def weapon_type(cls, name, game=None):
        """A ship gun's kind (see WEAPON_TYPES), from its name and the game files' numbers; "other" when
        neither says (a few named guns, like the Jericho)."""
        n = (name or "").lower()
        st = (game or {}).get("stats") or {}
        dmg = str(st.get("damage_type") or "").lower()
        if dmg == "distortion":
            return "distortion"
        for key, _, words in cls.WEAPON_TYPES:
            if any(w in n for w in words):
                return key
        if dmg == "beam":
            return "beam"
        rpm = st.get("rpm") or 0
        if rpm >= 900:                                   # very fast fire: a gatling if ballistic, else a repeater
            return "gatling" if dmg == "physical" else "repeater"
        if 0 < rpm <= 200:
            return "cannon"
        return "other"

    def uex_component_index(self):
        """Every part in every component category, small enough to search all at once from the
        Components tab: name, maker, size, grade, its category and (for guns) what kind it is."""
        def run():
            cats = self.uex_component_categories()
            if not cats.get("ok"):
                return cats
            out, at = [], None
            for c in cats["items"]:
                if str(c["id"]).startswith("wiki:"):
                    rows = []
                else:
                    try:
                        rows, at = self._uex.get("items", {"id_category": int(c["id"])})
                    except uex.UexError:
                        continue
                n0 = len(out)
                for i in rows:
                    if i.get("is_commodity") or not i.get("name"):
                        continue
                    size = i.get("size")
                    row = {"id": i["id"], "name": i.get("name"), "maker": i.get("company_name") or "",
                           "size": None if str(size or "").strip() in ("", "0") else size, "grade": i.get("quality"),
                           "cat": c["id"], "cat_name": c.get("name"), "wiki": i.get("wiki")}
                    if c.get("slot") == "WeaponGun":
                        try:
                            sz = int(size) if str(size or "").strip() not in ("", "0") else None
                        except ValueError:
                            sz = None
                        row["wtype"] = self.weapon_type(i.get("name"), self._game.find(i.get("uuid"), i.get("name"), sz))
                    out.append(row)
                mine = out[n0:]
                del out[n0:]
                out.extend(self._with_wiki_parts(mine, c.get("name") if not str(c["id"]).startswith("wiki:")
                                                 else ("flight blade" if "Flight" in c["id"] else "mining laser"),
                                                 c["id"], index=True))
                for r in out[n0:]:
                    r["cat_name"] = c.get("name")
                if c.get("slot") == "JumpDrive":           # jump modules UEX doesn't list
                    have = {(r.get("name") or "").lower() for r in out if r["cat"] == c["id"]}
                    for g in self._game.of_kind("JumpDrive", None):
                        if (g.get("name") or "").lower() not in have:
                            out.append({"id": g["uuid"], "name": g["name"], "maker": g.get("maker") or "", "size": g.get("size"),
                                        "grade": g.get("grade"), "cat": c["id"], "cat_name": c.get("name"), "wiki": g["name"]})
            return {"ok": True, "items": out, "types": [[k, label] for k, label, _ in self.WEAPON_TYPES] + [["other", "Other guns"]],
                    "at": at}
        return self._uex_call(run)

    def uex_components(self, id_category):
        """Items in one category with where to buy them and for how much."""
        if str(id_category).startswith("wiki:"):            # a kind only the wiki has (flight blades...)
            wtype = str(id_category)[5:]
            test = next((t for _, w, t in self.WIKI_KINDS if w == wtype), None)
            items = self._wiki_parts(wtype, test)
            items.sort(key=lambda x: (x.get("vehicle") or "", str(x["size"] or ""), x["name"] or ""))
            if not items:
                return {"ok": False, "error": "Couldn't reach the Star Citizen Wiki for these parts. Try again in a minute"}
            return {"ok": True, "items": items, "at": None, "types": None}

        def run():
            rows, at = self._uex.get("items", {"id_category": int(id_category)})
            spots = self._item_spots()
            out = []
            for i in rows:
                if i.get("is_commodity"):
                    continue
                buy = spots.get(i["id"], [])
                size = i.get("size")
                out.append({"id": i["id"], "name": i.get("name"), "maker": i.get("company_name") or "",
                            "size": None if str(size or "").strip() in ("", "0") else size,
                            "grade": i.get("quality"), "category": i.get("category"),
                            "vehicle": i.get("vehicle_name"), "wiki": i.get("wiki"), "store": i.get("url_store"),
                            "exclusive": bool(i.get("is_exclusive_pledge") or i.get("is_exclusive_subscriber")
                                              or i.get("is_exclusive_concierge")),
                            "note": (i.get("notification") or None), "buy": buy,
                            "uuid": i.get("uuid"), "game": self._game_view(i.get("uuid"), i.get("name"), size)})
            cat_name = next((c.get("name") for c in self._uex.get("categories")[0]
                             if str(c.get("id")) == str(id_category)), "")
            slot = self._slot_type_for(cat_name)
            out = self._with_wiki_parts(out, cat_name)
            guns = slot == "WeaponGun"
            if slot == "JumpDrive":                       # every jump module, even ones UEX doesn't list (the Exfiltrate)
                have = {(x.get("uuid") or "").lower() for x in out} | {(x["name"] or "").lower() for x in out}
                for g in self._game.of_kind("JumpDrive", None):
                    if g["uuid"].lower() in have or (g.get("name") or "").lower() in have:
                        continue
                    out.append({"id": g["uuid"], "name": g["name"], "maker": g.get("maker") or "", "size": g.get("size"),
                                "grade": g.get("grade"), "category": None, "vehicle": None, "wiki": g["name"], "store": None,
                                "exclusive": False, "note": None, "buy": [], "uuid": g["uuid"],
                                "game": self._game_view(g["uuid"], g["name"], g.get("size"))})
            if guns:
                for x in out:
                    x["wtype"] = self.weapon_type(x["name"], x["game"])
            out.sort(key=lambda x: (str(x["size"] or ""), x["buy"][0]["price"] if x["buy"] else 9e12, x["name"] or ""))
            return {"ok": True, "items": out, "at": at,
                    "types": [[k, label] for k, label, _ in self.WEAPON_TYPES] + [["other", "Other guns"]] if guns else None}
        return self._uex_call(run)

    def _vehicle_desc(self, d, name):
        """The ship's description: the wiki API's (it comes per language), else the wiki page's intro."""
        desc = d.get("description") if d else None
        if isinstance(desc, dict):
            desc = desc.get("en_EN") or desc.get("en") or next((v for v in desc.values() if isinstance(v, str) and v), None)
        if isinstance(desc, str) and desc.strip():
            return desc.strip()
        try:
            return self._wikiapi.summary(name)
        except Exception:
            return None

    def wiki_text(self, ref):
        """A commodity's (or anything's) description from its Star Citizen Wiki page."""
        try:
            return self._wikiapi.summary(ref)
        except Exception:
            return None

    def vehicle_detail(self, vehicle_id):
        """A ship's own page: crew and seats, beds and medical, cargo and storage, size, speed, quantum,
        defences and weapons, from the Star Citizen Wiki, with UEX's roles."""
        v = self._vehicle_rows().get(int(vehicle_id))
        if not v:
            return {"ok": False, "error": "Vehicle not found"}
        name = v.get("name") or ""
        d = self._wikiapi.vehicle([v.get("uuid"), name, v.get("slug"), name.lower().replace(" ", "-"),
                                   v.get("name_full")]) or {}
        g = lambda *path: fleet._dig(d, *path)
        seat = d.get("seating") or {}
        size = d.get("sizes") or d.get("dimension") or {}
        inv = d.get("vehicle_inventory")
        out = {
            "ok": True, "id": v["id"], "name": v.get("name_full") or name, "maker": v.get("company_name") or "",
            "photo": self._vehicle_photo(v), "store": store_url(v), "wiki": bool(d),
            "roles": self._vehicle_roles(v, self._wikiapi.vehicle_summary()),
            "career": d.get("career") or d.get("role"), "description": self._vehicle_desc(d, name),
            "crew_min": g("crew", "min") or v.get("crew"), "crew_max": g("crew", "max"),
            "seats": seat.get("crew_stations"), "beds": seat.get("beds"), "medical_beds": _bed_count(seat.get("medical_beds")),
            "medical_tier": _tier(d.get("max_medical_tier")), "ejection": seat.get("ejection_seats"), "escape_pods": seat.get("escape_pods"),
            "jump_seats": seat.get("jump_seats"),
            "scu": v.get("scu") or d.get("cargo_capacity") or 0, "ore": d.get("ore_capacity"),
            "storage_scu": round(inv / 1e6, 2) if isinstance(inv, (int, float)) and inv else None,
            "lockers": g("weapon_storage", "slots_total"),
            "length": size.get("length"), "beam": size.get("beam") or size.get("width"), "height": size.get("height"),
            "mass": d.get("mass_total") or d.get("mass"), "pad": v.get("pad_type"), "size_class": d.get("size_class") or v.get("size"),
            "scm": g("speed", "scm"), "max": g("speed", "max"), "boost": g("speed", "boost_forward"),
            "pitch": g("agility", "pitch"), "yaw": g("agility", "yaw"), "roll": g("agility", "roll"),
            "qt_speed": g("quantum", "quantum_speed"), "qt_range": g("quantum", "quantum_range"),
            "qt_spool": g("quantum", "quantum_spool_time"), "h_fuel": g("fuel", "capacity") or v.get("fuel_hydrogen"),
            "q_fuel": g("quantum", "quantum_fuel_capacity") or v.get("fuel_quantum"),
            "shield": g("shield", "hp") or d.get("shield_hp"), "shield_face": g("shield", "face_type"),
            "hull": d.get("health"), "armor": g("armor", "health"), "dps": g("weaponry", "pilot_dps"),
            "missiles": g("weapon_snapshot", "missile_count"), "missile_dmg": g("weaponry", "total_missile_damage"),
            "turrets": (g("weapon_snapshot", "turrets_manned_count") or 0) + (g("weapon_snapshot", "turrets_remote_count") or 0),
            "countermeasures": g("weapon_snapshot", "countermeasures_count"),
            "ir": g("signature", "ir_shields") or g("emission", "ir"), "em": g("signature", "em_shields") or g("emission", "em_idle"),
            "cs": d.get("cross_section_max"), "claim": g("insurance", "claim_time"), "expedite": g("insurance", "expedite_time"),
        }
        return out

    def brand_logos(self):
        """The Star Citizen Wiki's manufacturer icons, for the Vehicles tab."""
        try:
            return {"ok": True, "logos": self._wikiapi.brand_logos()}
        except Exception as e:
            return {"ok": False, "logos": {}, "error": str(e)}

    def wiki_images(self, refs):
        """{ref: picture url} for many wiki pages at once (commodity and component grids). Pictures you
        (the server owner) put in place of the wiki's come first; ones Quantum users sent in (and you
        approved) fill the gaps."""
        refs = list(refs or [])
        got = self._wikiapi.pictures(refs)
        mine, over = self._community.photos(), self._community.photo_overrides()
        for ref in refs:
            k = self._pic_key(ref)
            if over.get(k):
                got[ref] = over[k]
            elif not got.get(ref) and mine.get(k):
                got[ref] = mine[k]
            elif not got.get(ref) and self._part_images.get(str(ref).lower()):
                got[ref] = self._part_images[str(ref).lower()]   # parts from the wiki API (mining lasers, blades)
        return got

    def _vehicle_photo(self, v):
        """UEX's picture of a vehicle, or else one a Quantum user sent in and you approved (sent under the
        vehicle's full name, like "Drake Command Module")."""
        over = self._community.photo_overrides()
        hit = next((over[k] for k in (self._pic_key(v.get("name_full")), self._pic_key(v.get("name"))) if k and k in over), None)
        if hit:
            return hit                                     # you replaced UEX's picture
        if v.get("url_photo"):
            return v["url_photo"]
        mine = self._community.photos()
        return next((mine[k] for k in (self._pic_key(v.get("name_full")), self._pic_key(v.get("name"))) if k and k in mine), None)

    # Approved pictures are checked for every PHOTOS_SYNC_EVERY; when the set changes, photos_version goes
    # up in the live state and the page swaps in the new pictures, without restarting Quantum.
    PHOTOS_SYNC_EVERY = 120

    def _photos_changed(self):
        sig = hash((tuple(sorted(self._community.photos(fresh=True).items())),
                    tuple(sorted(self._community.photo_overrides()))))
        if sig != getattr(self, "_photos_sig", None):
            first = not hasattr(self, "_photos_sig")
            self._photos_sig = sig
            if not first:
                self._photos_version = getattr(self, "_photos_version", 0) + 1
                self._photo_jobs = None                  # an approved picture takes its picture job away

    def _sync_photos(self):
        time.sleep(15)
        while True:
            try:
                if self._community.url:
                    self._photos_changed()
            except Exception as e:
                print("photo sync:", e, flush=True)
            time.sleep(self.PHOTOS_SYNC_EVERY)

    @staticmethod
    def _pic_key(ref):
        return urllib.parse.unquote(str(ref or "").rstrip("/").rsplit("/", 1)[-1]).replace("_", " ").strip().lower()

    def photo_submit(self, kind, name, data_url, replace=False):
        """A picture for something with none, sent to the Quantum server for review. replace: you, the
        server owner, putting it in place of the picture shown now (wrong or poor); it's live at once."""
        if not self._uex.token:
            return {"ok": False, "error": "Add your UEX Bearer Token in Settings to send pictures"}
        user = self._dr_cfg().get("username") or (self._dr_cfg().get("uex_user") or {}).get("username")
        if not user:
            return {"ok": False, "error": "Add your UEX Secret Key in Settings, so the picture is credited to your UEX name"}
        if replace and not self.photo_owner().get("owner"):
            return {"ok": False, "error": "Only the Quantum server's owner can replace a picture"}
        title = urllib.parse.unquote(str(name or "").rstrip("/").rsplit("/", 1)[-1]).replace("_", " ").strip()
        r = self._community.submit_photo(kind, title, data_url, user, replace=bool(replace))
        if r.get("ok") and r.get("approved"):
            try:
                self._photos_changed()                 # live straight away: shown everywhere now
            except Exception:
                pass
        return r

    def photo_owner(self):
        """Whether you're the Quantum server's owner, signed in: then pictures shown in Quantum get a
        Replace button. Asked once every 10 minutes."""
        hit = getattr(self, "_owner_at", None)
        if hit and time.time() - hit[0] < (600 if hit[1].get("owner") else 60):
            return hit[1]
        cfg = self._dr_cfg()
        user = cfg.get("username") or (cfg.get("uex_user") or {}).get("username")
        out = {"owner": False}
        if user and self._community.url and self._uex.token:
            try:
                if cfg.get("secret") and not self._session_token():
                    self._sign_in()
                r = self._community.trust(user) or {}
                out = {"owner": bool(r.get("signed_in") and (r.get("info") or {}).get("owner"))}
            except Exception:
                pass
        self._owner_at = (time.time(), out)
        return out

    # ---- trade routes Quantum users share
    def shared_routes(self, origin=None):
        """Routes from other Quantum users' Planned Routes, with profit per SCU. origin: the Find Routes
        "From" place; a route is kept if it starts there (its planet, or the place itself)."""
        out = []
        for r in self._community.routes():
            loc = self._db.locations.get(r["from_place"])
            planet = getattr(loc, "body", None) or getattr(loc, "parent", None)
            if origin and origin not in (r["from_place"], r.get("from_terminal"), planet, getattr(loc, "system", None)):
                continue
            out.append(dict(r, per_scu=round(r["sell"] - r["buy"], 2),
                            profit=round((r["sell"] - r["buy"]) * r["units"]) if r.get("units") else None))
        return {"ok": True, "routes": out}

    def share_route(self, rid):
        """Share one of your Planned Routes with Quantum users."""
        x = next((r for r in self._runs() if r["id"] == rid), None)
        if not x:
            return {"ok": False, "error": "Route not found"}
        user = self._dr_cfg().get("username") or (self._dr_cfg().get("uex_user") or {}).get("username")
        if not user:
            return {"ok": False, "error": "Add your UEX Secret Key in Settings, so the route is credited to your UEX name"}
        buy, sell = x.get("buy_price") or x.get("plan_buy"), x.get("sell_price") or x.get("plan_sell")
        if not (x.get("commodity") and x.get("from_place") and x.get("to_place") and buy and sell):
            return {"ok": False, "error": "A route needs a commodity, both places, and buy and sell prices to share"}
        return self._community.share_route({"commodity": x["commodity"], "from_place": x["from_place"], "to_place": x["to_place"],
                                            "from_terminal": x.get("from_terminal"), "to_terminal": x.get("to_terminal"),
                                            "buy": buy, "sell": sell, "units": x.get("units"), "notes": x.get("notes")}, user)

    # ------------------------------------------------------------ My Fleet
    def _fleet(self):
        fl = self._settings.setdefault("fleet", [])
        for f in fl:
            self._loadouts(f)
        return fl

    # ---- loadouts: each ship keeps up to MAX_LOADOUTS named sets of component swaps and power settings.
    # The one being edited in My Fleet is "active"; its swaps and power are also the ship's own "loadout"
    # and "power" (the very same objects), so everything that reads those keeps working. The "primary" one
    # is what the rest of Quantum uses for this ship (the Components tab's fitting, for one).
    MAX_LOADOUTS = 5

    @staticmethod
    def _loadouts(f):
        """The ship's loadouts, made from its single old loadout the first time, with the active one's
        swaps and power linked to the ship's own."""
        L = f.get("loadouts")
        if not isinstance(L, list) or not L:
            L = f["loadouts"] = [{"id": "l1", "name": "Default", "loadout": f.get("loadout") or {}, "power": f.get("power") or {}}]
        L[:] = [x for x in L if isinstance(x, dict) and x.get("id")][:Api.MAX_LOADOUTS] or \
            [{"id": "l1", "name": "Default", "loadout": {}, "power": {}}]
        for x in L:
            x.setdefault("name", "Loadout")
            if not isinstance(x.get("loadout"), dict):
                x["loadout"] = {}
            if not isinstance(x.get("power"), dict):
                x["power"] = {}
        ids = [x["id"] for x in L]
        if f.get("active_loadout") not in ids:
            f["active_loadout"] = ids[0]
        if f.get("primary_loadout") not in ids:
            f["primary_loadout"] = ids[0]
        act = next(x for x in L if x["id"] == f["active_loadout"])
        f["loadout"], f["power"] = act["loadout"], act["power"]
        return L

    def _loadout_of(self, f, lid=None):
        """One of a ship's loadouts: lid, or "primary", or (None) the one being edited."""
        L = self._loadouts(f)
        want = f["primary_loadout"] if lid == "primary" else (lid or f["active_loadout"])
        return next((x for x in L if x["id"] == want), None)

    def _ship(self, uid):
        return next((x for x in self._fleet() if x["uid"] == uid), None)

    def fleet_loadouts(self, uid):
        f = self._ship(uid)
        if not f:
            return {"ok": False, "error": "That ship isn't in your fleet"}
        return {"ok": True, "active": f["active_loadout"], "primary": f["primary_loadout"], "max": self.MAX_LOADOUTS,
                "loadouts": [{"id": x["id"], "name": x["name"], "swaps": len(x["loadout"]), "livery": (x.get("livery") or {}).get("name")}
                             for x in f["loadouts"]]}

    def fleet_loadout_new(self, uid, name, copy=True):
        """A new loadout for this ship, named, starting as a copy of the one shown now (or stock), and
        shown straight away."""
        f = self._ship(uid)
        if not f:
            return {"ok": False, "error": "That ship isn't in your fleet"}
        L = f["loadouts"]
        if len(L) >= self.MAX_LOADOUTS:
            return {"ok": False, "error": f"A ship can have up to {self.MAX_LOADOUTS} loadouts. Delete one first."}
        name = " ".join(str(name or "").split())[:40] or f"Loadout {len(L) + 1}"
        if any(x["name"].lower() == name.lower() for x in L):
            return {"ok": False, "error": f"This ship already has a loadout called {name}"}
        n = 1
        while f"l{n}" in {x["id"] for x in L}:
            n += 1
        cur = self._loadout_of(f)
        L.append({"id": f"l{n}", "name": name, "loadout": json.loads(json.dumps(cur["loadout"])) if copy else {},
                  "power": json.loads(json.dumps(cur["power"])) if copy else {},
                  **({"livery": dict(cur["livery"])} if copy and cur.get("livery") else {})})
        f["active_loadout"] = f"l{n}"
        self._loadouts(f)
        self._save_settings()
        return {"ok": True, "id": f"l{n}"}

    def fleet_loadout_switch(self, uid, lid):
        f = self._ship(uid)
        if not f or not self._loadout_of(f, lid):
            return {"ok": False, "error": "That loadout is gone"}
        f["active_loadout"] = lid
        self._loadouts(f)
        self._save_settings()
        return {"ok": True}

    def fleet_loadout_rename(self, uid, lid, name):
        f = self._ship(uid)
        x = self._loadout_of(f, lid) if f else None
        name = " ".join(str(name or "").split())[:40]
        if not x or not name:
            return {"ok": False, "error": "Give the loadout a name"}
        if any(o["name"].lower() == name.lower() and o is not x for o in f["loadouts"]):
            return {"ok": False, "error": f"This ship already has a loadout called {name}"}
        x["name"] = name
        self._save_settings()
        return {"ok": True}

    def fleet_loadout_primary(self, uid, lid):
        f = self._ship(uid)
        if not f or not self._loadout_of(f, lid):
            return {"ok": False, "error": "That loadout is gone"}
        f["primary_loadout"] = lid
        self._save_settings()
        return {"ok": True}

    def fleet_loadout_delete(self, uid, lid):
        f = self._ship(uid)
        if not f or not self._loadout_of(f, lid):
            return {"ok": False, "error": "That loadout is gone"}
        if len(f["loadouts"]) <= 1:
            return {"ok": False, "error": "A ship always keeps one loadout. Set its parts back to stock instead."}
        f["loadouts"][:] = [x for x in f["loadouts"] if x["id"] != lid]
        self._loadouts(f)                                  # active and primary move to another one if needed
        self._save_settings()
        return {"ok": True}

    def _vehicle_rows(self):
        try:
            return {v["id"]: v for v in with_extra_vehicles(self._uex.get("vehicles", offline=not self._uex.token)[0])}
        except uex.UexError:
            return {}

    def fleet_list(self):
        rows = self._vehicle_rows()
        out = []
        for f in self._fleet():
            v = rows.get(f["vehicle_id"], {})
            prim = self._loadout_of(f, "primary")
            out.append(dict({k: x for k, x in f.items() if k not in ("loadouts", "loadout", "power")},
                            full=v.get("name_full") or f.get("name"), maker=v.get("company_name") or "",
                            scu=v.get("scu") or 0, photo=self._vehicle_photo(v), pad=v.get("pad_type"),
                            swaps=len(prim["loadout"]), loadouts=len(f["loadouts"]), primary_name=prim["name"],
                            total_swaps=sum(len(x["loadout"]) for x in f["loadouts"])))
        return {"ok": True, "ships": out, "main": next((f["uid"] for f in self._fleet() if f.get("main")), None)}

    def fleet_add(self, vehicle_id):
        v = self._vehicle_rows().get(int(vehicle_id))
        if not v:
            return {"ok": False, "error": "Pick a ship from the list"}
        uid = f"s{int(time.time() * 1000)}"
        fl = self._fleet()
        fl.append({"uid": uid, "vehicle_id": v["id"], "name": v.get("name_full") or v.get("name"),
                   "main": not any(f.get("main") for f in fl), "loadout": {}})
        self._loadouts(fl[-1])
        self._save_settings()
        return {"ok": True, "uid": uid}

    def fleet_remove(self, uid):
        fl = self._fleet()
        was_main = any(f["uid"] == uid and f.get("main") for f in fl)
        fl[:] = [f for f in fl if f["uid"] != uid]
        if was_main and fl:
            fl[0]["main"] = True
        self._save_settings()
        return {"ok": True}

    def fleet_set_main(self, uid):
        for f in self._fleet():
            f["main"] = f["uid"] == uid
        self._save_settings()
        return {"ok": True}

    def fleet_loadout(self, uid):
        """The ship's slots stock component in each, and what you've swapped in."""
        f = next((x for x in self._fleet() if x["uid"] == uid), None)
        if not f:
            return {"ok": False, "error": "That ship isn't in your fleet"}
        v = self._vehicle_rows().get(f["vehicle_id"], {})
        name = v.get("name") or f["name"]
        data = self._wikiapi.vehicle([v.get("uuid"), name, v.get("slug"), name.lower().replace(" ", "-"),
                                   v.get("name_full")])
        if not data:
            return {"ok": False, "error": f"The Star Citizen Wiki has no loadout for {f['name']} (or it can't be reached)"}
        lo = fleet.Wiki.loadout(data)
        for s_ in lo["slots"]:                            
            st = s_.get("stock")
            if st:
                g = self._game.stats(st.get("uuid"), st.get("name"), st.get("size"))
                if g:
                    st["stats"] = {**(st.get("stats") or {}), **g}
                    st["source"] = "game"
            fit = (f.get("loadout") or {}).get(s_["port"])
            if isinstance(fit, str):                    
                fit = {"name": fit}
            s_["fitted"] = fit["name"] if fit else None
            if fit:
                gi = self._game.find(fit.get("uuid"), fit["name"], s_.get("size"))
                if gi:
                    s_["fitted_stats"], s_["fitted_grade"], s_["fitted_maker"] = dict(gi["stats"]), gi.get("grade"), gi.get("maker")
                    if s_["type"] == "Cooler":              
                        rec = self._wikiapi.item(gi["uuid"], fit["name"])
                        s_["fitted_stats"].update({k: v for k, v in (fleet.item_stats(rec) if rec else {}).items()
                                                   if k not in s_["fitted_stats"]})
                else:
                    rec = self._wikiapi.item(fit.get("uuid"), fit["name"])
                    s_["fitted_stats"] = fleet.item_stats(rec) if rec else {}
                    s_["fitted_grade"] = (rec or {}).get("grade")
                    s_["fitted_maker"] = ((rec or {}).get("manufacturer") or {}).get("name")
        lo["stock_stats"] = dict(lo["stats"])
        lo["stats"], lo["delta"] = fleet.apply_swaps(lo["stats"], lo["slots"])
        pw = f.get("power") or {}
        mode = pw.get("mode", "scm")
        for fx in lo.get("fixed") or []:                
            st = fx.get("stock") or {}
            g = self._game.stats(st.get("uuid"), st.get("name"), st.get("size"))
            if g:
                st["stats"] = g
        opts = {"pips": None, "mode": mode, "cooling": pw.get("cooling"),
                "parts": (pw.get("parts") or {}).get(mode) or {}, "fixed": lo.get("fixed") or [],
                "armor": lo.get("armor")}
        now, stock = fleet.signatures(lo["slots"], True, **opts), fleet.signatures(lo["slots"], False, **opts)
        if now["em"] or now["ir"]:
            for k in ("em", "ir"):
                lo["stats"][k] = round(now[k])
                d = round(now[k] - stock[k])
                if d:
                    lo["delta"][k] = d
                else:
                    lo["delta"].pop(k, None)
        lo["power"] = {"mode": mode, "cooling": now["cooling"], "cooling_auto": now["cooling_auto"],
                       "custom": bool(opts["parts"]) or not now["cooling_auto"],
                       "cool_make": now["cool_make"], "pips_gen": now["pips_gen"], "pips_used": now["pips_used"]}
        for s_ in lo["slots"] + (lo.get("fixed") or []):
            s_["power"] = now["parts"].get(s_["port"])
        # Flight blade: a slot of its own when aftermarket blades exist for this ship. Its power stays on
        # the fixed "Thrusters" entry; picking a blade changes the ship's speeds where the wiki has them.
        fc = next((x for x in lo.get("fixed") or [] if x["type"] == "FlightController"), None)
        if fc and self._blades_for(fc.get("stock")):
            fit = (f.get("loadout") or {}).get(fc["port"])
            fit = {"name": fit} if isinstance(fit, str) else fit
            blade = {"port": fc["port"], "type": "FlightController", "label": "Flight blade", "size": fc.get("size") or 1,
                     "where": "", "stock": fc.get("stock"), "fitted": fit["name"] if fit else None}
            if fit:
                rec = self._wikiapi.item(fit.get("uuid"), None) if fit.get("uuid") else None
                scm, mx = fleet.flight_speeds(rec)
                blade["fitted_stats"] = {k: v for k, v in (("scm", scm), ("max", mx)) if v}
                blade["fitted_grade"], blade["fitted_maker"] = (rec or {}).get("grade"), ((rec or {}).get("manufacturer") or {}).get("name")
                fc["stock"] = dict(fc.get("stock") or {}, name=fit["name"])
                for k, v in blade["fitted_stats"].items():          # the ship's speeds with this blade
                    if lo["stats"].get(k):
                        d = round(v - lo["stats"][k])
                        lo["stats"][k] = v
                        if d:
                            lo["delta"][k] = d
            lo["slots"].append(blade)
        if now.get("pool"):                               # the guns' shared power pool, shown as one bar
            guns = [x for x in lo["slots"] if x["type"] == "WeaponGun"]
            lo.setdefault("fixed", []).insert(0, {"port": fleet.WEAPONS, "type": fleet.WEAPONS, "label": "Weapons",
                                                  "stock": {"name": f"{len(guns)} gun{'s' if len(guns) != 1 else ''}"},
                                                  "power": now["parts"].get(fleet.WEAPONS)})
        return {"ok": True, "uid": uid, "ship": dict({k: x for k, x in f.items() if k not in ("loadouts", "loadout", "power")},
                                                     full=v.get("name_full") or f["name"], photo=self._vehicle_photo(v),
                                                     scu=v.get("scu") or 0, maker=v.get("company_name") or ""),
                "loadouts": self.fleet_loadouts(uid),
                "game_data": self._game.generated, **lo}

    # ------------------------------------------------------------ liveries (paints)
    @staticmethod
    def _paint_family(name):
        """The ship family paints are made for: 'Cutlass Black' -> 'cutlass', 'Constellation Andromeda' ->
        'constellation', 'Avenger Titan' -> 'avenger', 'C2 Hercules' -> 'hercules', 'F7C-M Super Hornet' -> 'hornet'."""
        words = [w for w in re.findall(r"[a-z0-9\-]+", (name or "").lower()) if w not in ("mk", "ii", "iv", "v", "i")]
        for w in words:
            if re.search(r"[a-z]{4,}", w) and not re.match(r"^[a-z]?\d", w) and w not in ("super", "heavy", "star"):
                return w
        if words and re.match(r"^\d+", words[0]):        # '300i' -> '300' (paints say "300 Series")
            return re.match(r"^\d+", words[0]).group(0)
        return words[0] if words else ""

    def _livery_options(self, v, ship_name):
        """Every paint UEX (and the Star Citizen Wiki) has for this ship: [{id, name, source, buy, wiki}]."""
        vid, name = v.get("id"), (v.get("name") or ship_name or "").lower()
        fam = self._paint_family(v.get("name") or ship_name)
        fam_rx = re.compile(rf"\b{re.escape(fam)}\b") if fam else None
        out, seen = [], set()

        def fits(pname, vname=None, pid_vehicle=None):
            if vid and pid_vehicle and str(pid_vehicle) == str(vid):
                return True
            vname = (vname or "").lower()
            if vname and (vname == name or vname in name or name in vname):
                return True
            return bool(fam_rx and fam_rx.search((pname or "").lower()))
        try:
            cats = [c for c in self._uex.get("categories")[0]
                    if re.search(r"paint|livery|liveries", f"{c.get('section') or ''} {c.get('name') or ''}", re.I)]
            spots = self._item_spots() if cats else {}
            for c in cats:
                for i in self._uex.get("items", {"id_category": int(c["id"])})[0]:
                    nm = i.get("name")
                    if not nm or nm.lower() in seen or not fits(nm, i.get("vehicle_name"), i.get("id_vehicle")):
                        continue
                    seen.add(nm.lower())
                    out.append({"id": str(i["id"]), "name": nm, "source": "uex", "buy": spots.get(i["id"], [])[:3],
                                "wiki": i.get("wiki") or nm, "store": i.get("url_store")})
        except Exception:
            pass
        try:
            for d in self._wikiapi.items_of_type("Paints"):
                nm = d.get("name")
                if not nm or nm.lower() in seen or re.search(r"(?i)\b(test|template|placeholder)\b|_ai_|_npc", f"{d.get('class_name')} {nm}"):
                    continue
                if not fits(nm) and not (fam and fam in (d.get("class_name") or "").lower()):
                    continue
                seen.add(nm.lower())
                out.append({"id": d.get("uuid") or nm, "name": nm, "source": "wiki", "buy": [], "wiki": d.get("web_url") or nm,
                            "image": d.get("image")})
        except Exception:
            pass
        out.sort(key=lambda x: x["name"].lower())
        return out

    def fleet_liveries(self, uid):
        """Paints available for a ship in My Fleet, and the one on the loadout being shown."""
        f = self._ship(uid)
        if not f:
            return {"ok": False, "error": "That ship isn't in your fleet"}
        v = self._vehicle_rows().get(f["vehicle_id"], {})
        lo = self._loadout_of(f)
        items = self._livery_options(v, f.get("name"))
        return {"ok": True, "current": (lo or {}).get("livery"), "items": items,
                "note": None if items else "No paints listed for this ship yet (UEX or the Star Citizen Wiki)"}

    def fleet_set_livery(self, uid, livery=None):
        """Put a paint on the loadout being shown (None: back to the stock paint)."""
        f = self._ship(uid)
        if not f:
            return {"ok": False, "error": "That ship isn't in your fleet"}
        lo = self._loadout_of(f)
        if livery:
            lv = livery if isinstance(livery, dict) else {"name": str(livery)}
            lo["livery"] = {k: lv.get(k) for k in ("id", "name", "source", "wiki", "image") if lv.get(k)}
        else:
            lo.pop("livery", None)
        self._save_settings()
        return {"ok": True, "current": lo.get("livery")}

    # ------------------------------------------------------------ flight blades
    # A ship's flight controller is a flight blade in game; ships that have aftermarket ones (Speed and
    # Handling blades) can swap it. The game files list them by class name next to the stock one:
    # controller_flight_aegs_gladius -> controller_flight_aegs_gladius_blade_spd / _blade_hnd.
    def _blades_for(self, stock):
        """[(uuid, name, class)] of the flight blades that fit the ship whose stock controller is `stock`."""
        cls = ((stock or {}).get("class_name") or "").lower()
        if not cls:
            g = self._game.find((stock or {}).get("uuid"), None, None)
            cls = (g or {}).get("name", "").lower() if g and str(g.get("name", "")).startswith("controller_flight") else ""
        if not cls:
            return []
        base = re.sub(r"_(?:flight_)?blade_(spd|hnd)$", "", cls)
        out = []
        for g in self._game.of_kind("FlightController", None):
            n = (g.get("name") or "").lower()
            if re.fullmatch(re.escape(base) + r"_(?:flight_)?blade_(spd|hnd)", n):
                out.append((g["uuid"], n))
        if not out:                                    # not in the game files yet: the wiki's list
            for d in self._wiki_parts("FlightController", r"_blade_(spd|hnd)$"):
                c = (self._wikiapi_class(d) or "").lower()
                if c and re.fullmatch(re.escape(base) + r"_(?:flight_)?blade_(spd|hnd)", c):
                    out.append((d["uuid"], c))
        return [(u, self._blade_label(c), c) for u, c in out]

    def _wikiapi_class(self, part):
        try:
            return next((d.get("class_name") for d in self._wikiapi.items_of_type("FlightController")
                         if d.get("uuid") == part.get("uuid")), None)
        except Exception:
            return None

    def _blade_label(self, cls):
        ship, kind = self._blade_ship(cls)
        return f"{ship.split(' ', 1)[-1]} {kind} Flight Blade" if ship else cls

    def _blade_option(self, uuid, name, cls):
        rec = self._wikiapi.item(uuid, None) if uuid else None
        scm, mx = fleet.flight_speeds(rec)
        st = {k: v for k, v in (("scm", scm), ("max", mx)) if v}
        return {"id": uuid, "uuid": uuid, "name": name, "maker": ((rec or {}).get("manufacturer") or {}).get("name") or "",
                "size": (rec or {}).get("size") or 1, "grade": (rec or {}).get("grade"), "stats": st, "price": None, "buy": [],
                "extra": fleet.Wiki.stat_rows(rec) if rec else [], "class_name": cls}

    def _flight_options(self, uid):
        f = self._ship(uid) if uid else None
        if not f:
            return {"ok": False, "error": "Pick a ship first"}
        lo = self.fleet_loadout(uid)
        slot = next((x for x in (lo.get("slots") or []) if x.get("type") == "FlightController"), None) if lo.get("ok") else None
        if not slot:
            return {"ok": True, "items": [], "key": "scm"}
        st = slot.get("stock") or {}
        items = [dict(self._blade_option(st.get("uuid"), (st.get("name") or "Flight Blade") + " (stock)", st.get("class_name")),
                      stock=True)]
        from concurrent.futures import ThreadPoolExecutor
        with ThreadPoolExecutor(max_workers=4) as ex:
            items += list(ex.map(lambda b: self._blade_option(*b), self._blades_for(st)))
        return {"ok": True, "items": items, "key": "scm", "source": "game"}

    def _wiki_options(self, slot_type, size, have):
        """Parts of a slot's kind and size that only the Star Citizen Wiki has (Helix mining lasers, new RSI
        parts), with their numbers, for My Fleet's options."""
        kind = next(((t, test) for _, t, test in self.WIKI_KINDS if t == slot_type), None)
        if not kind or slot_type == "FlightController":
            return []
        names = {(x.get("name") or "").lower() for x in have} | {(x.get("uuid") or "").lower() for x in have}
        add = [w for w in self._wiki_parts(*kind) if (not size or str(w.get("size")) == str(size))
               and w["name"].lower() not in names and (w.get("uuid") or "").lower() not in names]
        from concurrent.futures import ThreadPoolExecutor
        with ThreadPoolExecutor(max_workers=8) as ex:
            recs = list(ex.map(lambda w: self._wikiapi.item(w.get("uuid"), w["name"]), add))
        return [{"id": w["id"], "uuid": w.get("uuid"), "name": w["name"], "maker": w["maker"], "size": w["size"],
                 "grade": w["grade"], "stats": fleet.item_stats(rec) if rec else {}, "extra": w.get("extra") or [],
                 "price": w["buy"][0]["price"] if w["buy"] else None, "buy": w["buy"][:6], "wiki_only": True}
                for w, rec in zip(add, recs)]

    def fleet_options(self, slot_type, size, uid=None):
        """Components that fit a slot (same kind and size), with where to buy them. From the game files
        when they cover this kind of slot (every part, exact numbers), else UEX's lists."""
        if slot_type == "FlightController":
            return self._flight_options(uid)
        f = next((x for x in self._fleet() if x["uid"] == uid), None) if uid else None
        ground = bool(self._vehicle_rows().get(f["vehicle_id"], {}).get("is_ground_vehicle")) if f else False
        game = self._game.of_kind(slot_type, size, ground)
        if game:
            def with_wiki():
                r = self._game_options(slot_type, game)
                if r.get("ok") and not ground:
                    r["items"] += self._wiki_options(slot_type, size, r["items"])
                return r
            return self._uex_call(with_wiki)
        def run():
            words = fleet.SLOT_TYPES.get(slot_type, ("", ()))[1]
            cats = [c for c in self._uex.get("categories")[0] if (c.get("type") or "item") == "item"
                    and any(w == (c.get("name") or "").lower().rstrip("s") or w in (c.get("name") or "").lower()
                            for w in words)
                    and not any(k in f"{c.get('section') or ''} {c.get('name') or ''}".lower()
                                for k in self.COMPONENT_SKIP + ("fps", "personal"))]
            spots = self._item_spots()
            out = []
            for c in cats[:3]:
                for i in self._uex.get("items", {"id_category": int(c["id"])})[0]:
                    if size and str(i.get("size") or "") not in (str(size), ""):
                        continue
                    buy = spots.get(i["id"], [])
                    out.append({"id": i["id"], "name": i.get("name"), "maker": i.get("company_name") or "",
                                "size": i.get("size"), "grade": i.get("quality"), "wiki": i.get("wiki"),
                                "uuid": i.get("uuid"), "price": buy[0]["price"] if buy else None, "buy": buy[:6]})
            out.sort(key=lambda x: (x["price"] is None, x["price"] or 0, x["name"] or ""))
            out = out[:40]
            # Each option's numbers from the wiki (cached a week), fetched side by side.
            from concurrent.futures import ThreadPoolExecutor
            with ThreadPoolExecutor(max_workers=8) as ex:
                recs = list(ex.map(lambda i: self._wikiapi.item(i["uuid"], i["name"]), out))
            for i, rec in zip(out, recs):
                i["stats"] = fleet.item_stats(rec) if rec else {}
            out += self._wiki_options(slot_type, size, out)          # ones UEX doesn't list (the Helix lasers)
            return {"ok": True, "items": out, "key": fleet.KEY_STAT.get(slot_type)}
        return self._uex_call(run)

    def _game_options(self, slot_type, game):
        """Game-file components joined with UEX shop prices (by UUID, else name)."""
        prices, by_name = {}, {}
        if self._uex.token or (HERE / "uex_cache" / "items_prices_all.json").exists():
            try:
                spots = self._item_spots()
                words = fleet.SLOT_TYPES.get(slot_type, ("", ()))[1]
                for c in self._uex.get("categories")[0]:
                    nm = (c.get("name") or "").lower()
                    if (c.get("type") or "item") == "item" and any(w in nm for w in words) and \
                            not any(k in f"{c.get('section') or ''} {nm}".lower() for k in self.COMPONENT_SKIP):
                        for i in self._uex.get("items", {"id_category": int(c["id"])})[0]:
                            buy = spots.get(i["id"], [])
                            if i.get("uuid"):
                                prices[i["uuid"]] = buy
                            by_name.setdefault((i.get("name") or "").lower(), buy)
            except uex.UexError:
                pass
        out, seen = [], set()
        for g in game:
            sig = (g.get("name"), g.get("grade"), json.dumps(g.get("stats"), sort_keys=True))
            if sig in seen:                                  # the game files hold some parts twice
                continue
            seen.add(sig)
            buy = prices.get(g["uuid"]) or by_name.get((g.get("name") or "").lower()) or []
            out.append({"id": g["uuid"], "uuid": g["uuid"], "name": g["name"], "maker": g.get("maker") or "",
                        "size": g.get("size"), "grade": g.get("grade"), "class": g.get("class"),
                        "stats": dict(g.get("stats") or {}), "price": buy[0]["price"] if buy else None, "buy": buy[:6]})
        if slot_type == "Cooler":                            # cooling rate: from the wiki
            from concurrent.futures import ThreadPoolExecutor
            with ThreadPoolExecutor(max_workers=8) as ex:
                recs = list(ex.map(lambda i: self._wikiapi.item(i["uuid"], i["name"]), out))
            for i, rec in zip(out, recs):
                i["stats"].update({k: v for k, v in (fleet.item_stats(rec) if rec else {}).items() if k not in i["stats"]})
        out.sort(key=lambda x: (x["price"] is None, x["price"] or 0, x["name"] or ""))
        return {"ok": True, "items": out, "key": fleet.KEY_STAT.get(slot_type), "source": "game"}

    def fleet_set_part_power(self, uid, port, pips):
        f = next((x for x in self._fleet() if x["uid"] == uid), None)
        if not f:
            return {"ok": False, "error": "That ship isn't in your fleet"}
        pw = f.setdefault("power", {})
        parts = pw.setdefault("parts", {}).setdefault(pw.get("mode", "scm"), {})
        if pips is None:
            parts.pop(port, None)
        else:
            parts[port] = max(0, int(pips))
        self._save_settings()
        return {"ok": True}

    def fleet_set_power(self, uid, pips=None, mode=None, cooling=None, auto=False):
        """Power settings for a ship's EM/IR: pips in use (None = all), SCM/NAV, cooling in use %."""
        f = next((x for x in self._fleet() if x["uid"] == uid), None)
        if not f:
            return {"ok": False, "error": "That ship isn't in your fleet"}
        pw = f.setdefault("power", {})
        if auto:                                         
            pw.pop("parts", None)
            pw.pop("pips", None)
            pw.pop("cooling", None)
        if pips is not None:
            pw["pips"] = None if pips == "all" else int(pips)
        if mode in ("scm", "nav"):
            pw["mode"] = mode
        if cooling == "auto":
            pw.pop("cooling", None)
        elif cooling is not None:
            pw["cooling"] = max(0, min(100, int(cooling)))
        self._save_settings()
        return {"ok": True}

    def fleet_set_slot(self, uid, port, item_name, uuid=None, loadout=None):
        """Fit a part to a slot (or back to stock with no item_name), in the loadout shown in My Fleet, or
        another one: loadout="primary" (the Components tab) or a loadout's id."""
        f = next((x for x in self._fleet() if x["uid"] == uid), None)
        if not f:
            return {"ok": False, "error": "That ship isn't in your fleet"}
        lo = (self._loadout_of(f, loadout) or self._loadout_of(f))["loadout"]
        if item_name and str(item_name).endswith(" (stock)"):    # the stock flight blade: no swap
            item_name = None
        if item_name:
            lo[port] = {"name": item_name, "uuid": uuid}
        else:
            lo.pop(port, None)
        self._save_settings()
        return {"ok": True}

    # ------------------------------------------------------------ my trade runs
    TRADE_STAGES = ("planned", "bought", "transit", "sold")

    def _runs(self):
        return self._settings.setdefault("trade_runs", [])

    def trade_runs(self):
        return {"ok": True, "runs": sorted(self._runs(), key=lambda r: -r.get("created", 0))}

    def trade_run_save(self, run):
        """Create or update one of your trade runs (from a found route or entered yourself)."""
        run = dict(run or {})
        if not (run.get("commodity") or "").strip():
            return {"ok": False, "error": "Enter the commodity"}
        for k in ("units", "buy_price", "sell_price", "plan_buy", "plan_sell", "handling", "load_fee", "unload_fee"):
            v = run.get(k)
            run[k] = float(v) if v not in (None, "") else None
        runs = self._runs()
        old = next((r for r in runs if r["id"] == run.get("id")), None)
        if old:
            old.update({k: v for k, v in run.items() if k not in ("id", "created", "times", "tracking_no")})
        else:
            used = {r.get("tracking_no") for r in runs}
            while True:
                tn = "1SC" + "".join(secrets.choice("0123456789") for _ in range(15))
                if tn not in used:
                    break
            run.update({"id": f"t{int(time.time() * 1000)}", "created": time.time(), "stage": "planned",
                        "times": {"planned": time.time()}, "tracking_no": tn})
            runs.append(run)
        self._save_settings()
        return {"ok": True, "id": (old or run)["id"]}

    def trade_run_stage(self, rid, stage, price=None, fee=None):
        """Move a run along: planned > bought > in transit > sold. Buying or selling can record the
        price you actually got (per SCU) and what auto loading / unloading cost."""
        r = next((x for x in self._runs() if x["id"] == rid), None)
        if not r or stage not in self.TRADE_STAGES:
            return {"ok": False, "error": "Run not found"}
        r["stage"] = stage
        r.setdefault("times", {})[stage] = time.time()
        for later in self.TRADE_STAGES[self.TRADE_STAGES.index(stage) + 1:]:
            r["times"].pop(later, None)             # stepping back clears what came after
        if price not in (None, ""):
            r["buy_price" if stage == "bought" else "sell_price"] = float(price)
        if fee not in (None, "") and stage in ("bought", "sold"):
            r["load_fee" if stage == "bought" else "unload_fee"] = float(fee)
        self._save_settings()
        return {"ok": True}

    def trade_run_delete(self, rid):
        self._settings["trade_runs"] = [x for x in self._runs() if x["id"] != rid]
        self._save_settings()
        return {"ok": True}

    def uex_origins(self):
        """Starting points for trade routes: every planet (or orbit, where UEX has no planet) that has
        a commodity terminal, with its terminals (to start from one place, like Baijini Point), plus the
        one nearest you."""
        def run():
            terms = self._uex.terminals()
            places = self._uex.place_map(self._db.locations)
            opts, near, at = {}, None, {}
            for tid, t in terms.items():
                if t.get("type") != "commodity":
                    continue
                key = ("planet", t["id_planet"], t.get("planet_name")) if t.get("id_planet") else \
                      ("orbit", t["id_orbit"], t.get("orbit_name"))
                if key[1] and key[2]:
                    opts[key] = t.get("star_system_name")
                    at.setdefault(key, []).append({"id": tid, "name": t.get("name") or places.get(tid) or str(tid),
                                                   "place": places.get(tid)})
                d = self._dist_from_you(places.get(tid))
                if d is not None and (near is None or d < near[0]):
                    near = (d, key)
            items = [{"kind": k[0], "id": k[1], "name": k[2], "system": sysn,
                      "terminals": sorted(at.get(k, []), key=lambda x: x["name"].lower())} for k, sysn in opts.items()]
            items.sort(key=lambda o: (SYSTEM_ORDER.get(o["system"], 9), o["name"]))
            here = {"kind": near[1][0], "id": near[1][1], "name": near[1][2]} if near else None
            return {"ok": True, "items": items, "here": here}
        return self._uex_call(run)

    ROUTES_PER_COMMODITY = 4      # wide searches: at most this many runs of one commodity in the list

    def _price_routes(self, system=None, stay="", avoid=None, one_system=False, per_origin=6):
        """UEX-style route rows worked out from every terminal's prices (one cached request), for searches
        wider than one planet: the whole game, or one whole system. UEX's own routes endpoint only takes a
        single starting planet, orbit or terminal. system: only runs that start there (None: anywhere)."""
        terms = self._uex.terminals()
        rows, at = self._uex.get("commodities_prices_all")
        rows = self._community.overlay(rows)
        names = {c["id"]: c["name"] for c in self._uex.get("commodities")[0]}
        buys, sells = {}, {}
        for r in rows:
            t = terms.get(r.get("id_terminal"))
            if not t or not uex.is_live(t):
                continue
            if (r.get("price_buy") or 0) > 0 and (not system or t.get("star_system_name") == system):
                buys.setdefault(r["id_commodity"], []).append((r, t))
            if (r.get("price_sell") or 0) > 0:
                sells.setdefault(r["id_commodity"], []).append((r, t))
        avoid = set(avoid or ())

        def allowed(so, sd):
            return not ((stay and (so != stay or sd != stay)) or so in avoid or sd in avoid or (one_system and so != sd))
        out = []
        for cid, B in buys.items():
            S_ = sorted(sells.get(cid) or (), key=lambda x: -x[0]["price_sell"])
            if not S_:
                continue
            for rb, tb in B:
                pb, n = rb["price_buy"], 0
                for rs, ts in S_:
                    ps = rs["price_sell"]
                    if ps <= pb or n >= per_origin:
                        break
                    if tb is ts or not allowed(tb.get("star_system_name"), ts.get("star_system_name")):
                        continue
                    n += 1
                    out.append({
                        "commodity_name": names.get(cid) or rb.get("commodity_name") or str(cid), "id_commodity": cid,
                        "code": None, "price_origin": pb, "price_destination": ps,
                        "price_margin": ps - pb, "price_roi": (ps - pb) / pb * 100,
                        "id_terminal_origin": tb["id"], "id_terminal_destination": ts["id"],
                        "origin_terminal_name": tb.get("name"), "destination_terminal_name": ts.get("name"),
                        "origin_star_system_name": tb.get("star_system_name"),
                        "destination_star_system_name": ts.get("star_system_name"),
                        "origin_orbit_name": tb.get("orbit_name") or tb.get("planet_name"),
                        "destination_orbit_name": ts.get("orbit_name") or ts.get("planet_name"),
                        "scu_origin": rb.get("scu_buy"), "scu_destination": None,
                        "status_origin": rb.get("status_buy"), "status_destination": rs.get("status_sell"),
                        "container_sizes_origin": rb.get("container_sizes") or tb.get("container_sizes"),
                        "container_sizes_destination": rs.get("container_sizes") or ts.get("container_sizes"),
                        "date_added": max(rb.get("date_modified") or 0, rs.get("date_modified") or 0) or None,
                        "faction_origin": tb.get("faction_name"), "faction_destination": ts.get("faction_name"),
                        **{f"{flag}_{side}": t.get(flag) for side, t in (("origin", tb), ("destination", ts))
                           for flag in ("has_freight_elevator", "has_loading_dock", "has_refuel", "has_docking_port",
                                        "is_space_station", "is_on_ground", "is_monitored")}})
        return out, at

    def uex_routes(self, kind, origin_id, scu=0, budget=0, stay="", avoid=None, one_system=False):
        """Best runs from a planet/orbit/terminal for your cargo space and budget, most profit first.
        kind "all" searches every system at once, kind "system" one whole system (origin_id is its name)."""
        def run():
            wide = kind in ("all", "system")
            if wide:
                rows, at = self._price_routes(str(origin_id) if kind == "system" else None, stay, avoid, one_system)
            else:
                key = {"planet": "id_planet_origin", "orbit": "id_orbit_origin", "terminal": "id_terminal_origin"}[kind]
                rows, at = self._uex.get("commodities_routes", {key: int(origin_id)})
            places = self._uex.place_map(self._db.locations)
            out = []
            for r in rows:
                so, sd = r.get("origin_star_system_name"), r.get("destination_star_system_name")
                if so not in uex.SYSTEMS or sd not in uex.SYSTEMS:
                    continue
                if (stay and (so != stay or sd != stay)) or (avoid and (so in avoid or sd in avoid)) or \
                        (one_system and so != sd):
                    continue
                pb, ps = r.get("price_origin") or 0, r.get("price_destination") or 0
                if pb <= 0 or ps <= pb:
                    continue
                cap = [x for x in (scu, r.get("scu_origin"), r.get("scu_destination")) if x and x > 0]
                if budget and budget > 0:
                    cap.append(int(budget // pb))
                units = int(min(cap)) if cap else 0
                if units <= 0:
                    continue
                po, pd = places.get(r["id_terminal_origin"]), places.get(r["id_terminal_destination"])
                L1, L2 = self._db.locations.get(po), self._db.locations.get(pd)
                qd = dist(self._db.global_pos(L1, time.time()), self._db.global_pos(L2, time.time())) \
                    if L1 and L2 and L1.pos and L2.pos and L1.system == L2.system else None
                out.append({
                    "commodity": r["commodity_name"], "code": r.get("code"), "units": units,
                    "buy": pb, "sell": ps, "profit": units * (ps - pb), "cost": units * pb,
                    "margin": r.get("price_margin"), "roi": r.get("price_roi"), "score": r.get("score"),
                    "from": r.get("origin_terminal_name"), "to": r.get("destination_terminal_name"),
                    "from_place": po, "to_place": pd,
                    "from_where": ", ".join(x for x in (r.get("origin_orbit_name"), r.get("origin_star_system_name")) if x),
                    "to_where": ", ".join(x for x in (r.get("destination_orbit_name"), r.get("destination_star_system_name")) if x),
                    "cross_system": r.get("origin_star_system_name") != r.get("destination_star_system_name"),
                    "dist": qd if qd is not None else (r.get("distance") or 0) * 1e9,
                    "stock_from": r.get("status_origin"), "stock_to": r.get("status_destination"),
                    "boxes_from": r.get("container_sizes_origin"), "boxes_to": r.get("container_sizes_destination"),
                    "elevator_to": bool(r.get("has_freight_elevator_destination") or r.get("has_loading_dock_destination")),
                    "url": f"https://uexcorp.space/trade/route?code={r['code']}" if r.get("code") else None,
                    "id_commodity": r.get("id_commodity"), "updated": r.get("date_added"),
                    "scu_from": r.get("scu_origin"), "scu_to": r.get("scu_destination"),
                    "reports_from": r.get("price_origin_users_rows"), "reports_to": r.get("price_destination_users_rows"),
                    "from_station": bool(r.get("is_space_station_origin")), "to_station": bool(r.get("is_space_station_destination")),
                    "from_ground": bool(r.get("is_on_ground_origin")), "to_ground": bool(r.get("is_on_ground_destination")),
                    "from_monitored": r.get("is_monitored_origin"), "to_monitored": r.get("is_monitored_destination"),
                    "refuel_to": bool(r.get("has_refuel_destination")), "dock_from": bool(r.get("has_docking_port_origin")),
                    "refuel_from": bool(r.get("has_refuel_origin")), "dock_to": bool(r.get("has_docking_port_destination")),
                    "elevator_from": bool(r.get("has_freight_elevator_origin") or r.get("has_loading_dock_origin")),
                    "faction_from": r.get("origin_faction_name") or r.get("faction_origin"),
                    "faction_to": r.get("destination_faction_name") or r.get("faction_destination")})
            out.sort(key=lambda x: -x["profit"])
            if wide:                       # one commodity shouldn't fill the whole list
                seen, kept = {}, []
                for x in out:
                    n = seen.get(x["commodity"], 0)
                    if n < self.ROUTES_PER_COMMODITY:
                        seen[x["commodity"]] = n + 1
                        kept.append(x)
                total, out = len(out), kept
            else:
                total = len(out)
            return {"ok": True, "routes": out[:60], "at": at, "total": total, "wide": wide}
        return self._uex_call(run)

    def journey(self, a, b):
        """The places a run from a to b goes through: a, then for each jump the gateway you fly to and the
        one you come out at, then b. Just [a, b] in one system or when no way through is known."""
        La, Lb = self._db.locations.get(a), self._db.locations.get(b)
        if not La or not Lb or La.system == Lb.system:
            return {"ok": True, "places": [a, b]}
        path, cur = [a], La.system
        for g in gateways.gate_path(self._db, cur, Lb.system) or []:
            path.append(g)
            came = gateways.arrival(self._db, g, cur)
            if came:
                path.append(came)
            cur = gateways.leads_to(g)
        path.append(b)
        return {"ok": True, "places": path}

    def open_url(self, url):
        if isinstance(url, str) and url.startswith("https://"):
            webbrowser.open(url)
        return {"ok": True}

    # ------------------------------------------------------------ calibration sharing
    def _cal_file(self):
        try:
            return json.loads(CAL_PATH.read_text(encoding="utf-8"))
        except Exception:
            return {"format": "stanton-nav-calibration", "version": 1, "history": []}

    def _cal_payload(self, data=None):
        """Current alignments plus the evidence behind them."""
        data = data or self._cal_file()
        data.update(format="stanton-nav-calibration", version=1, updated=time.strftime("%Y-%m-%d %H:%M:%S"),
                    bodies={b.name: {"system": b.system, "rotation_offset_deg": round(b.rotation_offset_deg, 6),
                                     "rotation_period_h": b.rotation_period_h, "epoch_utc": b.epoch_utc,
                                     "calibrated_at": b.calibrated_at, "place": b.calibrated_place,
                                     "quality": b.calibration_quality}
                            for b in self._db.bodies.values() if b.calibrated and can_align(b)
                            and b.calibration_quality != "community"})       # datarunners' agreed ones aren't yours
        return data

    def _record_cal(self, kind, body, place, residual):
        """Log each calibration or check. 'residual' is how far off the map was, in degrees; if checks on a
        calibrated planet stay near 0 across sessions and days, the alignment is stable and can be shared."""
        data = self._cal_file()
        data.setdefault("history", []).append({
            "kind": kind, "body": body, "place": place, "residual_deg": round(residual, 4),
            "reading_utc": round(self._player_t or time.time(), 1), "build": self._tracker.build,
            "session": (self._tracker.log_sig or "")[:10]})
        data["history"] = data["history"][-500:]
        try:
            CAL_PATH.write_text(json.dumps(self._cal_payload(data), indent=1), encoding="utf-8")
        except OSError:
            pass
        if kind.startswith("auto-") or kind == "manual":         # a new alignment (not a check or a reset)
            if self._tracker.build:          # aligned by you in this game build: datarunners' agreed one doesn't replace it
                self._settings.setdefault("cal_build", {})[body] = str(self._tracker.build)
                self._save_settings()
            self._share_alignment(body, place, kind)

    def _share_alignment(self, body_name, place, kind):
        """Send a new alignment to the Quantum server for this game build. Once another datarunner's
        alignment of the same body in the same build agrees, it earns points toward your rank (the first
        alignments after a game update are the useful ones)."""
        b = self._db.bodies.get(body_name)
        user = self._dr_cfg().get("username") or (self._dr_cfg().get("uex_user") or {}).get("username")
        if not b or not user or not self._tracker.build:
            return
        self._community.post_alignment({
            "username": user.lower(), "body": b.name, "system": b.system, "build": str(self._tracker.build),
            "offset": round(b.rotation_offset_deg, 6), "period": b.rotation_period_h, "epoch": b.epoch_utc,
            "place": place, "quality": b.calibration_quality or kind})

    def calibration_status(self):
        """Per body: aligned or community values, and what the checks say about drift."""
        with self._lock:
            hist = self._cal_file().get("history", [])
            out = []
            for b in sorted(self._db.bodies.values(), key=lambda b: (b.system, b.kind != "planet", b.name)):
                if not can_align(b):              # stars, asteroids, planets you can't land on
                    continue
                h = [e for e in hist if e["body"] == b.name]
                checks = [e for e in h if e["kind"] == "check"]
                out.append({"name": b.name, "system": b.system, "kind": b.kind, "calibrated": b.calibrated,
                            "resettable": b.community_offset_deg is not None, "quality": b.calibration_quality,
                            "at": b.calibrated_at, "place": b.calibrated_place, "events": len(h),
                            "checks": len(checks), "sessions": len({e["session"] for e in h if e["session"]}),
                            "worst_check": max((abs(e["residual_deg"]) for e in checks), default=None),
                            "last": h[-1] if h else None})
            return {"bodies": out, "build": self._tracker.build, "file": str(CAL_PATH)}

    def reset_calibration(self, name):
        """Go back to the community value for one body."""
        with self._lock:
            b = self._db.bodies.get(name)
            if not b:
                return {"ok": False, "error": "Unknown body"}
            if b.community_offset_deg is None:
                return {"ok": False, "error": "Run python import_data.py once (it keeps your calibrations), then reset"}
            b.rotation_offset_deg, b.calibrated, b.calibrated_at, b.calibrated_place = b.community_offset_deg, False, 0.0, ""
            b.calibration_quality = ""
            self._db.save()
            self._record_cal("reset", name, "", 0.0)
            self._static_version += 1
            return {"ok": True}

    def export_calibrations(self):
        with self._lock:
            if not any(b.calibrated for b in self._db.bodies.values()):
                return {"ok": False, "error": "Nothing calibrated yet"}
            res = webview.windows[0].create_file_dialog(webview.SAVE_DIALOG, save_filename="quantum-calibrations.json")
            if not res:
                return {"ok": False, "error": "cancelled"}
            path = res if isinstance(res, str) else res[0]
            Path(path).write_text(json.dumps(self._cal_payload(), indent=1), encoding="utf-8")
            return {"ok": True, "path": path, "count": sum(1 for b in self._db.bodies.values() if b.calibrated)}

    def import_calibrations(self, path=None):
        """Apply someone's shared calibrations. Newer ones win over yours for the same planet."""
        with self._lock:
            if not path:
                res = webview.windows[0].create_file_dialog(webview.OPEN_DIALOG,
                                                            file_types=("Calibrations (*.json)", "All files (*.*)"))
                if not res:
                    return {"ok": False, "error": "cancelled"}
                path = res[0]
            try:
                data = json.loads(Path(path).read_text(encoding="utf-8"))
                assert data.get("format") == "stanton-nav-calibration"
            except Exception:
                return {"ok": False, "error": "That isn't a Quantum calibration file"}
            applied, skipped = apply_calibrations(self._db, data)
            mine = self._cal_file()     # keep their evidence alongside ours
            seen = {(e["body"], e["reading_utc"]) for e in mine.get("history", [])}
            mine.setdefault("history", []).extend(e for e in data.get("history", []) if (e["body"], e["reading_utc"]) not in seen)
            CAL_PATH.write_text(json.dumps(self._cal_payload(mine), indent=1), encoding="utf-8")
            if applied:
                self._db.save()
                self._static_version += 1
            return {"ok": True, "applied": applied, "skipped": skipped}

    # ------------------------------------------------------------ contracts
    def _objective_place(self, c, o):
        """A route-able place for an objective: its matched place, or a stop at its exact marker."""
        if o.location and o.location in self._db.locations:
            return o.location
        if not o.marker:
            return None
        for loc in self._db.locations.values():   # reuse an existing mission stop
            if loc.source == "mission" and loc.body == o.marker["body"] and dist(loc.pos, o.marker["pos"]) < 50:
                return loc.name
        cargo = contract_cargo(c.code)
        label = {"pickup": "Pickup", "dropoff": "Drop-off"}.get(o.kind, "Objective")
        where = (f"near {o.marker['near_place']}, {o.marker['body']}" if o.marker.get("near_place") and o.marker.get("body")
                 else o.marker.get("body") or o.marker.get("lpoint") or (f"near {o.marker['near']}" if o.marker.get("near") else "space"))
        name = self._db.unique_name(f"{label}{' ' + cargo if cargo else ''} ({where})")
        self._db.locations[name] = Location(name, "surface" if o.marker.get("body") else "space",
                                            tuple(o.marker["pos"]), o.marker.get("body"),
                                            notes=f"Contract: {c.name}", source="mission",
                                            system=o.marker["system"], created=time.time())
        self._db.save()
        self._static_version += 1
        return name

    def add_contract_stops(self, cid, oid=None):
        with self._lock:
            c = self._tracker.get(cid)
            if not c:
                return {"ok": False, "error": "Contract not found"}
            self._assign_turn_ins(self._player, self._player_sys, time.time())
            added = self._add_contract_tasks(c, oid)
            self._save_settings()
            if not added and not any(t["task"].startswith(cid + "|") for t in self._route):
                return {"ok": False, "error": "The log didn't give a map position for this"}
            return {"ok": True, "added": added}

    def guide_objective(self, cid, oid):
        with self._lock:
            c = self._tracker.get(cid)
            o = next((o for o in c.objectives if o.id == oid), None) if c else None
            n = self._objective_place(c, o) if o else None
            if not n:
                return {"ok": False, "error": "The log didn't give a map position for this"}
            self._guide = n
            self._save_settings()
            # Guiding to the drop-off with the cargo on board: you're on your way.
            if o.kind == "dropoff" and self._tracker._collected(c):
                self._tracker.mark_departed(cid, time.time(), "route")
            return {"ok": True, "name": n}

    def contract_out_for_delivery(self, cid, on=True):
        """The "Out for delivery" button on a contract's tracker (and its undo)."""
        with self._lock:
            ok = self._tracker.mark_departed(cid, time.time(), "manual") if on else self._tracker.unmark_departed(cid)
            return {"ok": ok} if ok else {"ok": False, "error": "Nothing to change for that contract"}

    def set_objective_place(self, cid, oid, place):
        with self._lock:
            if place not in self._db.locations:
                return {"ok": False, "error": "Pick a place from the list"}
            c = self._tracker.get(cid)
            o = next((o for o in c.objectives if o.id == oid), None) if c else None
            if o and need_item(o.text):             # an item to collect: that's where you get it
                return self.set_item_source(cid, oid, place)
            ok = self._tracker.set_objective_place(cid, oid, place)
            return {"ok": ok} if ok else {"ok": False, "error": "Contract not found"}

    def objective_place_here(self, cid, oid):
        """Use the nearest known place to your last /showlocation."""
        with self._lock:
            if not self._player:
                return {"ok": False, "error": "Type /showlocation in game chat while you're there"}
            t = self._player_t
            best, bd = None, 5000.0
            for l in self._db.locations.values():
                if l.source == "db" and l.system == self._player_sys:
                    d = dist(self._db.global_pos(l, t), self._player)
                    if d < bd:
                        best, bd = l.name, d
            if not best:
                return {"ok": False, "error": "No known place within 5 km of you. Save a waypoint instead"}
            self._tracker.set_objective_place(cid, oid, best)
            return {"ok": True, "name": best}

    def mark_collected(self, cid, oid=None):
        """Mark a pickup collected when the game didn't log it, then type /showlocation in game (after
        giving it focus) so Quantum knows where you are and can tell when you leave with the cargo."""
        with self._lock:
            if not self._tracker.mark_collected(cid, oid):
                return {"ok": False, "error": "That pickup isn't open any more"}
            self._prune_finished_tasks()
            self._save_settings()
        if not overlay.AVAILABLE:
            return {"ok": True, "sending": False, "note": "Type /showlocation in game for your position."}

        def send():
            time.sleep(0.3)                       # let the click finish before the focus change
            if overlay.focus_game():
                time.sleep(0.5)                   # the game needs a moment before it takes keystrokes
                self._sender.send("collected")
        threading.Thread(target=send, daemon=True).start()
        return {"ok": True, "sending": True}

    def dismiss_contract(self, cid):
        self._tracker.dismiss(cid)

    def clear_finished_contracts(self):
        self._tracker.clear_finished()

    def set_log_path(self, path):
        path = (path or "").strip().strip('"')
        if not Path(path).is_file():
            return {"ok": False, "error": "File not found"}
        self._settings["log_path"] = path
        self._save_settings()
        self._tracker.set_log_path(path)
        return {"ok": True}

    def browse_log(self):
        res = webview.windows[0].create_file_dialog(webview.OPEN_DIALOG,
                                                    file_types=("Game log (*.log)", "All files (*.*)"))
        return self.set_log_path(res[0]) if res else {"ok": False, "error": "cancelled"}


def _place_key(name):
    """Name key for hidden places: case, spaces and punctuation don't matter, but a "(Pyro)" or "(Nyx)"
    suffix does (Nyx Gateway (Pyro) and Nyx Gateway (Stanton) are different stations)."""
    return re.sub(r"[^a-z0-9]", "", (name or "").lower())


def rename_raw_pois(db):
    """Older location data named some caves and derelict outposts by their game entity name
    ("RastarLocationEntity-012 (Bloom)"). Give them readable names and drop developer test entities,
    so saved routes keep working. Returns {old name: new name}."""
    out = {}
    for name in list(db.locations):
        loc = db.locations[name]
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


def main():
    sys.argv = _demo_args(sys.argv)
    if DEMO["auto"]:
        print(f"Demo tour: starts {2.5 + DEMO['delay']:g} s after Quantum loads, at speed {DEMO['speed']:g}. "
              "Space pauses, Esc stops.")
    if "--import" in sys.argv:          
        if FROZEN and os.name == "nt":  
            import ctypes
            ctypes.windll.kernel32.AllocConsole()
            sys.stdout = sys.stderr = open("CONOUT$", "w", buffering=1)
        import import_data
        sys.argv = [a for a in sys.argv if a != "--import"]
        import_data.main()
        if FROZEN:
            input("\nPress Enter to close.")
        return
    single = tray.SingleInstance()
    if not single.first:                 # Quantum's already running: bring it forward instead
        single.notify()
        print("Quantum is already running: it's been brought to the front.")
        return
    overlay.set_app_id()                 # own taskbar icon instead of Python's
    api = Api()
    if not api._db.bodies:
        print("Tip: run `python import_data.py` (or Quantum.exe --import) once to load Stanton, Pyro and Nyx.")
    print("Quantum by microTech - the verse, in your reach.")
    window = webview.create_window("Quantum", str(RES / "ui" / "index.html"), js_api=api,
                                   width=1600, height=960, min_size=(1150, 720),
                                   background_color="#05080f")
    window.events.closed += api.shutdown
    icon = RES / "assets" / "quantum.ico"
    tray_icon = tray.Tray(window, icon, on_show=lambda: (api._nudge_redraw(), overlay.bring_to_front()))
    window.events.closed += tray_icon.stop
    single.on_show_request(tray_icon.show)                  # another launch: come to the front

    def started():
        overlay.set_window_icon(icon)
        tray_icon.start()
    webview.start(func=started)


if __name__ == "__main__":
    main()
