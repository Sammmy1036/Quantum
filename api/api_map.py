"""Api, part of: The map: static and live data, route tasks and the route, waypoints, places named by the wiki, and shared calibrations.

A mixin of app.py's Api (class Api(... MapMixin ...)): the methods are the Api's, `self` is the one Api.
Module-level names come from qbase.py."""
from qbase import *  # noqa: F401,F403


class MapMixin:
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
            unreleased = self._unreleased_bodies()
            out_b = []
            for b in bodies:
                # a moon's parent at least twice its size and close by (within 200 parent radii)
                parents = [p for p in bodies if p.system == b.system and p.radius_m >= 2 * b.radius_m
                           and (p.kind == "star" or dist(p.center, b.center) < 200 * p.radius_m)]
                parent = min(parents, key=lambda p: dist(p.center, b.center), default=None)
                out_b.append({"name": b.name, "center": b.center, "radius": b.radius_m, "system": b.system,
                              "kind": b.kind, "period": b.rotation_period_h, "offset": b.rotation_offset_deg,
                              "epoch": b.epoch_utc, "om": b.om_radius_m, "calibrated": b.calibrated,
                              "alignable": can_align(b) and b.name not in unreleased,
                              "align_note": NO_ALIGN.get(b.name) or (f"Not in the LIVE game yet: comes with {unreleased[b.name]}"
                                                                    if b.name in unreleased else None),
                              "parent": parent.name if parent and b.kind != "star" else None,
                              "atmo": self._atmo_store().view(b)})       # can you breathe there (card line)
            hidden_keys = self._hidden_keys()
            unverified = gateways.unverified(self._learned_places())     # "Check its position" jobs
            fix_orig = getattr(self, "_fix_orig", {})
            fix_mine = {n for n, e in gateways.load_learned(PLACES_PATH).items() if e.get("fix")}
            locs = [{"name": l.name, "kind": l.kind, "pos": l.pos, "body": l.body, "pad": l.pad,
                     "notes": l.notes, "source": l.source, "system": l.system, "qt": l.qt,
                     "pinned": l.pinned, "created": l.created, "type": classify(l.name, l.category), "icon": l.icon,
                     # "to" only on the jump points themselves, so the UI doesn't treat the gateway
                     # station as a wormhole; the station gets "gate_to" and its jump point's name.
                     "to": gateways.leads_to(l.name) if l.name in gateways.JUMP_POINTS
                     or (l.name not in gateways.GATEWAYS and classify(l.name, l.category) == "jump") else None,
                     "gate_to": gateways.leads_to(l.name) if l.name in gateways.GATEWAYS else None,
                     "jump_point": gateways.jump_point_of(l.name), "station": gateways.station_of(l.name),
                     "unplaced": l.pos is None,
                     "placeable": gateways.system_of(l.name) is not None or l.name in getattr(self, "_uex_pending", {}),
                     "verify": l.pos is not None and l.name in unverified,
                     # a wrong spot can be reported for any place on the map (fixed: whose correction it shows)
                     "fixable": l.name in fix_orig or (l.pos is not None and self._fixable(l.name)),
                     "fixed": ("mine" if l.name in fix_mine else "community") if l.name in fix_orig else None,
                     "fix_pending": (getattr(self, "_fix_pending", {}) or {}).get(l.name) if l.name not in fix_mine else None,
                     "near": gateways.near_body(l.name),
                     "pad_shared": self._shared_pad(l.name),
                     **({"amen": self._services[l.name]["amenities"],
                         "pad_auto": services.pad_from(self._services[l.name]["amenities"])}
                        if l.name in self._services else {})}
                    for l in [*self._db.locations.values(), *self._unplaced.values()]
                    if l.pos is not None or _place_key(l.name) not in hidden_keys]
            info = {b["name"]: wiki.for_game_body(self._wiki, b["name"], b["kind"], b["system"]) for b in out_b}
            # Onyx Facilities' own frames (build_game_planet.py --onyx), for their floor plans (ui/js/onyx.js)
            onyx = {q["name"]: {"body": q.get("body"), "pos": q["local"], "rot": q["rot"]}
                    for q in ((getattr(self, "_game_bodies", None) or {}).get("places") or [])
                    if str(q.get("name", "")).startswith("Onyx Facility") and q.get("rot") and q.get("local")}
            return {"version": self._static_version, "bodies": out_b, "locations": locs, "systems": SYSTEMS, "onyx": onyx,
                    "wiki": {"bodies": info, "systems": (self._wiki or {}).get("systems", {})}}

    # ------------------------------------------------------------ live data
    def _log_spot(self, cur):
        """Best place the log puts you at -> (place, when, how), or (None, 0, None).
        Landed/docked there > arrived there by quantum > talking to its traffic control or entering it >
        just took off from it. Unknown places, deaths and quantum jumps under way give nothing."""
        cur, locs = cur or {}, self._db.locations
        spot = self._log_spot_any(cur, locs)
        # A guess in another system than the one the log says you're in is a wrong guess (a marker matched to
        # a same-word place elsewhere): systems only change through a gateway, and the log names those
        wsys = (self._tracker.where or {}).get("system")
        if spot[0] and wsys in nav_core.SYSTEMS and locs[spot[0]].system and locs[spot[0]].system != wsys:
            return None, 0, None
        return spot

    def _log_spot_any(self, cur, locs):
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
            wc = spaceport_city(wp) or wp
            # a city the log names for a wide area (its moons, low over the planet) needs backing up
            if not (wc.split(" (")[0].lower() in nav_core.CITIES and wc in locs) or self._city_confirmed(wc, w["at"]):
                options.append((wp, w["at"], "log"))
        if cur.get("left") in locs and cur.get("at"):
            options.append((cur["left"], cur["at"], "left"))
        return max(options, key=lambda o: o[1]) if options else (None, 0, None)

    def _play_tick(self, game_on, t):
        """Play time: this session started when Quantum first saw the game running; today's and all-time
        totals add up while it runs (kept in settings, saved about once a minute)."""
        pl = getattr(self, "_play", None)
        if pl is None:
            pl = self._play = {"since": None, "last": None, "saved": t}
        rec = self._settings.setdefault("play_time", {})
        day = time.strftime("%Y-%m-%d", time.localtime(t))
        if rec.get("day") != day:
            rec.update(day=day, today=0.0)
        if game_on:
            if not pl["since"]:
                pl["since"] = t
            if pl["last"] and 0 < t - pl["last"] < 30:          # a gap (asleep, hung) isn't play time
                dt = t - pl["last"]
                rec["today"] = float(rec.get("today") or 0) + dt
                rec["total"] = float(rec.get("total") or 0) + dt
            pl["last"] = t
            if t - pl["saved"] > 60:
                pl["saved"] = t
                self._save_settings()
        else:
            if pl["since"]:
                self._save_settings()
            pl["since"] = pl["last"] = None
        return {"since": pl["since"], "today": round(float(rec.get("today") or 0)), "total": round(float(rec.get("total") or 0))}

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
            self._spot_now = (spot, spot_at, how)
            # Entering a city's zone or talking to its traffic control happens 10-15 km out: while telemetry still has
            # you flying (a live dead-reckoned estimate), that's where you are, not on the spaceport already.
            # Once the log's place has taken over for this arrival it keeps it: hovering and setting down, telemetry's
            # speed goes over and under the "flying" mark, and you flipped between the place and your last
            # /showlocation many km back, the map zooming in and out on every flip as it re-framed you.
            won = getattr(self, "_spot_won", None) == (spot, spot_at)
            if spot and (not p or spot_at > self._player_t) and (won or not self._estimate_beats_log(how, t)):
                self._spot_won = (spot, spot_at)
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
                # No gateway known between the two: keep the last reading on the map rather than dropping
                # you off it entirely. The log's system hints can be wrong (a contract or shop naming another
                # system), and a /showlocation you just typed must never make you disappear; if you really
                # did change systems, the next /showlocation (or the system picker) puts you right.
            if game_on:
                self._auto_arrive(cur)
                self._auto_trade_transit()
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
                            "build": self._game_build() if self._tracker.build else self._settings.get("last_build"),
                            "cleared": self._log_cleared},
                    "where": self._tracker.where,
                    "social": self._social_badge(),
                    "city_clock": {**self._clock_cfg(), "available": city_clock.AVAILABLE, "in_city": self._clock_city},
                    "nav_overlay": self._nav_view(),
                    "travel": self._travel_view(cur, t) if game_on else None,
                    "contacts": self._tracker.contacts_view() if game_on and self._settings.get("contacts_on", True) else [],
                    # the Onyx Facility you're in, from the location the game logs when you land there
                    "onyx_here": gamelog.onyx_name((self._tracker.where or {}).get("code")) if game_on else None,
                    "arrived": self._arrived_note if game_on else None, "game_off": not game_on,
                    "play": self._play_tick(game_on, t),
                    "trade_ver": getattr(self, "_trade_changed", 0),
                    "telemetry": self._tel_live() if game_on else None}
            if p:
                body = self._db.body_near(p, psys)
                how = getattr(self, "_sys_how", None) or ("log", "", None)
                info = {"pos": p, "t": ptime, "age": t - (spot_at if approx else ptime), "system": psys, "body": None,
                        "sys_how": how[0], "sys_from": how[1], "sys_at": how[2],
                        "approx": approx, "approx_how": how if approx else None,
                        "fix_t": self._player_t}      # when your last /showlocation came in (t moves with log spots)
                if body:
                    local = body.to_local(p, ptime)
                    lat, lon, alt = body.lat_lon_alt(local)
                    info.update(body=body.name, lat=lat, lon=lon, alt=alt, local=local)
                live["player"] = info
                try:
                    live["player_est"] = self._position_estimate(info, p, psys, approx, t)
                except Exception as e:
                    print("position estimate:", e, flush=True)
                # Out on foot with telemetry on: remember whether the air there is breathable (Atmosphere.learn).
                try:
                    tel = live.get("telemetry") or {}
                    if info.get("age", 1e9) < 180 and self._atmo_store().learn(self._db, info, tel.get("actor"), tel.get("age")):
                        self._static_version += 1             # the planet's card shows it
                        self._queue_breath(info["body"])      # and everyone's, once others agree (Quantum server)
                except Exception as e:
                    print("atmosphere:", e, flush=True)
            tc = ptime if p else t   # evaluate at the moment of the reading (or now, for a logged arrival)
            live["legs"] = self._db.route_length(p, psys, names, tc)
            live["no_qt"] = self._no_qt_stops(names, p, psys, tc)
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
            gu = getattr(self, "_game_update", None) or self._settings.get("game_update")
            if gu:
                live["game_update"] = gu
            try:
                self._shop_check_purchases()
            except Exception as e:
                print("shopping purchases:", e, flush=True)
            sv = getattr(self, "_shop_ver", 0)
            cart = (self._settings.get("shopping") or {}).get("items") or []
            live["watch"] = self._watch_live()                 # price alerts (api_watch.py)
            live["shopping"] = {"ver": sv, "note": getattr(self, "_shop_note", None),
                                "count": sum(max(0, (e.get("qty") or 1) - (e.get("bought") or 0)) for e in cart)}
            if getattr(self, "_server_checked", None):           # the Quantum server, as last checked (see _watch_server)
                live["server"] = {"ok": self._server_ok, "error": self._server_error, "at": self._server_checked,
                                  "back": getattr(self, "_server_back_at", None),
                                  "down_since": getattr(self, "_server_down_since", None)}
            # Suspended or banned from community features by the moderation team: the server says so in every
            # social check-in ({until, reason}; until None = until it's lifted, i.e. banned). None when it isn't.
            so_state = (self._soc.get("state") or {}) if getattr(self, "_soc", None) else {}
            live["acct_block"] = so_state.get("suspended") if so_state.get("status") == "ok" else None
            if self._settings_note:
                live["settings_note"] = self._settings_note
            live["calibration"] = self._calibration
            live["calib_suggest"] = self._calib_suggestion()
            live["at_place"] = ({"name": self._tracker.place_for_code(w["code"]), "code": w["code"], "at": w.get("at")}
                                if w.get("code") else None)
            self._fm_note_me(live.get("player"), (live.get("at_place") or {}).get("name"))   # for the Friend Map
            live["friends"] = self._fm_live()
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
            if t["task"].startswith(self.TRADE):          # a trade run's buy or sell stop (api_trade.py)
                if not self._trade_task_wanted(t["task"]):
                    changed = True
                    continue
            elif t["task"] != "visit" and t["task"] not in self.GATES:
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
                if t["task"].startswith(self.TRADE):
                    rid, _, what = t["task"][len(self.TRADE):].partition("|")
                    run = next((x for x in self._runs() if x["id"] == rid), None)
                    if run:
                        r.append({"kind": what, "cargo": run.get("commodity") or "", "run": rid,
                                  "scu": run.get("units")})
                        pos[t["task"]] = i
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
        for r in self._runs():
            a, b = pos.get(f"{self.TRADE}{r['id']}|buy"), pos.get(f"{self.TRADE}{r['id']}|sell")
            if a is not None and b is not None and b < a:
                warning = f"{r.get('commodity') or 'A trade run'} is sold before it's bought. Plan the route to fix the order."
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
                if not o.get("location") and (c["id"], o["id"]) in self._obj_suggest:
                    o["suggest"] = self._obj_suggest[(c["id"], o["id"])]
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
        for r in self._runs():                           # trade runs: buy before you sell
            a, b = f"{self.TRADE}{r['id']}|buy", f"{self.TRADE}{r['id']}|sell"
            if a in ids and b in ids:
                pairs.append((a, b))
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

    def _atmo_store(self):
        a = getattr(self, "_atmo", None)
        if a is None:
            from planner.atmosphere import Atmosphere
            a = self._atmo = Atmosphere(HERE / "atmosphere.json",
                                        files=(RES / "atmosphere_bodies.json", HERE / "atmosphere_bodies.json"))
        return a

    # ---- breathability, crowd-sourced like alignments (planner/atmosphere.py, server /v1/breathability)
    def _queue_breath(self, body):
        """A new reading of a body's air (Atmosphere.learn): keep it until the server has it, then send it."""
        s = self._atmo_store().seen.get(body)
        build = self._game_build()
        b = self._db.bodies.get(body)
        if not s or not build or not b:
            return
        entry = {"body": body, "system": b.system, "build": str(build), "breathable": bool(s["breathable"]),
                 "pressure": s.get("pressure"), "temp": s.get("temp"), "alt": s.get("alt_m")}
        self._settings.setdefault("breath_unsent", {})[body] = entry
        self._save_settings()
        self._send_breath(entry)

    def _send_breath(self, entry):
        user = self._dr_cfg().get("username") or (self._dr_cfg().get("uex_user") or {}).get("username")
        if not user or not self._community.url:
            return                                          # sent once you've signed in

        def done(answered):
            waiting = self._settings.get("breath_unsent") or {}
            if answered and waiting.get(entry["body"]) is entry:
                waiting.pop(entry["body"], None)
                self._save_settings()
        self._community.post_breath(dict(entry, username=user.lower()), on_done=done)

    def _resend_breath(self):
        """Readings the server hasn't got yet (only this game build's: an older one could be out of date)."""
        build = self._game_build()
        waiting = self._settings.get("breath_unsent") or {}
        from planner.atmosphere import CONFIRMED
        stale = [k for k, e in waiting.items() if (build and str(e.get("build")) != str(build))
                 or (k in CONFIRMED and bool(e.get("breathable")) != CONFIRMED[k])]     # a glitch reading: not sent
        for k in stale:
            waiting.pop(k, None)
        if stale:
            self._save_settings()
        for e in list(waiting.values()):
            self._send_breath(e)

    def _sync_breath_once(self):
        """What everyone's readings agree on, from the Quantum server: the cards' confirmed answers."""
        r = self._community.breathability()
        if r is None:
            return
        a = self._atmo_store()
        if a.set_community(r["agreed"], r["waiting"]):
            with self._lock:
                self._static_version += 1

    # ------------------------------------------------------------ route
    def add_stops(self, names, repeat=False):
        """Add places to the end of the route. With repeat, a place already in the route is added again
        (Area 18 > Baijini Point > New Babbage > Baijini Point), unless it would come straight after
        itself, which is the same stop. Without it (trade-route and contract buttons), places already in
        the route are left where they are. -> {ok, added, skipped}"""
        with self._lock:
            have = {t["place"] for t in self._route}
            added, skipped = [], []
            for n in names:
                if n not in self._db.locations:
                    continue
                last = next((t["place"] for t in reversed(self._route) if t["task"] not in self.GATES), None)
                if (n in have and not repeat) or n == last:
                    skipped.append(n)
                    continue
                self._route.append({"place": n, "task": "visit"})
                have.add(n)
                added.append(n)
            self._ensure_gates(self._player_sys)
            self._save_settings()
            return {"ok": True, "added": added, "skipped": skipped}

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

    def _no_qt_stops(self, names, p, psys, t):
        """Route stops you can't quantum to: no marker of their own (an Onyx Facility, a cave, a derelict).
        For each: the nearest quantum markers to jump to first and how far you fly from there, or that an
        active contract puts a marker on it (the game gives mission sites one while you have the job)."""
        out, texts = {}, None
        for n in dict.fromkeys(names):
            loc = self._db.locations.get(n)
            if not loc or loc.qt or classify(loc.name, loc.category) in ("om", "station", "city", "lpoint", "jump"):
                continue
            if texts is None:
                texts = [" ".join([c.name] + [o.text for o in c.objectives]).lower()
                         for c in self._tracker.contracts.values() if c.status == "active"]
            if any(n.lower() in tx for tx in texts):
                out[n] = {"contract": True}
                continue
            g = self._db.guidance(loc, p, psys, t)
            a0 = (g.get("approach") or [None])[0]
            if a0 and min(x for x in (a0.get("straight"), a0.get("ground"), 1e9) if x is not None) < 250:
                continue                                 # a marker right on it (the same place listed twice)
            out[n] = {"approach": [{k: a.get(k) for k in ("name", "ground", "straight", "heading", "orbit")}
                                   for a in g.get("approach", [])[:2]],
                      "closer": g.get("ground") is not None and bool(g.get("approach")) and g["ground"] < g["approach"][0]["ground"]}
            try:                                         # over its planet or moon already: from where you are now
                here = self._nav_from_here(loc, time.time())
                if here:
                    out[n]["here"] = here
            except Exception as e:
                print("nav from here:", e, flush=True)
        return out

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
    def save_waypoint(self, name, notes="", pinned=True, pad="unknown", icon=""):
        with self._lock:
            name = (name or "").strip()
            if not name:
                return {"ok": False, "error": "Give the waypoint a name"}
            if not self._player:
                return {"ok": False, "error": "No position yet. Type /showlocation in game chat first"}
            loc = self._db.capture(name, self._player, self._player_t, self._player_sys, pad, notes, pinned,
                                   str(icon or "")[:80])
            self._db_changed()
            return {"ok": True, "name": loc.name, "body": loc.body}

    # ---- coordinates typed into the map's search
    # Either the game's own /showlocation numbers ("x:-18930539540 y:-2610158765 z:0", "-18930539540, -2610158765, 0":
    # meters from the system's star, the same frame Quantum reads from the clipboard), or a spot on a planet or moon
    # by latitude and longitude ("Daymar 12.5, -40.2", "Hurston lat 10 lon -20"), at ground level.
    _COORD_NUM = r"(-?\d[\d,]*(?:\.\d+)?(?:[eE][-+]?\d+)?|-?\.\d+)"

    def _parse_coords(self, text, system=None):
        text = str(text or "").strip()
        if not text:
            return None
        xyz = nav_core.parse_showlocation(text) or gamelog.text_coords(text)
        if not xyz:
            nums = re.findall(self._COORD_NUM, text)
            rest = re.sub(self._COORD_NUM, " ", text)
            # three bare numbers and nothing else ("1.2e10 -3.4e9 50267"); big enough to be in space
            if len(nums) == 3 and not re.search(r"[a-z]", rest, re.I):
                try:
                    v = [float(n.replace(",", "")) for n in nums]
                except ValueError:
                    v = None
                if v and math.sqrt(sum(a * a for a in v)) > 1e6:
                    xyz = v
        if xyz:
            pos = tuple(float(a) for a in xyz)
            sys_ = self._db.guess_system(pos, system if system in SYSTEMS else None)
            return {"pos": pos, "system": sys_, "how": "xyz"}
        # A planet or moon's name, then latitude and longitude
        m = re.match(r"^\s*(.+?)\s*[:,]?\s*(?:lat(?:itude)?\s*[:=]?\s*)?" + self._COORD_NUM
                     + r"\s*°?\s*[NS]?\s*[,;/ ]\s*(?:lon(?:g|gitude)?\s*[:=]?\s*)?" + self._COORD_NUM + r"\s*°?\s*[EW]?\s*$",
                     text, re.I)
        if not m:
            return None
        key = re.sub(r"[^a-z0-9]", "", m.group(1).lower())
        b = next((b for b in self._db.bodies.values() if b.kind != "star" and b.radius_m > 0
                  and re.sub(r"[^a-z0-9]", "", b.name.lower()) == key
                  and (not system or b.system == system)), None) or \
            next((b for b in self._db.bodies.values() if b.kind != "star" and b.radius_m > 0
                  and re.sub(r"[^a-z0-9]", "", b.name.lower()) == key), None)
        if not b:
            return None
        try:
            lat, lon = float(m.group(2).replace(",", "")), float(m.group(3).replace(",", ""))
        except ValueError:
            return None
        if not (-90 <= lat <= 90 and -180 <= lon <= 180):
            return None
        la, lo, r = math.radians(lat), math.radians(lon), b.radius_m
        local = (-r * math.cos(la) * math.sin(lo), r * math.cos(la) * math.cos(lo), r * math.sin(la))
        return {"pos": b.to_global(local, time.time()), "system": b.system, "how": "latlon", "body": b.name,
                "lat": lat, "lon": lon}

    def coords_find(self, text, system=None):
        """What typed coordinates point at: {ok, system, body, lat, lon, alt, nearest: [{name, dist}], label}
        or {ok: False} when the text isn't coordinates."""
        with self._lock:
            c = self._parse_coords(text, system)
            if not c:
                return {"ok": False}
            t = time.time()
            pos, sys_ = c["pos"], c["system"]
            b = self._db.bodies.get(c.get("body")) if c.get("body") else self._db.body_near(pos, sys_)
            out = {"ok": True, "system": sys_, "body": b.name if b else None, "how": c["how"]}
            if b:
                lat, lon, alt = b.lat_lon_alt(b.to_local(pos, t))
                out.update(lat=round(lat, 4), lon=round(lon, 4), alt=round(alt))
            near = []
            for n, L in self._db.locations.items():
                if L.system != sys_ or L.source not in ("db", "user") or L.category in ("om",):
                    continue
                try:
                    d = dist(self._db.global_pos(L, t), pos)
                except Exception:
                    continue
                near.append((d, n))
            near.sort()
            out["nearest"] = [{"name": n, "dist": d} for d, n in near[:3]]
            where = b.name if b else f"space ({sys_})"
            out["label"] = f"Coordinates near {near[0][1]}" if near and near[0][0] < 50_000 else f"Coordinates on {where}" if b else f"Coordinates in {sys_}"
            return out

    def coords_save(self, text, system=None, name=None):
        """Put typed coordinates on the map as one of your waypoints (so the map shows it, and it can go in
        your route): {ok, name, body}."""
        with self._lock:
            c = self._parse_coords(text, system)
            if not c:
                return {"ok": False, "error": "Those don't look like coordinates"}
            name = (name or "").strip() or "Coordinates"
            loc = self._db.capture(name, c["pos"], time.time(), c["system"], "unknown",
                                   f"From coordinates you typed: {str(text).strip()[:120]}", True)
            self._db_changed()
            return {"ok": True, "name": loc.name, "body": loc.body, "system": c["system"]}

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

    # ------------------------------------------------------------ places named by the wiki
    def _named_place(self, name, system=None):
        """A wiki place name -> (place you can add to the route or None, planet or moon or None). A planet
        or moon is reached at its orbital marker (OM-1)."""
        if not name:
            return None, None
        k = re.sub(r"[^a-z0-9]", "", str(name).lower())
        idx = getattr(self, "_name_idx", None)
        if idx is None or getattr(self, "_name_idx_n", 0) != len(self._db.locations):
            idx = {}
            for n, L in self._db.locations.items():
                idx.setdefault((re.sub(r"[^a-z0-9]", "", n.lower()), L.system), n)
                idx.setdefault((re.sub(r"[^a-z0-9]", "", n.lower()), None), n)
            self._name_idx, self._name_idx_n = idx, len(self._db.locations)
        body = next((b.name for b in self._db.bodies.values() if b.kind != "star"
                     and re.sub(r"[^a-z0-9]", "", b.name.lower()) == k and (not system or b.system == system)), None)
        if body:
            om = f"OM-1 ({body})"
            return (om if om in self._db.locations else None), body
        place = idx.get((k, system)) or idx.get((k, None)) or idx.get((k + "station", system))
        if not place:
            # Pyro's Lagrange points: the wiki says "PYR6 L2", the map data "P6-L2"
            m = re.fullmatch(r"pyr(\d)(l\d)", k)
            if m:
                place = idx.get((f"p{m.group(1)}{m.group(2)}", None))
        return place, None

    def _place_rows(self, group):
        """{"names", "more"} from the mission summary -> [{name, place, body}]"""
        out = []
        for n in (group or {}).get("names") or []:
            p, b = self._named_place(n)
            out.append({"name": n, "place": p, "body": b})
        return out

    def mission_page(self, ref=None, code=None, title=None):
        """A mission's own page in Quantum (opened from a blueprint's How you get it): payout, reputation,
        briefing, where it's offered and where it sends you (as places you can add to the route), what it
        needs first and the blueprints it can give."""
        try:
            info = self._missions.page(ref, code, title)
        except Exception:
            return {"ok": False, "error": "The Star Citizen Wiki couldn't be reached. Try again in a minute"}
        if not info:
            return {"ok": True, "found": False}
        info = dict(info)
        info["title"] = self._mission_vars(info.get("title"), info)
        info["description"] = self._mission_vars(info.get("description"), info, below=True)
        for k in ("offered_at", "pickups", "destinations"):
            info[k + "_rows"] = self._place_rows(info.get(k))
        bps = {}
        try:
            for b in (self._gear.items("blueprints").get("items") or []):
                if b.get("out_uuid"):
                    bps[str(b["out_uuid"]).lower()] = b.get("uuid")
                bps.setdefault("name:" + (b.get("name") or "").lower(), b.get("uuid"))
        except Exception:
            pass
        for i in info.get("blueprint_items") or []:
            i["bp"] = bps.get(str(i.get("uuid") or "").lower()) or bps.get("name:" + (i.get("name") or "").lower())
        return {"ok": True, "found": True, "info": info}

    # ------------------------------------------------------------ the Missions tab: employers and factions
    def missions_index(self, fresh=False):
        """Who gives out contracts and what they offer, from Quantum's own game data (contracts_data.json),
        or the Star Citizen Wiki's list while that isn't on this PC: {ok, source, employers: [{name, faction,
        count, types, lawful, unlawful, reward: [min, max], ranks, missions: [...]}]}."""
        rows, source = [], "game"
        c = getattr(self._files, "contracts", None)
        for uid, m in ((c.items if c else {}) or {}).items():
            rep = [r for r in m.get("rep") or [] if r.get("amount")]
            rows.append({"title": m.get("title"), "giver": m.get("giver"), "faction": rep[0].get("faction") if rep else None,
                         "type": m.get("type"), "reward": m.get("reward"), "reward_max": m.get("reward_max") or m.get("reward"),
                         "currency": m.get("currency"), "lawful": m.get("lawful") is not False, "rank": m.get("rank"),
                         "rep": rep[0].get("amount") if rep else None, "code": m.get("class_name") or m.get("debug_name"),
                         "ref": None, "desc": (m.get("description") or "")[:600] or None,
                         "cargo": [o.get("resource") for o in m.get("cargo") or [] if o.get("resource")][:4],
                         "max_players": m.get("max_players")})
        if not rows:
            source = "wiki"
            try:
                rows = self._missions.wiki_index()
            except Exception:
                return {"ok": False, "error": "Quantum's mission data isn't on this PC yet and the Star Citizen Wiki couldn't be reached. Try again in a minute"}
        emp = {}
        for m in rows:
            title = self._mission_title(m.get("title"), m) if m.get("title") else None
            if not title:
                continue
            name, note = self._mission_giver(m)
            e = emp.setdefault(name.lower(), {"name": name, "factions": {}, "types": {}, "lawful": 0, "unlawful": 0,
                                              "reward": [None, None], "missions": [], "seen": set(), "note": None})
            e["note"] = e["note"] or note
            k = (title.lower(), m.get("type"), m.get("reward_max"))
            if k in e["seen"]:                        # the same contract per system or per tier: once is enough
                continue
            e["seen"].add(k)
            if m.get("faction"):
                e["factions"][m["faction"]] = e["factions"].get(m["faction"], 0) + 1
            if m.get("type"):
                e["types"][m["type"]] = e["types"].get(m["type"], 0) + 1
            e["lawful" if m.get("lawful", True) else "unlawful"] += 1
            for v in (m.get("reward"), m.get("reward_max")):
                if isinstance(v, (int, float)) and v > 0:
                    e["reward"][0] = v if e["reward"][0] is None else min(e["reward"][0], v)
                    e["reward"][1] = v if e["reward"][1] is None else max(e["reward"][1], v)
            e["missions"].append(dict(m, title=title, raw_title=m.get("title")))
        out = []
        for e in emp.values():
            e.pop("seen")
            facs = sorted(e.pop("factions").items(), key=lambda x: -x[1])
            e["faction"] = facs[0][0] if facs else None
            e["types"] = [t for t, _ in sorted(e["types"].items(), key=lambda x: -x[1])]
            e["count"] = len(e["missions"])
            e["missions"].sort(key=lambda m: ((m.get("rank") if isinstance(m.get("rank"), (int, float)) else 0), m.get("reward_max") or 0, m["title"]))
            out.append(e)
        out.sort(key=lambda e: (-e["count"], e["name"].lower()))
        return {"ok": True, "source": source, "at": getattr(c, "at", None) if source == "game" else None, "employers": out}

    # The game fills some contract givers in only when the contract is offered: "~mission(Contractor|BountyFrom)"
    # is whoever posted the bounty, "~mission(Contractor)" the local contractor. Those are listed under the
    # faction the contract gives reputation with (what the game files do say), else under a plain description.
    RE_GIVER_VAR = re.compile(r"~mission\(([^)]*)\)|\[([A-Za-z][A-Za-z0-9_ |]{1,40})\]")

    def _mission_giver(self, m):
        """A contract's employer for the Missions list -> (name, note or None)."""
        raw = str(m.get("giver") or "").strip()
        fac = str(m.get("faction") or "").strip()
        if raw and not self.RE_GIVER_VAR.search(raw):
            return raw, None
        if not raw:
            return (fac or "Unknown employer"), None
        vars_ = " ".join((a or b or "") for a, b in self.RE_GIVER_VAR.findall(raw)).lower()
        bounty = "bounty" in vars_ or str(m.get("type") or "").lower().startswith("bount")
        rest = self.RE_GIVER_VAR.sub("", raw).strip(" -|:,")         # any words around the gap ("Bounty: ~mission(...)")
        if fac and not self.RE_GIVER_VAR.search(fac):
            name = f"{fac} bounties" if bounty and "bount" not in fac.lower() else fac
            note = ("Bounties posted on behalf of " if bounty else "Contracts given on behalf of ") + fac \
                + ". The game names the contractor when you're offered the contract."
            return name, note
        if rest:
            return rest, "The game names the contractor when you're offered the contract."
        return ("Bounty issuers" if bounty else "Local contractors"), \
            ("Whoever posted the bounty" if bounty else "The contractor") + " is named by the game when you're offered the contract."

    RE_RANK_VAR = re.compile(r"rank|reputation|standing|tier", re.I)

    def _mission_title(self, text, m=None):
        """A contract's title for the Missions list: the gaps the game fills in are left out or filled with
        what's known ("~mission(ReputationRank) Rank - Direct ~mission(Cargo) Cargo Haul" -> "Member Rank -
        Direct Cargo Haul"), instead of spelled out ("the reputation rank named in the contract Rank…"). The
        briefing keeps the spelled-out version."""
        if not text or not self.RE_MISSION_VAR.search(text):
            return text
        m = m or {}
        rank = m.get("rank") if isinstance(m.get("rank"), str) and m.get("rank").strip() else None

        def sub(mm):
            k = (mm.group(1) or mm.group(2) or "")
            if self.RE_RANK_VAR.search(k):
                return rank or ""
            kk = re.sub(r"[^a-z]", "", k.lower())
            if re.search(r"target|bounty|criminal|person|npc|boss", kk) and not re.search(r"loc|place|ship|from", kk):
                return "a wanted target"
            if re.search(r"ship|vehicle", kk):
                return "a target ship"
            if re.search(r"location|destination|place|site|outpost|planet|moon|system|area|poi|loc", kk):
                filled = self._mission_vars(mm.group(0), m)            # a place only when there's just one
                return "" if "named in the contract" in filled or filled.startswith("one of") else filled
            return ""
        out = self.RE_MISSION_VAR.sub(sub, text)
        out = re.sub(r"\s+", " ", out)
        out = re.sub(r"\s+([,.:;!?])", r"\1", out)
        out = re.sub(r"(^|\s)(-|–|:|\|)\s*(?=\s*(-|–|:|\||$))", " ", out)       # a dash left with nothing beside it
        out = re.sub(r"^\s*(Rank)\s*[-–:]\s*", "", out) if not rank else out     # "Rank - Direct…" with no rank to name
        out = out.strip(" -–:|,")
        out = re.sub(r"\s+(?:to|at|from|in|on|for|the|of|near|with|a|an)$", "", out, flags=re.I)   # "Deliver to" a gap
        out = re.sub(r"\s{2,}", " ", out)
        return out if len(re.sub(r"[^A-Za-z]", "", out)) >= 4 else self._mission_vars(text, m)

    def faction_info(self, name):
        """The wiki's page on a faction: overview, description and reputation ranks."""
        if not name:
            return {"ok": True, "found": False}
        try:
            f = self._missions.faction(name)
        except Exception:
            return {"ok": False, "error": "The Star Citizen Wiki couldn't be reached. Try again in a minute"}
        return {"ok": True, "found": bool(f), "faction": f}

    def commodity_sources(self, name):
        """Where a commodity is mined or harvested (Star Citizen Wiki), each place matched to the map:
        {ok, found, from, sources: [{name, system, type, methods, chance, quality, place, body}]}."""
        try:
            r = self._gear.commodity_sources(name)
        except Exception:
            return {"ok": False, "error": "The Star Citizen Wiki couldn't be reached"}
        if not r or not r.get("sources"):
            return {"ok": True, "found": False}
        rows = []
        for x in r["sources"]:
            p, b = self._named_place(x["name"], x.get("system"))
            if not p and not b and x.get("parent"):               # an asteroid field or cave by its planet
                p, b = self._named_place(x["parent"], x.get("system"))
            row = dict(x, place=p, body=b)
            # The wiki says "Stanton System"; the map and the panel say "Stanton" (and "near Stanton" says nothing)
            sys_ = re.sub(r"\s+System$", "", str(x.get("system") or "")) or None
            row["system"] = sys_
            if row.get("parent") and re.sub(r"\s+System$", "", str(row["parent"])) == sys_:
                row["parent"] = None
            # "HUR L2" is the asteroid field in the Lagrange point, not the station there (HUR-L2 Faithful Dream
            # Station): say so, so the two aren't mixed up
            L = self._db.locations.get(p) if p else None
            if L is not None and getattr(L, "category", "") == "lpoint":
                row["display"] = f"{p} asteroid field"
                row["type"] = "Lagrange point asteroids"
            rows.append(row)
        return {"ok": True, "found": True, "from": r.get("from"), "sources": rows, "web_url": r.get("web_url")}

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
        if (kind.startswith("auto-") or kind == "manual") and self._on_live():   # a new LIVE alignment
            build = self._game_build()       # the checked LIVE build (never a PTU build still held over)
            if build:                        # aligned by you in this game build: datarunners' agreed one doesn't replace it
                self._settings.setdefault("cal_build", {})[body] = str(build)
                self._save_settings()
            self._share_alignment(body, place, kind)

    def _share_alignment(self, body_name, place, kind):
        """Send a new alignment to the Quantum server for this game build. Once another datarunner's
        alignment of the same body in the same build agrees, it earns points toward your rank (the first
        alignments after a game update are the useful ones)."""
        b = self._db.bodies.get(body_name)
        build = self._game_build() if self._on_live() else ""
        if not b or not build:
            return
        # Kept in settings until the server has it (like shared station positions): an alignment made
        # while the server is down, or before you've signed in, is sent with the next map sync instead
        # of being lost. A newer alignment of the same body replaces the waiting one.
        entry = {"body": b.name, "system": b.system, "build": str(build),
                 "offset": round(b.rotation_offset_deg, 6), "period": b.rotation_period_h, "epoch": b.epoch_utc,
                 "place": place, "quality": b.calibration_quality or kind}
        self._settings.setdefault("align_unsent", {})[b.name] = entry
        self._save_settings()
        self._send_alignment(entry)

    def _send_alignment(self, entry):
        user = self._dr_cfg().get("username") or (self._dr_cfg().get("uex_user") or {}).get("username")
        if not user or not self._community.url:
            return                                          # sent once you've signed in

        def done(answered):
            waiting = self._settings.get("align_unsent") or {}
            if answered and waiting.get(entry["body"]) is entry:
                waiting.pop(entry["body"], None)
                self._save_settings()
        self._community.post_alignment(dict(entry, username=user.lower()), on_done=done)

    def _resend_alignments(self):
        """Alignments the server hasn't got yet: only this game build's (an older one is no use to anyone)."""
        build = self._game_build()
        waiting = self._settings.get("align_unsent") or {}
        stale = [k for k, e in waiting.items() if str(e.get("build")) != str(build)] if build else []
        for k in stale:
            waiting.pop(k, None)
        if stale:
            self._save_settings()
        for e in list(waiting.values()):
            if self._community.align_results.get(e["body"], {}).get("state") != "sending":
                self._send_alignment(e)

    def calibration_status(self):
        """Per body: aligned or community values, and what the checks say about drift."""
        with self._lock:
            hist = self._cal_file().get("history", [])
            out = []
            unreleased = self._unreleased_bodies()
            # Lined up for THIS game build? The same test the Data > Jobs alignment list uses (agreed on the server
            # for this build, or lined up by you in it), so Settings and Jobs never disagree. The page reads
            # aligned_now; without it every body ever aligned (an older build, or the shipped map data) showed a
            # tick here while Jobs still listed it as needing alignment.
            build = str(self._game_build() or "")
            srv = getattr(self, "_align_server", None) or {}
            agreed = srv.get("agreed") or {} if str(srv.get("build")) == build else None
            mine_build = {n for n, v in (self._settings.get("cal_build") or {}).items() if str(v) == build}
            mine_build |= {e["body"] for e in hist if str(e.get("build")) == build
                           and (str(e.get("kind", "")).startswith("auto-") or e.get("kind") == "manual")}
            for b in sorted(self._db.bodies.values(), key=lambda b: (b.system, b.kind != "planet", b.name)):
                if not can_align(b) or b.name in unreleased:     # stars, asteroids, unlandable, not on LIVE yet
                    continue
                h = [e for e in hist if e["body"] == b.name]
                checks = [e for e in h if e["kind"] == "check"]
                out.append({"name": b.name, "system": b.system, "kind": b.kind, "calibrated": b.calibrated,
                            "resettable": b.community_offset_deg is not None, "quality": b.calibration_quality,
                            "at": b.calibrated_at, "place": b.calibrated_place, "events": len(h),
                            "checks": len(checks), "sessions": len({e["session"] for e in h if e["session"]}),
                            "worst_check": max((abs(e["residual_deg"]) for e in checks), default=None),
                            "last": h[-1] if h else None,
                            "aligned_now": (None if not build or (agreed is None and b.name not in mine_build)
                                            else b.name in mine_build or b.name in (agreed or {}))})
            return {"bodies": out, "build": self._tracker.build, "version": self._game_version_label(self._tracker.build),
                    "file": str(CAL_PATH)}

    @staticmethod
    def _ver(v):
        """(major, minor) of a game version like "5.0.200.12681" or "4.3.2 LIVE"; None when there's none."""
        m = re.match(r"\s*(\d+)\.(\d+)", str(v or ""))
        return (int(m.group(1)), int(m.group(2))) if m else None

    def _unreleased_bodies(self):
        """{body: "Alpha 5.0"} for planets and moons Quantum built from a test channel (PTU, EPTU...) that the
        LIVE game doesn't have yet: kept off alignment until LIVE reaches that version (playing the PTU
        doesn't count: it only shows once it's in LIVE)."""
        builds = (getattr(self, "_game_bodies", None) or {}).get("builds") or {}
        out = {}
        live = None
        for name, b in builds.items():
            ch, need = str(b.get("channel") or "").upper(), self._ver(b.get("Version") or b.get("Branch", "").replace("sc-alpha-", ""))
            if not ch or ch == "LIVE" or not need or name not in self._db.bodies:
                continue
            # No network and no waiting here (this runs while the map's data is put together): the Game.log's
            # own header, the label kept for the last LIVE build, and UEX's version list as last cached
            try:
                if live is None:
                    last = str(self._settings.get("last_build") or "")
                    labels = self._settings.get("build_labels") or {}
                    lab = labels.get(last) or ""
                    live = (self._ver(lab) if "LIVE" in lab.upper() or not any(c in lab.upper() for c in ("PTU", "EPTU", "TECH", "HOTFIX")) else None) \
                        or (self._logged_version() if self._game_env() == "LIVE" else None) or self._uex_live_version() or ()
            except Exception:
                live = live or ()
            if live and live >= need:
                continue
            out[name] = f"Alpha {need[0]}.{need[1]}"
        return out

    def _logged_version(self):
        """(major, minor) from the Game.log being read (its Branch line), without asking UEX."""
        try:
            with open(self._tracker.log_path or "", "r", encoding="utf-8", errors="replace") as fh:
                head = fh.read(200_000)
        except (OSError, TypeError):
            return None
        m = re.search(r"Branch:\s*sc-alpha-(\d+\.\d+)", head) or re.search(r"(?:File|Product)Version:\s*(\d+\.\d+)\.", head)
        return self._ver(m.group(1)) if m else None

    def _uex_live_version(self):
        try:
            rows, _ = self._uex.get("game_versions", offline=True)
            return self._ver((rows[0] if rows else {}).get("live"))
        except Exception:
            return None

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
