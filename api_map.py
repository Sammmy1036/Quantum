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
            fix_orig = getattr(self, "_fix_orig", {})
            fix_mine = {n for n, e in gateways.load_learned(PLACES_PATH).items() if e.get("fix")}
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
                    "travel": self._travel_view(cur, t) if game_on else None,
                    "arrived": self._arrived_note if game_on else None, "game_off": not game_on,
                    "play": self._play_tick(game_on, t),
                    "trade_ver": getattr(self, "_trade_changed", 0)}
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
                                  "back": getattr(self, "_server_back_at", None)}
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
            rows.append(dict(x, place=p, body=b))
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
            if self._tracker.build:          # aligned by you in this game build: datarunners' agreed one doesn't replace it
                self._settings.setdefault("cal_build", {})[body] = str(self._tracker.build)
                self._save_settings()
            self._share_alignment(body, place, kind)

    def _share_alignment(self, body_name, place, kind):
        """Send a new alignment to the Quantum server for this game build. Once another datarunner's
        alignment of the same body in the same build agrees, it earns points toward your rank (the first
        alignments after a game update are the useful ones)."""
        b = self._db.bodies.get(body_name)
        if not b or not self._tracker.build:
            return
        # Kept in settings until the server has it (like shared station positions): an alignment made
        # while the server is down, or before you've signed in, is sent with the next map sync instead
        # of being lost. A newer alignment of the same body replaces the waiting one.
        entry = {"body": b.name, "system": b.system, "build": str(self._tracker.build),
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
            return {"bodies": out, "build": self._tracker.build, "version": self._game_version_label(self._tracker.build),
                    "file": str(CAL_PATH)}

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
