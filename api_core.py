"""Api, part of: Settings, the game log, saving and the other plumbing every part of Quantum leans on.

A mixin of app.py's Api (class Api(... CoreMixin ...)): the methods are the Api's, `self` is the one Api.
Module-level names come from qbase.py."""
from qbase import *  # noqa: F401,F403


class CoreMixin:
    # ------------------------------------------------------------ internals
    def _load_settings(self):
        """settings.json ({} the first time). One Quantum can't read (a typo after editing it by hand, say)
        is never overwritten: it's kept as settings.unreadable-<time>.json, Quantum carries on from the last
        good copy (settings.json.bak) if there is one, and says so once (live["settings_note"])."""
        self._settings_note = None
        if not SETTINGS_PATH.exists():
            return {}
        try:
            # utf-8-sig: Notepad's "UTF-8 with BOM" reads fine too
            text = SETTINGS_PATH.read_text(encoding="utf-8-sig")
            data = json.loads(text)
            if not isinstance(data, dict):
                raise ValueError("not a JSON object")
        except Exception as e:
            kept = SETTINGS_PATH.with_name(f"settings.unreadable-{time.strftime('%Y%m%d-%H%M%S')}.json")
            try:
                SETTINGS_PATH.replace(kept)
            except OSError:
                kept = None
            watcher_mod.log_error(f"settings.json couldn't be read ({e}); kept as {kept}")
            data = {}
            try:
                data = json.loads(SETTINGS_BAK.read_text(encoding="utf-8-sig"))
                if not isinstance(data, dict):
                    data = {}
            except (OSError, ValueError):
                pass
            where = f" It's kept as {kept.name} next to Quantum.exe." if kept else ""
            self._settings_note = (("settings.json couldn't be read, so Quantum went back to your last good settings."
                                    if data else "settings.json couldn't be read, so Quantum started with default settings.")
                                   + where)
            return data
        try:
            SETTINGS_BAK.write_text(text, encoding="utf-8")
        except OSError:
            pass
        return data

    def _save_settings(self):
        try:
            self._fleet_web_check()           # My Fleet or a gear loadout changed: the website's copy follows
        except Exception:
            pass
        self._settings.update(route_tasks=self._route, guide=self._guide)
        self._settings.pop("route", None)
        out = self._settings
        if self._keys_in_account():
            # Your Quantum account keeps your UEX keys: they're only held in memory here, never written to
            # settings.json. Quantum gets them from the account each time it starts (_load_account_keys).
            out = dict(out)
            out.pop("uex_token", None)
            dr = dict(out.get("datarunner") or {})
            dr.pop("secret", None)
            out["datarunner"] = dr
        text = json.dumps(out, indent=1)
        # Written to a temporary file first, then swapped in, so a crash or a full disk mid-write can't
        # leave a half-written settings.json behind.
        tmp = SETTINGS_PATH.with_name(f"settings.json.{os.getpid()}.{threading.get_ident()}.tmp")
        try:
            tmp.write_text(text, encoding="utf-8")
            os.replace(tmp, SETTINGS_PATH)
        except OSError:
            try:
                tmp.unlink()
            except OSError:
                pass
            SETTINGS_PATH.write_text(text, encoding="utf-8")       # e.g. the file is briefly locked

    def _keys_in_account(self):
        a = self._settings.get("account") or {}
        return bool(a.get("token") and a.get("keys_stored"))

    def _load_account_keys(self):
        """At start (and when the server is back): the UEX keys from your Quantum account, when it keeps them
        and they aren't here yet."""
        if self._keys_in_account() and not self._uex.token and self._account_token():
            self._account()["keys_at"] = 0                  # ask for them, whatever this PC saw last
            self._account_refresh()

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
            # A wormhole/gateway the log mentioned since it last named the system: only then may a
            # planet zone in another system outvote the log (the systems share coordinates).
            tr, w_at = self._tracker, (self._tracker.where or {}).get("at") or 0
            gate_seen = any(ev and (ev.get("at") or 0) >= w_at - 60 for ev in (tr.tunnel, tr.last_gate))
            self._player_sys = self._db.guess_system(pos, hint, gate_seen)
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
        The log names the far gateway station as you come out of a wormhole (RR_JP_PyroStanton) and the
        next quantum route's start ("Stanton Gateway"); these cover the times neither shows up."""
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
        # A quantum jump never changes system: if one was made since the last place the log named, the
        # system it started from (or the place it went to) beats the log's hint, which can be stale or
        # come from a contract/shop line naming another system. Without this a /showlocation after a
        # jump to an unlearned spot (Baijini Point, say) could land in the wrong system and vanish
        # from the map.
        q = self._tracker.qt or {}
        if q.get("selected") and q["selected"] >= (w.get("at") or 0):
            qsys = None
            dest = q.get("place")
            if dest and dest in self._db.locations:
                qsys = self._db.locations[dest].system
            elif q.get("start_body") and q["start_body"] in self._db.bodies:
                qsys = self._db.bodies[q["start_body"]].system
            elif q.get("start_system") in nav_core.SYSTEMS:
                qsys = q["start_system"]                   # "Projected Start Location is Stanton Gateway" etc.
            elif last and 0 < t - last[1] < 3 * 3600 and (q.get("selected") or 0) > last[1] and \
                    not (hint in nav_core.SYSTEMS and hint != last[2] and (w.get("at") or 0) > last[1]):
                # Your last reading's system, unless the log has named another one since (you went
                # through a gateway after that reading: the reading's system is the one you left).
                qsys = last[2]
            # A route starting at "Pyro Gateway" can't start in Pyro (a Gateway is named after where it
            # leads): the reading's system there is the one you just left through the wormhole.
            away = self._tracker.gate_to(q.get("start"))
            if away and (qsys == away or hint == away):
                # Which of the other systems: the one whose Gateway back to `away` you're next to
                near = sorted((dist(L.pos, pos), L.system) for L in self._db.locations.values()
                              if L.pos and L.kind != "surface" and L.system != away
                              and self._tracker.gate_to(L.name) == away)
                there = near[0][1] if near and near[0][0] < 5_000_000 else None
                if qsys == away:
                    qsys = there
                if hint == away:
                    hint = there
            if qsys in nav_core.SYSTEMS and qsys != hint:
                self._sys_how = ("log", "quantum jump", q["selected"])
                return qsys
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
        if not self._on_live():          # PTU/EPTU readings never move the LIVE alignments
            return
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
        try:                    # stations UEX just added at their Lagrange point: the game files' spot instead
            moved = starmap_import.apply_positions(self._db, getattr(self, "_station_pos", None), keep=self._learned_places())
            if starmap_import.apply_extra(self._db, getattr(self, "_snap", None), keep=self._learned_places()) or moved:
                for name in [n for n in self._unplaced if n in self._db.locations]:
                    self._unplaced.pop(name, None)       # on the map from the game files now
        except Exception:
            watcher_mod.log_error("starmap extra")
        self._apply_place_fixes()
        self._db.save()
        self._uex.forget_places()
        return renamed

    # ---- corrected positions for places already on the map
    # Any place on the map can be reported as in the wrong spot: go there, /showlocation, "Send the right
    # position". Your own reading moves it on your map at once; the Quantum server makes it everyone's
    # once a second datarunner's reading agrees (a trusted datarunner's, or the admin's, counts straight
    # away). Gateways, Wikelo and UEX-only places have their own flow (set_place_here) and aren't touched.
    FIX_NEAR_SURFACE_M = 100_000          # a correction this far from the marker is a reading somewhere else
    FIX_NEAR_SPACE_M = 5_000_000

    def _fixable(self, name):
        L = self._db.locations.get(name)
        return bool(L and L.source == "db" and L.pos is not None and not gateways.system_of(name)
                    and name not in getattr(self, "_uex_pending", {}) and not name.startswith(gateways.JUMP_PREFIX)
                    and L.category not in ("lpoint", "om", "jump"))

    def _apply_place_fixes(self):
        """Put corrected positions (yours, and the ones datarunners agree on) on the map, and put back the
        original spot of any place whose correction is gone (withdrawn)."""
        orig = getattr(self, "_fix_orig", None)
        if orig is None:
            orig = self._fix_orig = {}
        learned = self._learned_places()
        for name, (kind, pos, body) in list(orig.items()):
            if name not in learned and name in self._db.locations:
                L = self._db.locations[name]
                L.kind, L.pos, L.body = kind, pos, body
                L.notes = L.notes.split(" · Position corrected")[0]
                orig.pop(name)
        for name, e in learned.items():
            if not self._fixable(name) and name not in orig:
                continue
            L = self._db.locations.get(name)
            if L is None or e.get("system") != L.system:
                continue
            if e.get("local") and e.get("body") in self._db.bodies:
                kind, pos, body = "surface", tuple(learned_local(self._db, e)), e["body"]
            elif e.get("pos"):
                kind, pos, body = "space", tuple(e["pos"]), None
            else:
                continue
            orig.setdefault(name, (L.kind, L.pos, L.body))
            L.kind, L.pos, L.body = kind, pos, body
            if " · Position corrected" not in L.notes:
                who = "Quantum datarunners'" if e.get("community") else "your"
                L.notes = (L.notes or "").rstrip() + f" · Position corrected from {who} /showlocation"

    def report_position(self, name):
        """This place is in the wrong spot on the map: your last /showlocation, taken there, is its real
        position. Sent to the Quantum server, where it counts for everyone once a second datarunner's
        reading agrees (or straight away from a trusted datarunner)."""
        with self._lock:
            if not self._fixable(name) and name not in getattr(self, "_fix_orig", {}):
                return {"ok": False, "error": "This place's position can't be corrected this way"}
            L = self._db.locations[name]
            if not self._player or time.time() - self._player_t > 900:
                return {"ok": False, "error": f"Type /showlocation in game chat while you're at {name}"}
            if self._player_sys != L.system:
                return {"ok": False, "error": f"Your last reading is in {self._player_sys}, not {L.system}"}
            places = gateways.load_learned(PLACES_PATH)
            orig = getattr(self, "_fix_orig", {}).get(name)
            kind, opos, obody = orig or (L.kind, L.pos, L.body)
            now = time.time()
            if kind == "surface" and obody:
                b = self._db.bodies.get(obody)
                near = self._db.body_near(self._player, L.system)
                if not b or not near or near.name != b.name:
                    return {"ok": False, "error": f"That reading isn't on {obody}. Take it while you're at {name}"}
                local = b.to_local(self._player, self._player_t)
                off = dist(local, opos)
                if off > self.FIX_NEAR_SURFACE_M:
                    return {"ok": False, "error": f"That reading is {off / 1000:.0f} km from where {name} is on the map. "
                                                  "Take it at the place itself (a fix can move it up to 100 km)"}
                places[name] = {"system": L.system, "body": b.name, "local": list(local), "fix": True,
                                "offset": b.rotation_offset_deg, "reading": {"pos": list(self._player), "t": self._player_t},
                                "at": now}
            else:
                off = dist(self._player, opos)
                if off > self.FIX_NEAR_SPACE_M:
                    return {"ok": False, "error": f"That reading is {off / 1000:,.0f} km from where {name} is on the map. "
                                                  "Take it while docked there"}
                places[name] = {"system": L.system, "pos": list(self._player), "fix": True, "at": now}
            PLACES_PATH.write_text(json.dumps({"places": places}, indent=1), encoding="utf-8")
            self._share_place(name)
            self._apply_place_fixes()
            self._db.save()
            self._db_changed()
            return {"ok": True, "name": name, "moved_km": round(off / 1000, 2)}

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
        if r.get("status") == "too_many":
            return {"ok": False, "error": f"You have {r.get('max') or 5} jobs on the go. Finish or let go of one first"}
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
        self._backup_soon()
        self._uex.forget_places()
        self._services = self._match_services()
        self._static_version += 1
        self._route = [r for r in self._route if r["place"] in self._db.locations]
        if self._guide not in self._db.locations:
            self._guide = None
        self._tracker.relink()
        self._save_settings()

    def _restore_window(self):
        """Un-minimise through pywebview, so the embedded browser is told it's visible again. pywebview's
        restore() also un-maximises, so a maximised Quantum is put back maximised, where it was."""
        me = place = None
        try:
            me = overlay.user32.FindWindowW(None, overlay.WINDOW_TITLE) if os.name == "nt" else None
            place = overlay.get_placement(me)
        except Exception:
            pass
        try:
            webview.windows[0].restore()
            time.sleep(0.15)
        except Exception:
            pass
        try:
            overlay.put_back(me, place)
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

    def map_covered(self):
        """Is the Quantum window out of sight (minimised, in the tray, or behind the game)? The map
        asks while it isn't focused, and stops drawing until it's seen again."""
        try:
            return bool(overlay.is_covered())
        except Exception:
            return False

    def shutdown(self):
        self._fm_shutdown()                       # off everyone's Friend Map now, not in 5 minutes
        # A waypoint saved just before closing still reaches the server (waits a few seconds at most).
        t = threading.Thread(target=self._backup_quietly, daemon=True)
        t.start()
        t.join(8)
        self._sender.shutdown()
        self._watcher.stop()
        self._tracker.stop()
