"""Quantum - 3D route planner, waypoint finder and contract map for Star Citizen.

Python backend + HTML/WebGL UI in a native window (pywebview / Edge WebView2).
Read-only data sources; nothing touches the game process:
  - /showlocation clipboard text  -> your position
  - Game.log                      -> contracts, exact objective markers, current system/planet
  - locations.json                -> map database (run import_data.py once)
"""
import json
import os
import math
import sys
import threading
import time
from pathlib import Path

import webbrowser

import webview

import services
import wiki

from gamelog import ContractTracker, contract_cargo
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
# Where a hangar reading in each city is anchored: its spaceport (or the city if the data has no spaceport).
CITY_ANCHOR = {"New Babbage": "New Babbage Interstellar Spaceport", "Area 18": "Riker Memorial Spaceport",
               "Orison": "August Dunlow Spaceport", "Lorville": "Lorville", "Levski": "Levski"}
QUALITY = {"": 0, "estimate": 0, "hangar": 1, "station": 2, "place": 3}
BUILTIN_CAL_PATH = RES / "builtin_calibrations.json"   # shared alignments shipped with Quantum   # your planet alignments + evidence; shareable


class Api:
    """Public methods are callable from JS as window.pywebview.api.<name>(...)."""

    def __init__(self):
        self._lock = threading.RLock()
        self._db = NavDB.load(DB_PATH)
        self._db.path = DB_PATH
        self._renamed = rename_gateways(self._db)
        for path in (BUILTIN_CAL_PATH, CAL_PATH):   # shipped alignments first, then yours / shared ones
            if not path.exists():
                continue
            try:
                applied, _ = apply_calibrations(self._db, json.loads(path.read_text(encoding="utf-8")))
                if applied:
                    self._db.save()
            except Exception:
                pass
        self._settings = self._load_settings()
        # The route is a list of tasks. A task is a plain visit, or one contract objective at a place.
        # Consecutive tasks at the same place form one stop; a place can come back later in the trip.
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
        self._services = services.match(self._service_records, self._db.locations)
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
        # Automatic /showlocation was removed: the log can't tell reliably when a quantum jump is under way.
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

    def _on_position(self, pos, t):
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
        """A /showlocation soon after a jump tells us exactly where that jump went: the nearest place you
        can jump to (orbital marker, station, outpost...) is what the destination id means."""
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
        # Close to one jump point, and clearly closer to it than to any other.
        if best and bd < 150_000 and second > 2 * bd:
            q["by_reading"] = True
            self._tracker.learn_dest(q["dest"], best, "reading")

    def _auto_arrive(self, cur):
        """Tick off the next stop when you get there. Evidence, from the log or a /showlocation:
          - landing or docking at that place (or anywhere in that city),
          - a quantum jump arriving at a destination known to be that place,
          - a /showlocation within reach of it (1.5 km on the ground, 30 km in space).
        Stops with contract jobs stay until the job itself completes; they're marked as reached."""
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

        - City or spaceport (e.g. your hangar at New Babbage): anchored to that city's spaceport.
          Hangars sit a few km from the spaceport's map point, so this is good to a few km.
        - Orbital station (e.g. Port Tressler): anchored to the station, good to about a km.
        - Any other named place (outposts, distribution centres): exact.
        Latitude and height don't depend on the rotation angle, so they must roughly match the anchor
        first. A better-quality calibration is never replaced by a rougher one; the reading is logged
        as a drift check instead."""
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
            # A small named place: the reading has to match one known place tightly.
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
                return                                  # two different places fit: let the prompt ask
            target, mode, lat_tol, alt_tol = matches[0][1], "place", 0.3, 15_000
        if target.kind != "surface" or target.body != body.name:
            return
        if body.calibrated and abs((body.calibrated_at or 0) - self._player_t) < 1:
            return                                      # this reading already calibrated this body
        have = QUALITY.get(body.calibration_quality, 0) if body.calibrated else -1
        if QUALITY[mode] < have:
            # Rougher than what we already have: don't overwrite, but it's a useful drift check.
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
        """You just completed a pickup or drop-off: the log's marker for it is where you're standing.
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
            # 0.05 degrees (about 900 m on a 1,000 km planet) and 1.5 km of height: you're at the marker.
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
        planet's rotation angle) but the map puts you far from it: offer to line the planet up there.
        Places near the area the log last named come first; otherwise the closest matches anywhere."""
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
            if off < 3_000:                # you're already where the map says: nothing to fix
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

    def _db_changed(self):
        self._services = services.match(self._service_records, self._db.locations)
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
                # a moon's parent: at least twice its size and close by (within 200 parent radii)
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
                     **({"amen": self._services[l.name]["amenities"],
                         "pad_auto": services.pad_from(self._services[l.name]["amenities"])}
                        if l.name in self._services else {})}
                    for l in self._db.locations.values()]
            info = {b["name"]: wiki.for_game_body(self._wiki, b["name"], b["kind"], b["system"]) for b in out_b}
            return {"version": self._static_version, "bodies": out_b, "locations": locs, "systems": SYSTEMS,
                    "wiki": {"bodies": info, "systems": (self._wiki or {}).get("systems", {})}}

    # ------------------------------------------------------------ live data
    def get_live(self):
        with self._lock:
            t = time.time()
            p, psys = self._player, self._player_sys
            ptime, approx = self._player_t, None
            cur = self._tracker.cur or {}
            # Landed or docked somewhere the log names, and that's newer than your last /showlocation:
            # show you at that place (approximate) until a real reading comes in.
            near = cur.get("near") if cur and not cur.get("landing") else None
            spot = cur.get("place") if cur and cur.get("landing") else near
            if spot in self._db.locations and (not p or cur["at"] > self._player_t):
                L = self._db.locations[spot]
                p, psys, ptime, approx = self._db.global_pos(L, t), L.system, t, L.name
            self._auto_arrive(cur)
            self._prune_finished_tasks()
            stops = self._stops()
            names = [st["place"] for st in stops]
            live = {"now": t, "static_version": self._static_version, "route": names,
                    "player": None, "next": None, "legs": [], "total": 0.0, "guide": None,
                    "contracts": [], "contracts_version": self._tracker.version,
                    "log": {"path": self._tracker.log_path, "status": self._tracker.status,
                            "clear_on_start": bool(self._settings.get("clear_log_on_start")),
                            "game_running": self._tracker.game_running, "note": self._tracker.log_note,
                            "cleared": self._log_cleared},
                    "where": self._tracker.where,
                    "travel": self._travel_view(cur, t),
                    "arrived": self._arrived_note}
            if p:
                body = self._db.body_near(p, psys)
                info = {"pos": p, "t": ptime, "age": t - (cur["at"] if approx else ptime), "system": psys, "body": None,
                        "approx": approx}
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
                if not o or o.status != "active" or c.status != "active":
                    changed = True
                    continue
                place = self._existing_place(o) or self._objective_place(c, o)
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
        """Per stop: what you do there. Also flags a delivery planned before its pickup."""
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
        if m and not m.get("body"):                     # rest stop at a Lagrange point: global position
            loc = Location("marker", "space", tuple(m["pos"]), None, system=m["system"])
            return loc.pos, m["system"], loc
        if m and m["body"] in self._db.bodies:
            b = self._db.bodies[o["marker"]["body"]]
            loc = Location("marker", "surface", tuple(o["marker"]["pos"]), b.name, system=b.system)
            return b.to_global(loc.pos, t), b.system, loc
        return None, None, None

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
            if tr["stage"] == 1 and p and tr["times"][1] and self._player_t > tr["times"][1]:
                for o in c["objectives"]:
                    if o["kind"] == "pickup":
                        g, sysname, _ = self._objective_global(o, tc)
                        if g and (sysname != psys or dist(g, p) > 3000):
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
        """Reorder the tasks. Each task is a node (its place's position); tasks at the same place are
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
        """Services, jurisdiction and in-game description for one place (None if unknown)."""
        r = self._services.get(name)
        return dict(r, pad=services.pad_from(r["amenities"])) if r else None

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
