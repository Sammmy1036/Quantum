"""Api, part of: the Friend Map. Friends (and, if they choose, org mates) who share their location show on the map.

A mixin of app.py's Api (class Api(... FriendMapMixin ...)): the methods are the Api's, `self` is the one Api.
Module-level names come from qbase.py.

How it works:
  - Sharing is off until you turn it on (Social > Friend Map). You pick who sees you: your friends, or your friends
    and the members of your orgs. Appearing offline (Social) hides you too; the server checks that.
  - Only while Star Citizen is running and Quantum knows where you are (your /showlocation, or where the game log
    puts you). Quantum sends it when you've moved or changed place, and at least once a minute so it stays on the map;
    the server keeps it in memory only, for 5 minutes after the last update, and forgets it when you stop sharing,
    close the game or close Quantum.
  - What's sent: system, the planet or moon you're on or near, your position (the same numbers /showlocation gives),
    and the name of the place you're at. Nothing about your route, contracts or cargo.
  - Their positions come back every few seconds while the Friend Map is open, every 10 s while "Show on the main map"
    is on, and not at all otherwise.

Kept in settings.json under "friend_map": {"share": "off" | "friends" | "friends_orgs", "on_map": true}.
"""
from qbase import *  # noqa: F401,F403

FM_SHARES = ("off", "friends", "friends_orgs")
FM_KEEPALIVE = 60          # s: send at least this often while sharing (the server keeps it 300 s)
FM_MOVE_M = 250            # m moved since the last send: send now
FM_FETCH_FOCUS = 3         # s between fetches while the Friend Map is open
FM_FETCH_MAP = 10          # s between fetches while friends show on the main map
FM_STALE_ME = 15 * 60      # s: a /showlocation older than this (and no newer log spot) isn't shared any more


class FriendMapMixin:
    # ---------------------------------------------------------------- settings
    def _fm_cfg(self):
        c = self._settings.setdefault("friend_map", {})
        if c.get("share") not in FM_SHARES:
            c["share"] = "off"
        c.setdefault("on_map", True)
        return c

    def _fm_state(self):
        fm = self.__dict__.get("_fm")
        if fm is None:
            fm = self._fm = {"people": [], "got_at": 0, "error": None, "focus_until": 0, "wake": threading.Event(),
                             "sent": None, "sent_at": 0, "sent_share": None, "me": None, "server_sharing": None,
                             "started": False}
        return fm

    def _fm_start(self):
        fm = self._fm_state()
        if not fm["started"]:
            fm["started"] = True
            threading.Thread(target=self._fm_loop, daemon=True, name="friend-map").start()

    # ---------------------------------------------------------------- what the page calls
    def friendmap_get(self, focus=True):
        """{ok, signed_in, share, on_map, people, error, at, game_on, me: {place, system} | None, sharing}."""
        fm, cfg = self._fm_state(), self._fm_cfg()
        if focus:
            fresh = time.time() >= fm["focus_until"]
            fm["focus_until"] = time.time() + 15
            if fresh:
                fm["wake"].set()
        me = self._fm_my_location()
        return {"ok": True, "signed_in": bool(self._account_token()), "share": cfg["share"], "on_map": bool(cfg["on_map"]),
                "people": fm["people"], "error": fm["error"], "at": fm["got_at"] or None, "game_on": bool(self._game_on()),
                "me": {"place": me.get("place"), "system": me.get("system"), "body": me.get("body")} if me else None,
                "sharing": bool(fm["sent_share"] not in (None, "off") and cfg["share"] != "off")}

    def friendmap_set(self, share=None, on_map=None):
        cfg = self._fm_cfg()
        if share is not None:
            if share not in FM_SHARES:
                return {"ok": False, "error": "Unknown choice"}
            cfg["share"] = share
        if on_map is not None:
            cfg["on_map"] = bool(on_map)
        self._save_settings()
        self._fm_state()["wake"].set()
        return self.friendmap_get(focus=False)

    def _fm_live(self):
        """For get_live: friends to draw on the map, when the main map shows them (the Friend Map tab always does)."""
        fm, cfg = self._fm_state(), self._fm_cfg()
        return {"on_map": bool(cfg["on_map"]), "share": cfg["share"], "people": fm["people"], "at": fm["got_at"] or None}

    # ---------------------------------------------------------------- where you are
    def _fm_note_me(self, info, at_place=None):
        """get_live's own reading of where you are (it already works out the log spot, the body, the ground position)."""
        if not info:
            return
        self._fm_state()["me"] = {"pos": info.get("pos"), "t": info.get("t"), "system": info.get("system"),
                                  "body": info.get("body"), "local": info.get("local"), "approx": info.get("approx"),
                                  "at_place": at_place, "seen": time.time()}

    def _fm_my_location(self):
        """{system, body, local, pos, t, place, approx} or None. get_live's reading when it's fresh (the page asks
        several times a second), else the last /showlocation."""
        if not self._game_on():
            return None
        now = time.time()
        got = self._fm_state().get("me")
        if not (got and now - got["seen"] < 10):
            with self._lock:
                p, psys, pt = self._player, self._player_sys, self._player_t
            if not p or not pt:
                return None
            got = {"pos": p, "t": pt, "system": psys, "body": None, "local": None, "approx": None, "at_place": None}
            b = self._db.body_near(p, psys)
            if b is not None:
                got.update(body=b.name, local=b.to_local(p, pt))
        if not got.get("pos") or not got.get("t") or (now - got["t"] > FM_STALE_ME and not got.get("approx")):
            return None
        out = {k: got.get(k) for k in ("system", "body", "local", "pos", "t", "approx")}
        out["pos"] = [float(x) for x in out["pos"]]
        if out.get("local") is not None:
            out["local"] = [float(x) for x in out["local"]]
        out["place"] = got.get("approx") or got.get("at_place") or self._fm_place_near(out)
        return out

    def _fm_place_near(self, me):
        """The named place you're at or next to, for the list ("at Area 18"), else "Near <body>", else None."""
        best, best_d = None, None
        body, local, t = me.get("body"), me.get("local"), me.get("t") or time.time()
        try:
            if body and local:
                for L in self._db.locations.values():
                    if L.body == body and L.kind == "surface" and L.pos and L.system == me.get("system"):
                        d = dist(L.pos, local)
                        if d < 15000 and (best_d is None or d < best_d):
                            best, best_d = L.name, d
            if not best:
                for L in self._db.locations.values():
                    if L.system == me.get("system") and L.pos and getattr(L, "type", "") == "station":
                        d = dist(self._db.global_pos(L, t), me["pos"])
                        if d < 100000 and (best_d is None or d < best_d):
                            best, best_d = L.name, d
        except Exception:
            best = None
        return best or (f"Near {body}" if body else None)

    # ---------------------------------------------------------------- the loop
    def _fm_loop(self):
        fm = self._fm_state()
        time.sleep(8)                                    # after sign-in and the first log read
        while True:
            try:
                self._fm_tick()
            except Exception:
                watcher_mod.log_error("friend map")
            focus = time.time() < fm["focus_until"]
            fm["wake"].wait(FM_FETCH_FOCUS if focus else 5)
            fm["wake"].clear()

    def _fm_tick(self):
        fm, cfg, now = self._fm_state(), self._fm_cfg(), time.time()
        if not self._account_token() or not self._community.url:
            fm.update(people=[], error=None, sent=None, sent_share=None)
            return
        me = self._fm_my_location() if cfg["share"] != "off" else None
        want = cfg["share"] if me else "off"
        if want == "off":
            if fm["sent_share"] not in (None, "off"):
                r = self._social_call("location", {"share": "off"}, timeout=8)
                if r.get("status") == "ok":
                    fm.update(sent_share="off", sent=None)
        else:
            last = fm["sent"]
            moved = True
            if last and last.get("system") == me["system"] and last.get("body") == me["body"]:
                a, b = (me["local"], last.get("local")) if me["body"] else (me["pos"], last.get("pos"))
                moved = not (a and b) or dist(a, b) > FM_MOVE_M
            if (moved or fm["sent_share"] != want or last.get("place") != me["place"]
                    or now - fm["sent_at"] > FM_KEEPALIVE):
                r = self._social_call("location", dict(me, share=want), timeout=8)
                if r.get("status") == "ok":
                    fm.update(sent=me, sent_at=now, sent_share=want)
                elif r.get("status") not in ("requests_limit_reached",):
                    fm["error"] = self._fm_error(r)
        focus = now < fm["focus_until"]
        if not (focus or cfg["on_map"]):
            if fm["people"]:
                fm["people"] = []
            return
        if now - fm["got_at"] < (FM_FETCH_FOCUS if focus else FM_FETCH_MAP) - 0.5:
            return
        r = self._social_call("locations", timeout=8)
        if r.get("status") == "ok":
            fm.update(people=[self._fm_person(p) for p in r.get("people") or []], got_at=now, error=None,
                      server_sharing=r.get("sharing"))
        else:
            fm["error"] = self._fm_error(r)
            if now - fm["got_at"] > 300:
                fm["people"] = []                        # too old to show as "where they are"

    @staticmethod
    def _fm_person(p):
        keep = ("id", "name", "tag", "avatar", "why", "system", "body", "local", "pos", "t", "place", "approx", "age")
        return {k: p.get(k) for k in keep}

    @staticmethod
    def _fm_error(r):
        st = r.get("status")
        return {"signed_out": "Sign in to your Quantum account to use the Friend Map.",
                "unreachable": "Couldn't reach the Quantum server. Trying again shortly.",
                "unavailable": "The Quantum server doesn't have the Friend Map yet.",
                "http_404": "The Quantum server doesn't have the Friend Map yet.",
                "not_found": "The Quantum server doesn't have the Friend Map yet."}.get(st, f"Quantum server: {st}")

    def _fm_shutdown(self):
        """Closing Quantum: take you off everyone's map now rather than in 5 minutes."""
        fm = self.__dict__.get("_fm")
        if fm and fm.get("sent_share") not in (None, "off") and self._account_token():
            try:
                self._social_call("location", {"share": "off"}, timeout=3)
            except Exception:
                pass
