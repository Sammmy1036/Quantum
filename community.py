"""Community prices: datarunner reports from Quantum users, from the Quantum API (server/).

Each report there was checked against UEX's own copy before it's served, and is dropped if UEX
declines it. Quantum shows whichever is newer for each terminal, commodity and side: UEX's price
or the community report. Once UEX publishes its own newer data, that wins again by itself.

The Quantum API at DEFAULT_URL is built in; "community_url" in settings.json overrides it (set it
to "off" to turn community prices off).
"""
import json
import threading
import time
import urllib.error
import urllib.request

TTL = 120                      # seconds between fetches
DEFAULT_URL = "https://quantumsc.ddnsgeek.com"


class Community:
    def __init__(self, url_getter, test_getter, device_getter=None):
        self._url, self._test = url_getter, test_getter
        self.place_results = {}       # name -> what the server said about the last position you sent
        # This PC's random device key. The server ties it to your UEX name once a report sent with it
        # is confirmed by UEX, so only your own PCs count as you for trusted-contributor features.
        self._device = device_getter or (lambda: None)
        self._cache, self._at, self._lock = {}, 0, threading.Lock()
        self.last_error = None

    @property
    def url(self):
        u = self._url()
        u = DEFAULT_URL if u is None else u.strip()
        return "" if u.lower() == "off" else u.rstrip("/")

    def _req(self, path, body=None, timeout=10):
        req = urllib.request.Request(self.url + path, data=json.dumps(body).encode("utf-8") if body is not None else None,
                                     method="POST" if body is not None else "GET",
                                     headers={"Content-Type": "application/json", "Accept": "application/json",
                                              "User-Agent": "Quantum", **({"X-Quantum-Device": k} if (k := (self._device() or "").strip()) else {})})
        try:
            with urllib.request.urlopen(req, timeout=timeout) as r:
                return json.loads(r.read().decode("utf-8"))
        except urllib.error.HTTPError as e:
            try:
                return json.loads(e.read().decode("utf-8"))
            except Exception:
                return {"status": f"http_{e.code}"}

    def health(self):
        if not self.url:
            return {"ok": False, "error": "No server set"}
        try:
            r = self._req("/v1/health", timeout=6)
            return {"ok": r.get("status") == "ok", "verifying": r.get("verifying"), "error": None if r.get("status") == "ok" else r.get("status")}
        except Exception as e:
            return {"ok": False, "error": str(e)}

    def prices(self, fresh=False):
        """{(id_terminal, id_commodity, side): report} -- the newest verified report of each."""
        if not self.url:
            return {}
        with self._lock:
            if not fresh and time.time() - self._at < TTL:
                return self._cache
        try:
            r = self._req("/v1/prices" + ("?test=1" if self._test() else ""))
            data = (r.get("data") or []) if r.get("status") == "ok" else []
            cache = {(p["id_terminal"], p["id_commodity"], p["side"]): p for p in data}
            self.last_error = None if r.get("status") == "ok" else r.get("status")
        except Exception as e:                                 # server down: UEX data alone, as before
            self.last_error = str(e)
            with self._lock:
                self._at = time.time() - TTL + 30              # try again in 30 s, not on every call
                return self._cache
        with self._lock:
            self._cache, self._at = cache, time.time()
            return cache

    def profile(self, username):
        """The datarunner's profile kept on the server: reports, rating, rank, history."""
        if not self.url or not username:
            return None
        import urllib.parse
        try:
            r = self._req("/v1/profile?" + urllib.parse.urlencode({"username": username, **({"test": 1} if self._test() else {})}),
                          timeout=6)
            return r if r.get("status") == "ok" else None
        except Exception as e:
            self.last_error = str(e)
            return None

    def backup_put(self, slot, auth, blob):
        """Store your encrypted backup. {status: ok | wrong_key | requests_limit_reached | unreachable ...}"""
        if not self.url:
            return {"status": "off"}
        try:
            return self._req("/v1/backup", {"slot": slot, "auth": auth, "blob": blob}, timeout=20)
        except Exception as e:
            return {"status": "unreachable", "detail": str(e)}

    def backup_get(self, slot, auth, delete=False):
        """Your encrypted backup: {status: ok, blob, updated} | no_backup | wrong_key | deleted | unreachable."""
        if not self.url:
            return {"status": "off"}
        try:
            return self._req("/v1/backup/get", {"slot": slot, "auth": auth, **({"delete": True} if delete else {})}, timeout=20)
        except Exception as e:
            return {"status": "unreachable", "detail": str(e)}

    @staticmethod
    def _http_status(e):
        try:
            return json.loads(e.read().decode("utf-8"))
        except Exception:
            return {"status": f"http_{e.code}"}

    def update_user(self, username, display=None, avatar=None):
        """Tell the server your UEX avatar and name (as read from UEX), for the Top 10."""
        if not self.url or not username:
            return False
        try:
            r = self._req("/v1/user", {"username": username, "display": display, "avatar": avatar}, timeout=8)
            return r.get("status") == "ok"
        except Exception as e:
            self.last_error = str(e)
            return False

    def leaderboard(self, me=None):
        """The top 10 datarunners on the server, and where you stand ({top, me, total}), or None."""
        if not self.url:
            return None
        import urllib.parse
        try:
            r = self._req("/v1/leaderboard" + ("?" + urllib.parse.urlencode({"me": me}) if me else ""), timeout=8)
            return r if r.get("status") == "ok" else None
        except Exception as e:
            self.last_error = str(e)
            return None

    def photos(self):
        """{lowercase name: full picture URL} for pictures you've approved on the server. Cached an hour."""
        if not self.url:
            return {}
        if getattr(self, "_photos_at", 0) > time.time() - 3600:
            return self._photos
        try:
            r = self._req("/v1/photos", timeout=8)
            self._photos = {k: self.url + v["url"] for k, v in (r.get("photos") or {}).items()} if r.get("status") == "ok" else {}
        except Exception:
            self._photos = getattr(self, "_photos", {})
        self._photos_at = time.time()
        return self._photos

    def submit_photo(self, kind, name, data_url, username):
        if not self.url:
            return {"ok": False, "error": "Community features are off"}
        try:
            r = self._req("/v1/photos", {"kind": kind, "name": name, "image": data_url, "username": username}, timeout=60)
        except Exception as e:
            return {"ok": False, "error": str(e)}
        if r.get("status") != "ok":
            return {"ok": False, "error": r.get("detail") or r.get("status")}
        if r.get("approved"):
            self._photos_at = 0                                 # live now: fetch the list again next time
        return {"ok": True, "approved": bool(r.get("approved")), "url": self.url + r["url"] if r.get("url") else None}

    def trust(self, username):
        """{trusted, device, info} from the server, or None if it can't be reached."""
        if not self.url or not username:
            return None
        import urllib.parse
        try:
            r = self._req("/v1/trust?" + urllib.parse.urlencode({"username": username}), timeout=6)
            return r if r.get("status") == "ok" else None
        except Exception:
            return None

    def routes(self):
        """Trade routes other Quantum users shared (the last week's)."""
        if not self.url:
            return []
        try:
            r = self._req("/v1/routes", timeout=8)
            return r.get("routes") or [] if r.get("status") == "ok" else []
        except Exception:
            return []

    def share_route(self, route, username):
        if not self.url:
            return {"ok": False, "error": "Community features are off"}
        try:
            r = self._req("/v1/routes", dict(route, username=username), timeout=15)
        except Exception as e:
            return {"ok": False, "error": str(e)}
        return {"ok": True} if r.get("status") == "ok" else {"ok": False, "error": r.get("detail") or r.get("status")}

    def places(self):
        """{places: positions other Quantum users found, missing: places UEX lists that datarunners
        agree don't exist}, or None."""
        if not self.url:
            return None
        try:
            r = self._req("/v1/places", timeout=8)
            return {"places": r.get("places") or {}, "missing": r.get("missing") or [], "pads": r.get("pads") or {}} \
                if r.get("status") == "ok" else None
        except Exception as e:
            self.last_error = str(e)
            return None

    def post_missing(self, name, username=None, on_done=None):
        """Report that a place doesn't exist in the game. In the background; on_done(True) once answered."""
        if not self.url:
            return

        def send():
            try:
                r = self._req("/v1/places/missing", {"name": name, "username": username}, timeout=15)
                on_done and on_done(True)
            except Exception as e:
                self.last_error = str(e)
                on_done and on_done(False)
        threading.Thread(target=send, daemon=True).start()

    def post_pad(self, name, pad, username=None):
        """Report a place's landing pad size, in the background."""
        if not self.url:
            return

        def send():
            try:
                self._req("/v1/places/pad", {"name": name, "pad": pad, "username": username}, timeout=15)
            except Exception as e:
                self.last_error = str(e)
        threading.Thread(target=send, daemon=True).start()

    def claims(self):
        """Jobs other datarunners have accepted: {job: {by, until}}, or None if the server's away."""
        if not self.url:
            return None
        try:
            r = self._req("/v1/jobs/claims", timeout=8)
            return r.get("claims") or {} if r.get("status") == "ok" else None
        except Exception as e:
            self.last_error = str(e)
            return None

    def claim(self, job, username, release=False):
        """Accept a job ("t:<terminal id>" or "p:<place>"), or let it go. {status: ok, until} | taken (by, until)."""
        if not self.url:
            return {"status": "off"}
        try:
            return self._req("/v1/jobs/claim", {"job": job, "username": username, **({"release": True} if release else {})},
                             timeout=10)
        except Exception as e:
            return {"status": "unreachable", "detail": str(e)}

    def withdraw_place(self, name, username=None):
        """Take back a station position you sent. {status: ok, withdrawn} | not_yours | unreachable."""
        if not self.url:
            return {"status": "off"}
        try:
            return self._req("/v1/places/withdraw", {"name": name, "username": username}, timeout=15)
        except Exception as e:
            return {"status": "unreachable", "detail": str(e)}

    RETRY_WAITS = (10, 30)              # s between the 3 tries; after that it's re-sent later

    def post_place(self, name, entry, username=None, on_done=None):
        """Share a position this user set with /showlocation, in the background. A server that can't
        be reached is tried 3 times over about a minute; on_done(True) once the server has answered
        (accepted, or refused for good), on_done(False) if it never could be reached."""
        if not self.url:
            return
        msg = {"name": name, "system": entry.get("system"), "username": username,
               **({"body": entry["body"], "local": entry["local"]} if entry.get("local") else {"pos": entry.get("pos")})}

        self.place_results[name] = {"state": "sending", "at": time.time()}

        def send():
            for attempt in range(len(self.RETRY_WAITS) + 1):
                try:
                    r = self._req("/v1/places", msg, timeout=15)
                except Exception as e:
                    self.last_error = str(e)
                    if attempt < len(self.RETRY_WAITS):
                        self.place_results[name] = {"state": "sending", "retry": attempt + 1, "error": str(e), "at": time.time()}
                        time.sleep(self.RETRY_WAITS[attempt])
                        continue
                    self.place_results[name] = {"state": "queued", "error": str(e), "at": time.time()}
                    on_done and on_done(False)
                    return
                ok = r.get("status") == "ok"
                self.place_results[name] = {"state": "done" if ok else "error", "shared": bool(r.get("shared")),
                                            "reporters": r.get("reporters"), "error": None if ok else r.get("status"),
                                            "at": time.time()}
                on_done and on_done(True)
                return
        threading.Thread(target=send, daemon=True).start()

    def post(self, body, sides, ids, username, date_added, test, display=None, avatar=None):
        """After a report UEX accepted (or a test report): send it on. -> {ok, states | error}, or None
        when community prices are off."""
        if not self.url:
            return None
        reports = []
        for i, p in enumerate(body.get("prices") or []):
            side = sides[i] if i < len(sides) else "buy"
            try:
                uex_id = int(ids[i]) if i < len(ids) else 0
            except (TypeError, ValueError):
                uex_id = 0
            if not test and not uex_id:
                continue
            reports.append({"uex_id": uex_id, "id_commodity": p.get("id_commodity"), "side": side,
                            "price": p.get(f"price_{side}"), "scu": p.get(f"scu_{side}"), "status": p.get(f"status_{side}"),
                            "is_missing": 1 if p.get("is_missing") else 0})
        if not reports:
            return {"ok": False, "error": "no UEX report IDs to send"}
        msg = {"id_terminal": body.get("id_terminal"), "username": username, "date_added": int(date_added or time.time()),
               "test": bool(test), "reports": reports, "display": display, "avatar": avatar}
        try:
            r = self._req("/v1/reports", msg, timeout=15)
        except Exception as e:
            self.last_error = str(e)
            return {"ok": False, "error": str(e)}
        with self._lock:
            self._at = 0                                       # pick it up on the next read
        if r.get("status") != "ok":
            self.last_error = r.get("status")
            return {"ok": False, "error": r.get("status"), "detail": r.get("detail")}
        return {"ok": True, "states": r.get("states") or {}}

    def overlay(self, rows):
        """UEX's commodities_prices_all rows with any newer community report laid over them. Changed
        sides get community_<side> = {at, uex_status, test} so the page can label them."""
        reps = self.prices()
        if not reps:
            return rows
        by_key, out = {}, []
        for (tid, cid, side), p in reps.items():
            by_key.setdefault((tid, cid), {})[side] = p
        seen = set()
        for r in rows:
            key = (r.get("id_terminal"), r.get("id_commodity"))
            mine = by_key.get(key)
            if not mine:
                out.append(r)
                continue
            seen.add(key)
            r = dict(r)
            for side, p in mine.items():
                if p["date_added"] <= (r.get("date_modified") or 0):
                    continue                                   # UEX already has something newer
                _apply(r, side, p)
            out.append(r)
        for key, mine in by_key.items():                       # traded here per the community, not yet on UEX
            if key in seen:
                continue
            r = {"id_terminal": key[0], "id_commodity": key[1], "date_modified": 0}
            for side, p in mine.items():
                _apply(r, side, p)
            out.append(r)
        return out


def _apply(r, side, p):
    if p.get("is_missing"):
        r[f"price_{side}"] = 0
    else:
        r[f"price_{side}"] = p["price"]
        r["scu_buy" if side == "buy" else "scu_sell_stock"] = p.get("scu")
        r[f"status_{side}"] = p.get("status")
    r[f"community_{side}"] = {"at": p["date_added"], "uex_status": p.get("uex_status"), "test": p.get("test")}
    r["date_modified"] = max(r.get("date_modified") or 0, p["date_added"])
