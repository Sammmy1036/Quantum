"""Quantum - 3D route planner, waypoint finder and contract map for Star Citizen.

Python backend + HTML/WebGL UI in a native window (pywebview / Edge WebView2).
Read-only data sources; nothing touches the game process:
  - /showlocation clipboard text  -> your position
  - Game.log                      -> contracts, exact objective markers, current system/planet
  - locations.json                -> map database (run import_data.py once)
"""
import json
import secrets
import urllib.parse
import urllib.request
import os
import math
import sys
import threading
import time
from pathlib import Path

import webbrowser

import webview

import fleet
import gateways
import services
import uex
import wiki

from gamelog import ContractTracker, contract_cargo, is_collection, is_tracked, need_item
from nav_core import Location, NavDB, SYSTEMS, classify, dist
import overlay
from keysender import ShowLocationSender
from watcher import ClipboardWatcher

FROZEN = getattr(sys, "frozen", False)
# Your data (locations, settings, calibrations, logs learned) lives next to Quantum.exe when packaged,
# next to app.py otherwise. The bundled files (ui/, assets/, shipped calibrations) live in RES.
HERE = Path(sys.executable).parent if FROZEN else Path(__file__).resolve().parent
RES = Path(getattr(sys, "_MEIPASS", HERE))
DB_PATH = HERE / "locations.json"
MISSIONS_PATH = HERE / "missions.json"
SETTINGS_PATH = HERE / "settings.json"
SERVICES_PATH = HERE / "services.json"    # location services from the Star Citizen Wiki API
WIKI_PATH = HERE / "wiki_systems.json"   # Star Citizen Wiki system info (CC BY-SA 4.0), from import_data.py
CAL_PATH = HERE / "calibrations.json"
PLACES_PATH = HERE / "places.json"
SYSTEM_ORDER = {"Stanton": 0, "Pyro": 1, "Nyx": 2}
VEHICLE_ROLES = [("is_cargo", "Cargo"), ("is_mining", "Mining"), ("is_salvage", "Salvage"), ("is_military", "Combat"),
                 ("is_bomber", "Bomber"), ("is_exploration", "Exploration"), ("is_medical", "Medical"),
                 ("is_refuel", "Refuel"), ("is_repair", "Repair"), ("is_passenger", "Passenger"),
                 ("is_racing", "Racing"), ("is_starter", "Starter"), ("is_ground_vehicle", "Ground"),
                 ("is_industrial", "Industrial"), ("is_science", "Science"), ("is_stealth", "Stealth"),
                 ("is_carrier", "Carrier"), ("is_interdiction", "Interdiction"), ("is_emp", "EMP"),
                 ("is_construction", "Construction"), ("is_datarunner", "Data running"), ("is_qed", "Quantum snare")]      # gateway positions you measured with /showlocation; shareable
# Where a hangar reading in each city is anchored: its spaceport (or the city if the data has no spaceport).
CITY_ANCHOR = {"New Babbage": "New Babbage Interstellar Spaceport", "Area 18": "Riker Memorial Spaceport",
               "Orison": "August Dunlow Spaceport", "Lorville": "Lorville", "Levski": "Levski"}
QUALITY = {"": 0, "estimate": 0, "hangar": 1, "station": 2, "place": 3}
BUILTIN_CAL_PATH = RES / "builtin_calibrations.json"   # shared alignments shipped with Quantum  

class Api:
    """Public methods are callable from JS as window.pywebview.api.<name>(...)."""

    def __init__(self):
        self._lock = threading.RLock()
        self._db = NavDB.load(DB_PATH)
        self._db.path = DB_PATH
        self._renamed = rename_gateways(self._db)
        ren, self._unplaced = gateways.apply(self._db, gateways.load_learned(PLACES_PATH))
        self._renamed.update(ren)
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
        # Stations Quantum's data lacks, from UEX's station list (cached; nothing is fetched here).
        self._uex = uex.Uex(HERE / "uex_cache", self._settings.get("uex_token", ""))
        self._uex_amen = {}
        self._wikiapi = fleet.Wiki(HERE / "uex_cache")
        # Component numbers from the game files (build_component_stats.py), preferred over the wiki.
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
        if self._settings.get("clear_log_on_start"):
            self._log_cleared = clear_game_log(self._settings.get("log_path"))
        self._tracker = ContractTracker(MISSIONS_PATH, self._db, self._settings.get("log_path"))
        self._tracker.start()
        self._watcher = ClipboardWatcher(self._on_position)
        self._watcher.start()
        # Types /showlocation for you: F9 by default, optional timer (off by default). Windows only.
        self._sender = ShowLocationSender()
        self._sender.on_overlay = lambda: overlay.toggle(restore_cb=self._restore_window,
                                                         after_show_cb=self._nudge_redraw)
        a = {"hotkey": "F9", "loc_hotkey": "", "interval": 0, "open_chat": "enter", "on_arrival": False,
             **self._settings.get("autoloc", {})}
        if a.get("action") == "showlocation" and not a.get("loc_hotkey"):
            a["loc_hotkey"], a["hotkey"] = a["hotkey"], "F9" if a["hotkey"] != "F9" else ""
        self._sender.configure(a["hotkey"], 0, a["open_chat"], None, True, a.get("loc_hotkey", ""), False)

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
            return                 
        with self._lock:
            hint = self._tracker.where.get("system")
            self._player, self._player_t = pos, t
            self._player_sys = self._db.guess_system(pos, hint)
            self._learn_jump_from_reading()
            self._try_autocal()

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
        if all(tk["task"] == "visit" for tk in stops[0]["tasks"]):
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
        if not body:
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
            if not body or self._db.body_near(self._player, self._player_sys) is not body:
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
        if not body or body.rotation_period_h <= 0:
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
        out = services.match(self._service_records, {**self._unplaced, **self._db.locations})
        for name, amen in self._uex_amen.items():      # stations the wiki data has nothing for
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
            return {}
        locs = self._db.locations
        keys = {(services._key(n), l.system): n for n, l in locs.items()
                if l.source == "db" and l.category not in ("lpoint", "om")}
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
            return
        try:
            outposts = {o["name"]: o for o in self._uex.get("outposts", offline=offline)[0]}
        except uex.UexError:
            outposts = {}
        st_by_name = {s_.get("name"): s_ for s_ in stations}
        learned = gateways.load_learned(PLACES_PATH)
        bodies = {n for n in self._db.bodies}
        self._uex_pending = getattr(self, "_uex_pending", {})
        for tid, t in terms.items():
            if places.get(tid):
                continue
            station = t.get("space_station_name")
            name = (station or t.get("outpost_name") or t.get("city_name") or t.get("displayname")
                    or t.get("name") or "").strip()
            sysn = t.get("star_system_name")
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
                    loc = Location(name, "surface", tuple(l["local"]), l["body"], source="db", system=sysn,
                                   qt=True, category="station" if station else "outpost",
                                   notes=f"From UEX{where}. Position from your /showlocation")
                else:
                    loc = Location(name, "space", tuple(l["pos"]), None, source="db", system=sysn, qt=True,
                                   category="station", notes="From UEX. Position from your /showlocation")
                self._db.locations[name] = loc
                self._unplaced.pop(name, None)
            else:
                self._unplaced[name] = Location(name, "surface" if surface else "space", None, body if surface else None,
                                                source="db", system=sysn, qt=True,
                                                category="station" if station else "outpost",
                                                notes=f"From UEX{where}. Position not known yet")
            self._uex_pending[name] = sysn

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
    def get_static(self):
        with self._lock:
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
                              "parent": parent.name if parent and b.kind != "star" else None})
            locs = [{"name": l.name, "kind": l.kind, "pos": l.pos, "body": l.body, "pad": l.pad,
                     "notes": l.notes, "source": l.source, "system": l.system, "qt": l.qt,
                     "pinned": l.pinned, "created": l.created, "type": classify(l.name, l.category),
                     "to": gateways.leads_to(l.name), "unplaced": l.pos is None,
                     "placeable": gateways.system_of(l.name) is not None or l.name in getattr(self, "_uex_pending", {}),
                     "near": gateways.near_body(l.name),
                     **({"amen": self._services[l.name]["amenities"],
                         "pad_auto": services.pad_from(self._services[l.name]["amenities"])}
                        if l.name in self._services else {})}
                    for l in [*self._db.locations.values(), *self._unplaced.values()]]
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
            return None, 0, None                      # mid-jump: you're not at the old place any more
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
            p, psys = self._player, self._player_sys
            ptime, approx = self._player_t, None
            cur = self._tracker.cur or {}
            # The log knows where you are and that's newer than your last /showlocation show you at
            # that place (approximate) until a real reading comes in. Keeps the route line drawn.
            spot, spot_at, how = self._log_spot(cur) if game_on else (None, 0, None)
            if spot and (not p or spot_at > self._player_t):
                L = self._db.locations[spot]
                p, psys, ptime, approx = self._db.global_pos(L, t), L.system, t, L.name
            if game_on:
                self._auto_arrive(cur)
            self._prune_finished_tasks()
            stops = self._stops()
            names = [st["place"] for st in stops]
            live = {"now": t, "static_version": self._static_version, "route": names,
                    "player": None, "next": None, "legs": [], "total": 0.0, "guide": None,
                    "contracts": [], "contracts_version": self._tracker.version,
                    "log": {"path": self._tracker.log_path, "status": self._tracker.status,
                            "clear_on_start": bool(self._settings.get("clear_log_on_start")),
                            "uex_token": bool(self._uex.token),
                            "game_running": self._tracker.game_running, "note": self._tracker.log_note,
                            "cleared": self._log_cleared},
                    "where": self._tracker.where,
                    "travel": self._travel_view(cur, t) if game_on else None,
                    "arrived": self._arrived_note if game_on else None, "game_off": not game_on}
            if p:
                body = self._db.body_near(p, psys)
                info = {"pos": p, "t": ptime, "age": t - (spot_at if approx else ptime), "system": psys, "body": None,
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
                pad = loc.pad if loc.pad != "unknown" else (
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

    def _prune_finished_tasks(self):
        """Drop contract tasks whose objective is done, failed or gone, and move tasks whose objective
        now resolves to a different place (e.g. after a marker was put on the right planet)."""
        keep, changed = [], False
        for t in self._route:
            if t["task"] != "visit":
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
        """Remove auto-created contract stops nothing points at any more."""
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
            # Left the pickup with the cargo? Then it's out for delivery.
            # (real /showlocation readings only: a position from the log is just the place's own spot)
            if tr["stage"] == 1 and self._player and tr["times"][1] and (self._player_t or 0) > tr["times"][1]:
                for o in c["objectives"]:
                    if o["kind"] == "pickup":
                        g, sysname, _ = self._objective_global(o, tc)
                        if g and (sysname != self._player_sys or dist(g, self._player) > 3000):
                            self._tracker.mark_departed(c["id"], self._player_t)
                            tr["stage"], tr["times"][2] = 2, self._player_t
                        break
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
            self._save_settings()

    def set_route(self, names):
        with self._lock:
            self._route = [{"place": n, "task": "visit"} for n in names if n in self._db.locations]
            self._save_settings()

    def move_stop(self, frm, to):
        """Drag and drop in the route list: move stop `frm` to position `to`."""
        with self._lock:
            stops = self._stops()
            if 0 <= frm < len(stops) and 0 <= to < len(stops):
                st = stops.pop(frm)
                stops.insert(to, st)
                self._set_from_stops(stops)
                self._save_settings()
            return {"ok": True}

    def remove_stop(self, index):
        with self._lock:
            stops = self._stops()
            if 0 <= int(index) < len(stops):
                stops.pop(int(index))
                self._set_from_stops(stops)
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
            if body and name in gateways.GATEWAYS:            # gateways are far out; Wikelo's orbit planets
                return {"ok": False, "error": f"That reading is near {body.name}, not at the gateway. "
                                              "Take it while docked at the station"}
            gateways.save_learned(PLACES_PATH, name, system, self._player)
            _, self._unplaced = gateways.apply(self._db, gateways.load_learned(PLACES_PATH))
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
            places[name] = {"system": system, "body": b.name, "local": list(b.to_local(self._player, self._player_t)),
                            "at": time.time()}
        else:
            places[name] = {"system": system, "pos": list(self._player), "at": time.time()}
        PLACES_PATH.write_text(json.dumps({"places": places}, indent=1), encoding="utf-8")
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
            if pad is not None:
                loc.pad = pad
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
        self._save_settings()
        return st

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
        self._uex.token = token
        self._settings["uex_token"] = token
        self._save_settings()
        self._refresh_uex_places()
        return {"ok": True}

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
        if st.get("ok"):          # ones Quantum knows but can't place yet (gateways, Wikelo): say so
            pending = {services._key(n): n for n in self._unplaced}
            st["needs_position"] = sorted(pending[services._key(n)] for n in st["unmatched"] if services._key(n) in pending)
            st["unmatched"] = [n for n in st["unmatched"] if services._key(n) not in pending]
        return st

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
                                    status=r.get("status_buy")))
                if r.get("price_sell"):
                    sell.append(dict(base, price=r["price_sell"], avg=r.get("price_sell_avg"),
                                     scu=r.get("scu_sell_stock"), status=r.get("status_sell")))
            buy.sort(key=lambda x: x["price"])
            sell.sort(key=lambda x: -x["price"])
            return {"ok": True, "buy": buy, "sell": sell, "at": at}
        return self._uex_call(run)

    def uex_vehicles(self):
        """Every ship and ground vehicle, with where to buy and rent it in game and for how much."""
        def run():
            vehicles, at = self._uex.get("vehicles")
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
            roles = VEHICLE_ROLES or [("is_cargo", "Cargo"), ("is_mining", "Mining"), ("is_salvage", "Salvage"),
                     ("is_military", "Combat"), ("is_bomber", "Bomber"), ("is_exploration", "Exploration"),
                     ("is_medical", "Medical"), ("is_refuel", "Refuel"), ("is_repair", "Repair"),
                     ("is_passenger", "Passenger"), ("is_racing", "Racing"), ("is_starter", "Starter"),
                     ("is_ground_vehicle", "Ground"), ("is_industrial", "Industrial"), ("is_science", "Science")]
            out = []
            for v in vehicles:
                if v.get("is_concept") or v.get("is_addon"):
                    continue
                sp = spots.get(v["id"], {"buy": [], "rent": []})
                for k in ("buy", "rent"):
                    sp[k].sort(key=lambda x: x["price"])
                out.append({
                    "id": v["id"], "name": v.get("name"), "full": v.get("name_full") or v.get("name"),
                    "maker": v.get("company_name") or "", "scu": v.get("scu") or 0, "crew": v.get("crew") or "",
                    "pad": v.get("pad_type"), "ground": bool(v.get("is_ground_vehicle")),
                    "roles": [label for flag, label in roles if v.get(flag)],
                    "qfuel": v.get("fuel_quantum"), "hfuel": v.get("fuel_hydrogen"),
                    "store": v.get("url_store"), "photo": v.get("url_photo"), "buy": sp["buy"], "rent": sp["rent"]})
            out.sort(key=lambda v: (v["buy"][0]["price"] if v["buy"] else 9e12, v["full"]))
            return {"ok": True, "vehicles": out, "at": at}
        return self._uex_call(run)

    def wiki_image(self, ref):
        """Picture for an item from the Star Citizen Wiki (its page's main image), cached. ref is the
        wiki URL UEX gives, or a page title."""
        title = urllib.parse.unquote(str(ref or "").rstrip("/").rsplit("/", 1)[-1]).replace("_", " ").strip()
        if not title:
            return None
        cache_f = HERE / "uex_cache" / "wiki_images.json"
        try:
            cache = json.loads(cache_f.read_text(encoding="utf-8"))
        except Exception:
            cache = {}
        if title in cache:
            return cache[title] or None
        url = ("https://starcitizen.tools/api.php?action=query&format=json&prop=pageimages&piprop=thumbnail"
               "&pithumbsize=720&redirects=1&titles=" + urllib.parse.quote(title))
        try:
            req = urllib.request.Request(url, headers={"User-Agent": "Quantum (Star Citizen route planner)"})
            with urllib.request.urlopen(req, timeout=15) as r:
                pages = json.loads(r.read().decode("utf-8")).get("query", {}).get("pages", {})
            img = next((p["thumbnail"]["source"] for p in pages.values() if p.get("thumbnail")), "")
        except Exception:
            return None                                     # offline: try again next time
        cache[title] = img
        cache_f.parent.mkdir(exist_ok=True)
        cache_f.write_text(json.dumps(cache), encoding="utf-8")
        return img or None

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
                       "turret", "mining laser", "mining module", "gadget", "salvage", "tractor", "radar", "bomb")
    COMPONENT_SKIP = ("clothing", "armor", "undersuit", "jumpsuit", "helmet", "personal", "fps", "food", "drink",
                      "medical", "tool", "decoration", "flair", "paint", "livery", "utility")

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
                    and not any(k in txt(c) for k in self.COMPONENT_SKIP)] or items
            out = [{"id": c["id"], "name": c.get("name"), "section": c.get("section") or "Other"} for c in pick]
            out.sort(key=lambda c: (c["section"], c["name"] or ""))
            return {"ok": True, "items": out}
        return self._uex_call(run)

    def uex_components(self, id_category):
        """Items in one category with where to buy them and for how much."""
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
            out.sort(key=lambda x: (str(x["size"] or ""), x["buy"][0]["price"] if x["buy"] else 9e12, x["name"] or ""))
            return {"ok": True, "items": out, "at": at}
        return self._uex_call(run)

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
            "photo": v.get("url_photo"), "store": v.get("url_store"), "wiki": bool(d),
            "roles": [label for flag, label in VEHICLE_ROLES if v.get(flag)],
            "career": d.get("career") or d.get("role"), "description": d.get("description") if isinstance(d.get("description"), str) else None,
            "crew_min": g("crew", "min") or v.get("crew"), "crew_max": g("crew", "max"),
            "seats": seat.get("crew_stations"), "beds": seat.get("beds"), "medical_beds": seat.get("medical_beds"),
            "medical_tier": d.get("max_medical_tier"), "ejection": seat.get("ejection_seats"), "escape_pods": seat.get("escape_pods"),
            "jump_seats": seat.get("jump_seats"),
            "scu": v.get("scu") or d.get("cargo_capacity") or 0, "ore": d.get("ore_capacity"),
            "storage_scu": round(inv / 1e6, 2) if isinstance(inv, (int, float)) and inv else None,
            "lockers": g("weapon_storage", "slots_total"),
            "length": size.get("length"), "beam": size.get("beam") or size.get("width"), "height": size.get("height"),
            "mass": d.get("mass_total") or d.get("mass"), "pad": v.get("pad_type"), "size_class": d.get("size_class"),
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

    def wiki_images(self, refs):
        """{ref: picture url} for many wiki pages at once (commodity and component grids)."""
        return self._wikiapi.pictures(list(refs or []))

    # ------------------------------------------------------------ My Fleet
    def _fleet(self):
        return self._settings.setdefault("fleet", [])

    def _vehicle_rows(self):
        try:
            return {v["id"]: v for v in self._uex.get("vehicles", offline=not self._uex.token)[0]}
        except uex.UexError:
            return {}

    def fleet_list(self):
        rows = self._vehicle_rows()
        out = []
        for f in self._fleet():
            v = rows.get(f["vehicle_id"], {})
            out.append(dict(f, full=v.get("name_full") or f.get("name"), maker=v.get("company_name") or "",
                            scu=v.get("scu") or 0, photo=v.get("url_photo"), pad=v.get("pad_type"),
                            swaps=len(f.get("loadout") or {})))
        return {"ok": True, "ships": out, "main": next((f["uid"] for f in self._fleet() if f.get("main")), None)}

    def fleet_add(self, vehicle_id):
        v = self._vehicle_rows().get(int(vehicle_id))
        if not v:
            return {"ok": False, "error": "Pick a ship from the list"}
        uid = f"s{int(time.time() * 1000)}"
        fl = self._fleet()
        fl.append({"uid": uid, "vehicle_id": v["id"], "name": v.get("name_full") or v.get("name"),
                   "main": not any(f.get("main") for f in fl), "loadout": {}})
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
                "parts": (pw.get("parts") or {}).get(mode) or {}, "fixed": lo.get("fixed") or []}
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
        if now.get("pool"):                               # the guns' shared power pool, shown as one bar
            guns = [x for x in lo["slots"] if x["type"] == "WeaponGun"]
            lo.setdefault("fixed", []).insert(0, {"port": fleet.WEAPONS, "type": fleet.WEAPONS, "label": "Weapons",
                                                  "stock": {"name": f"{len(guns)} gun{'s' if len(guns) != 1 else ''}"},
                                                  "power": now["parts"].get(fleet.WEAPONS)})
        return {"ok": True, "uid": uid, "ship": dict(f, full=v.get("name_full") or f["name"], photo=v.get("url_photo"),
                                                     scu=v.get("scu") or 0),
                "game_data": self._game.generated, **lo}

    def fleet_options(self, slot_type, size, uid=None):
        """Components that fit a slot (same kind and size), with where to buy them. From the game files
        when they cover this kind of slot (every part, exact numbers), else UEX's lists."""
        f = next((x for x in self._fleet() if x["uid"] == uid), None) if uid else None
        ground = bool(self._vehicle_rows().get(f["vehicle_id"], {}).get("is_ground_vehicle")) if f else False
        game = self._game.of_kind(slot_type, size, ground)
        if game:
            return self._uex_call(lambda: self._game_options(slot_type, game))
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

    def fleet_set_slot(self, uid, port, item_name, uuid=None):
        f = next((x for x in self._fleet() if x["uid"] == uid), None)
        if not f:
            return {"ok": False, "error": "That ship isn't in your fleet"}
        lo = f.setdefault("loadout", {})
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
        for k in ("units", "buy_price", "sell_price", "plan_buy", "plan_sell", "handling"):
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

    def trade_run_stage(self, rid, stage, price=None):
        """Move a run along: planned > bought > in transit > sold. Buying or selling can record the
        price you actually got (per SCU)."""
        r = next((x for x in self._runs() if x["id"] == rid), None)
        if not r or stage not in self.TRADE_STAGES:
            return {"ok": False, "error": "Run not found"}
        r["stage"] = stage
        r.setdefault("times", {})[stage] = time.time()
        for later in self.TRADE_STAGES[self.TRADE_STAGES.index(stage) + 1:]:
            r["times"].pop(later, None)             # stepping back clears what came after
        if price not in (None, ""):
            r["buy_price" if stage == "bought" else "sell_price"] = float(price)
        self._save_settings()
        return {"ok": True}

    def trade_run_delete(self, rid):
        self._settings["trade_runs"] = [x for x in self._runs() if x["id"] != rid]
        self._save_settings()
        return {"ok": True}

    def uex_origins(self):
        """Starting points for trade routes: every planet (or orbit, where UEX has no planet) that has
        a commodity terminal, plus the one nearest you."""
        def run():
            terms = self._uex.terminals()
            places = self._uex.place_map(self._db.locations)
            opts, near = {}, None
            for tid, t in terms.items():
                if t.get("type") != "commodity":
                    continue
                key = ("planet", t["id_planet"], t.get("planet_name")) if t.get("id_planet") else \
                      ("orbit", t["id_orbit"], t.get("orbit_name"))
                if key[1] and key[2]:
                    opts[key] = t.get("star_system_name")
                d = self._dist_from_you(places.get(tid))
                if d is not None and (near is None or d < near[0]):
                    near = (d, key)
            items = [{"kind": k[0], "id": k[1], "name": k[2], "system": sysn} for k, sysn in opts.items()]
            items.sort(key=lambda o: (SYSTEM_ORDER.get(o["system"], 9), o["name"]))
            here = {"kind": near[1][0], "id": near[1][1], "name": near[1][2]} if near else None
            return {"ok": True, "items": items, "here": here}
        return self._uex_call(run)

    def uex_routes(self, kind, origin_id, scu=0, budget=0, stay="", avoid=None, one_system=False):
        """Best runs from a planet/orbit for your cargo space and budget, most profit first."""
        def run():
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
                    "elevator_from": bool(r.get("has_freight_elevator_origin") or r.get("has_loading_dock_origin")),
                    "faction_from": r.get("origin_faction_name"), "faction_to": r.get("destination_faction_name")})
            out.sort(key=lambda x: -x["profit"])
            return {"ok": True, "routes": out[:60], "at": at, "total": len(out)}
        return self._uex_call(run)

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
                            for b in self._db.bodies.values() if b.calibrated})
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

    def calibration_status(self):
        """Per body: aligned or community values, and what the checks say about drift."""
        with self._lock:
            hist = self._cal_file().get("history", [])
            out = []
            for b in sorted(self._db.bodies.values(), key=lambda b: (b.system, b.kind != "planet", b.name)):
                if b.kind == "star":
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
        where = o.marker.get("body") or o.marker.get("lpoint", "space")
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
            return {"ok": True, "name": n}

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


def rename_gateways(db):
    """In game the jump points between systems are called Gateways ("Pyro Gateway"). Rename older
    "Pyro Jump Point" entries so saved data keeps working. Returns {old name: new name}."""
    out = {}
    for name in list(db.locations):
        loc = db.locations[name]
        if loc.category == "jump" and name.endswith(" Jump Point"):
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


def apply_calibrations(db, data):
    """Apply a calibration file to the database. A planet already calibrated more recently is kept."""
    applied, skipped = [], []
    for name, c in (data.get("bodies") or {}).items():
        b = db.bodies.get(name)
        if not b:
            skipped.append(f"{name} (not in your map)")
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


def main():
    if "--import" in sys.argv:          # Quantum.exe --import : download / refresh the map data
        if FROZEN and os.name == "nt":  # the exe has no console of its own: open one for the progress
            import ctypes
            ctypes.windll.kernel32.AllocConsole()
            sys.stdout = sys.stderr = open("CONOUT$", "w", buffering=1)
        import import_data
        sys.argv = [a for a in sys.argv if a != "--import"]
        import_data.main()
        if FROZEN:
            input("\nPress Enter to close.")
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
    webview.start(func=lambda: overlay.set_window_icon(icon))


if __name__ == "__main__":
    main()
