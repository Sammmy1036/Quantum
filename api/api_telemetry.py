"""Api, part of: Star Citizen's local game telemetry (game/telemetry.py). On by default; it can be turned off in Settings > Game telemetry.

A mixin of app.py's Api (class Api(... TelemetryMixin ...)): the methods are the Api's, `self` is the one Api.
Module-level names come from qbase.py.

With it on, the live view (get_live's "telemetry") carries your ship's and your character's state straight from the
game, which the page uses for more detail: the ship you're flying with its speed, fuel, shields and warning lights,
your health and oxygen, your aUEC balance (the Cart says whether you can afford it), and being downed or killed the
moment it happens. Everything else still comes from Game.log and /showlocation."""
from qbase import *  # noqa: F401,F403
from game import telemetry as telemetry_mod
from game import session_stats as session_mod
from game import deadreckon


class TelemetryMixin:
    def _tel_start(self):
        """At start-up: the reader thread, switched on only if you turned it on in Settings."""
        self._tel = telemetry_mod.Telemetry(self._settings.get("telemetry_port") or telemetry_mod.DEFAULT_PORT,
                                            on_event=self._tel_event, on_port=self._tel_port_found)
        # the game's ports are only looked at once you've been spawned in for a minute (before, nothing serves it)
        def spawned_a_while():
            tr = getattr(self, "_tracker", None)
            at = tr and tr.in_pu and (tr.spawned_at or tr.pu_at)
            return bool(at) and time.time() - at > 60
        self._tel.may_discover = spawned_a_while
        # session stats and the earnings log, from every frame (game/session_stats.py)
        self._sess = session_mod.SessionStats(HERE / "earnings.json", lambda: getattr(self, "_tracker", None),
                                              ctype_fn=self._contract_type)
        self._tel.on_frame = self._tel_frame
        threading.Thread(target=self._stats_sync_loop, daemon=True, name="stats-sync").start()   # api_jobs.py
        self._tel.start()
        self._tel.set_enabled(bool(self._settings.get("telemetry_on", True)))

    def _tel_frame(self, d, now):
        """Every telemetry frame: session stats, and your estimated position between readings (deadreckon.py)."""
        try:
            self._sess.frame(d, now)
        finally:
            dr, qt = self._dr_objs()
            dr.frame(d, now)
            qt.frame(d, now)

    def _dr_objs(self):
        """The two position estimators. Not self._dr: that name is the datarunner submitter's (app.py)."""
        if getattr(self, "_pos_dr", None) is None:
            self._pos_dr, self._pos_qt = deadreckon.DeadReckoner(), deadreckon.QuantumTrack()
        return self._pos_dr, self._pos_qt

    def _position_estimate(self, info, p, psys, approx, t):
        """For get_live's "player_est": where you probably are now, from telemetry since your last reading.
        Flying over a planet or moon: dead reckoning from that reading. In a quantum jump: along the way to
        its destination. None when there's nothing better than the reading itself."""
        dr, qtk = self._dr_objs()
        q = self._tracker.qt or {}
        jumping = q.get("selected") and not q.get("arrived") and t - q["selected"] < 1800
        if not jumping:
            qtk.end()
        # A new real reading on a planet or moon starts the dead reckoning again from it. So does landing at or taking
        # off from a known place (the log says which, and when): flying out of Lorville is tracked from Lorville.
        spot, spot_at, how = getattr(self, "_spot_now", None) or (None, 0, None)
        if p and not approx and info.get("body") and info.get("local"):
            key, at = (info["t"], info["body"]), info["t"]
        elif p and approx and approx == spot and how in ("landed", "left") and info.get("body") and info.get("local"):
            key, at = ("spot", spot, spot_at), spot_at
        else:
            key = at = None
        if key:
            if getattr(self, "_dr_fix", None) != key:
                self._dr_fix = key
                b = self._db.bodies[info["body"]]
                dr.anchor(b.name, b.radius_m, tuple(info["local"]), at)
        else:
            if dr.body:
                dr.drop()
            self._dr_fix = None
        if jumping and p and psys:
            # from where you were when you started it: the dead-reckoned spot if you'd flown since the reading
            if getattr(qtk, "_j", None) is None or qtk._j.get("key") != q["selected"]:
                e0 = dr.estimate(t)
                start = p
                if e0 and info.get("body") == e0["body"]:
                    start = self._db.bodies[e0["body"]].to_global(e0["local"], t)
                qtk.begin(q["selected"], start, psys)
            L = self._db.locations.get(q.get("place") or "")
            if L is not None and L.system == psys:
                e = qtk.estimate(self._db.global_pos(L, t), t)
                if e:
                    body = self._db.body_near(e["pos"], psys)
                    out = {"how": "qt", "to": L.name, **e, "body": None}
                    if body:
                        loc = body.to_local(e["pos"], t)
                        out.update(body=body.name, local=loc)
                    return out
            return None
        e = dr.estimate(t)
        if not e or not info.get("body") or e["body"] != info["body"]:
            return None
        b = self._db.bodies[e["body"]]
        lat, lon, alt = b.lat_lon_alt(e["local"])
        return {"how": "dr", "system": psys, "pos": b.to_global(e["local"], t), "lat": lat, "lon": lon, "alt": alt, **e}

    def _estimate_beats_log(self, how, t):
        """A place the log puts you at doesn't replace a live dead-reckoned position while telemetry still has you
        flying. Coming in to Lorville the log names the city's zone and traffic control ("log") and switches to
        its landing area ("landed") 10-15 km out, before you've touched down. Once telemetry says you've landed (or
        stopped), or there's no telemetry, the log's place wins as before. A take-off ("left") and a quantum
        arrival always do: the estimate starts again from there."""
        if how not in ("log", "landed"):
            return False
        dr, _ = self._dr_objs()
        return dr.estimate(t) is not None and t - (dr.flying_at or 0) < 5

    def _tel_port_found(self, port):
        """The game serves its telemetry on another port than the one set: use that one from now on."""
        self._settings["telemetry_port"] = int(port)
        self._save_settings()
        try:
            watcher_mod.log_error(f"telemetry: the game serves on port {port}, switched to it")
        except Exception:
            pass

    def telemetry_restart_launcher(self):
        """Settings > Game telemetry > "Restart the RSI Launcher for me" (Windows): closes the launcher and starts it
        again with the setting, so the next game you start from it serves its telemetry. Refused while the game runs."""
        tr = getattr(self, "_tracker", None)
        r = telemetry_mod.restart_launcher(tr.log_path if tr else None)
        if r.get("ok"):
            self._settings["telemetry_launcher_at"] = int(time.time())
            self._save_settings()
        return r

    # ---- The RSI Launcher button at the foot of the sidebar (Settings > Window can hide it)
    def launcher_status(self):
        """{ok, available (Windows), running}. Asked every few seconds while the button shows; tasklist is
        only run once per 4 s however often the page asks."""
        now, c = time.time(), getattr(self, "_launch_st", None)
        if c and now - c[0] < 4:
            return c[1]
        try:
            running = telemetry_mod.launcher_running()
        except Exception:
            running = False
        r = {"ok": True, "available": os.name == "nt", "running": running}
        self._launch_st = (now, r)
        return r

    def start_launcher(self):
        """Start Launcher: starts the RSI Launcher (with the telemetry setting when telemetry is on)."""
        tr = getattr(self, "_tracker", None)
        try:
            r = telemetry_mod.start_launcher(tr.log_path if tr else None, bool(self._settings.get("telemetry_on", True)))
        except Exception as e:
            r = {"ok": False, "error": f"Couldn't start the RSI Launcher: {e}"}
        self._launch_st = None                          # ask again next time, not the cached "not running"
        return r

    def _contract_type(self, code, name):
        """A contract's mission data from the game files, for Jobs: {type ("Delivery", "Bounty Hunting"…), giver,
        reward, reward_max}; None if Quantum doesn't know it."""
        files = getattr(self, "_files", None)
        if not files or not getattr(files, "contracts", None):
            return None
        _uid, c = files.contracts.find(code, name)
        if not c:
            return None
        return {"type": c.get("type"), "giver": c.get("giver"), "reward": c.get("reward"), "reward_max": c.get("reward_max")}

    def _tel_event(self, name, at):
        """Spawn, death, downed, seat changes the moment the game sends them: shown as a note by the page."""
        n = (getattr(self, "_tel_note", None) or {}).get("n", 0) + 1
        self._tel_note = {"n": n, "type": name, "at": at}
        if name in ("dead", "downed"):
            try:
                watcher_mod.log_error(f"telemetry: {name}")
            except Exception:
                pass

    def _tel_live(self):
        """For get_live: None while it's off (nothing changes on the page), else the reader's state."""
        t = getattr(self, "_tel", None)
        if not t or not t.enabled:
            return None
        st = t.state()
        self._tel_mark_seen(st)
        return {**st, "note": getattr(self, "_tel_note", None)}

    def _tel_mark_seen(self, st):
        """The first time data comes in, it's remembered: from then on Settings just says it's working."""
        if st.get("status") in ("connected", "paused") and not self._settings.get("telemetry_seen"):
            self._settings["telemetry_seen"] = int(time.time())
            self._save_settings()

    def telemetry_status(self):
        """For Settings: whether it's on, the reader's state (even while the game is closed), whether the game's side
        is switched on (environment variable, USER.cfg), when you set it up, and whether data has ever come in."""
        t = getattr(self, "_tel", None)
        on = bool(self._settings.get("telemetry_on", True))
        st = t.state() if t and on else None
        if st:
            if st.get("status") == "off":
                st["status"] = "waiting"          # just switched on: the reader hasn't run its first pass yet
            self._tel_mark_seen(st)
        tr = getattr(self, "_tracker", None)
        try:
            ready = telemetry_mod.game_ready(tr.log_path if tr else None)
        except Exception:
            ready = {"env": None, "channels": [], "configured": False, "known": False}
        return {"ok": True, "on": on, "port": t.port if t else telemetry_mod.DEFAULT_PORT, "state": st, "ready": ready,
                "setup_at": self._settings.get("telemetry_setup_at"), "seen": self._settings.get("telemetry_seen"),
                "game_running": bool(tr and tr.game_running),
                # this game session's Game.log: did the game start its telemetry server? (None: no session read yet)
                "log": dict(getattr(tr, "tel_log", None) or {}) or None if tr else None,
                "in_game": bool(tr and tr.in_pu), "windows": os.name == "nt",
                # how long since you spawned in (the game only serves its telemetry from then on): problems are only
                # reported once you've been spawned for a while, never while you're loading in
                "spawned_ago": (time.time() - (tr.spawned_at or tr.pu_at)) if tr and tr.in_pu and (tr.spawned_at or tr.pu_at) else None,
                "launcher_at": self._settings.get("telemetry_launcher_at")}

    def telemetry_set(self, on, port=None):
        """Settings > Game telemetry: on or off (and the port, if the game was set to another)."""
        try:
            port = int(port) if port not in (None, "") else None
        except (TypeError, ValueError):
            port = None
        if port is not None and not (1024 <= port <= 65535):
            return {"ok": False, "error": "The port must be between 1024 and 65535"}
        self._settings["telemetry_on"] = bool(on)
        if port:
            self._settings["telemetry_port"] = port
        self._save_settings()
        t = getattr(self, "_tel", None)
        if t:
            t.set_enabled(bool(on), port)
        return {"ok": True, "on": bool(on), "state": self._tel_live()}

    def session_stats(self):
        """The Session window: this game session's stats, earnings today / this week, the latest balance changes."""
        s = getattr(self, "_sess", None)
        return {"ok": bool(s), **(s.summary() if s else {}), "synced_at": getattr(self, "_stats_synced", 0) or None,
                "signed_in": bool(self._account_token())}

    def earnings_clear(self):
        """Session window > Clear the earnings log (earnings.json)."""
        s = getattr(self, "_sess", None)
        if s:
            s.clear_log()
        tok, com = self._account_token(), getattr(self, "_community", None)
        if tok and com:                                   # the copy kept with the account too, or a sync brings it back
            try:
                com.stats(tok, "clear", {})
            except Exception:
                pass
        return self.session_stats()

    def telemetry_ui_get(self):
        """Where and how the player stats show (Settings > Game telemetry > Player stats), kept in settings.json."""
        return dict(self._settings.get("telemetry_ui") or {})

    def telemetry_ui_set(self, prefs):
        """Save the player stats placement: pos (float/top/bottom/left/right), look, shipcard, maponly."""
        ok = {"pos": ("float", "top", "bottom", "left", "right"), "look": ("bars", "tiles", "rings", "compact")}
        cur = dict(self._settings.get("telemetry_ui") or {})
        for k, v in (prefs or {}).items():
            if k in ok and v in ok[k]:
                cur[k] = v
            elif k in ("shipcard", "maponly"):
                cur[k] = bool(v)
            elif k == "v" and isinstance(v, int):
                cur[k] = v
            elif k == "items" and isinstance(v, dict):
                # the bar's items: order (ids) and the ones switched off. Ids are checked in the UI (unknown ones dropped)
                order = [str(x)[:16] for x in (v.get("order") or []) if isinstance(x, str)][:40]
                off = {str(x)[:16]: True for x, on in (v.get("off") or {}).items() if on}
                cur[k] = {"order": order, "off": off}
        self._settings["telemetry_ui"] = cur
        self._save_settings()
        return cur

    def telemetry_setup_game(self):
        """"Set up the game for me": switches the game's telemetry server on for this PC (the 4.10 environment
        variable and the 5.0 USER.cfg line). Takes effect when the RSI Launcher and the game next start."""
        r = telemetry_mod.setup_game(self._tracker.log_path if getattr(self, "_tracker", None) else None)
        if r.get("ok"):
            self._settings["telemetry_setup_at"] = int(time.time())
            self._save_settings()
        return {**self.telemetry_status(), **r}
