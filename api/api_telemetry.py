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
        self._sess = session_mod.SessionStats(HERE / "earnings.json", lambda: getattr(self, "_tracker", None))
        self._tel.on_frame = self._sess.frame
        threading.Thread(target=self._stats_sync_loop, daemon=True, name="stats-sync").start()   # api_jobs.py
        self._tel.start()
        self._tel.set_enabled(bool(self._settings.get("telemetry_on", True)))

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
