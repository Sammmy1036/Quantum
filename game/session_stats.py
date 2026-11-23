"""Session stats and the earnings log, worked out from the game's telemetry frames (game/telemetry.py).

A session is one run of the game: it starts again when Game.log starts over ("Log started on", the tracker's
tel_log["at"]) or after 15 minutes with no frames. Kept per session: time in game, time flying, distance
flown (speed x time while not landed), top speed, hydrogen used, deaths and downs, and every change to your
aUEC balance.

Balance changes also go to earnings.json (the last 2000), so the earnings log spans sessions. A rise just
after a contract the game says is complete is credited to that contract; anything else is a plain
"Balance went up / down" line (shops, fines, transfers, refunds all look the same from here).
"""
import json
import threading
import time
from pathlib import Path

GAP_NEW_SESSION = 15 * 60       # s without frames: the next frame starts a new session
MAX_DT = 2.0                    # s: longer gaps between frames aren't counted as flying
KEEP = 2000                     # earnings.json lines kept
CONTRACT_WINDOW = (-240, 60)    # s around a contract's completion that a balance rise is credited to it


def _session():
    return {"started": None, "last": None, "key": None, "in_game_s": 0.0, "flying_s": 0.0, "distance_m": 0.0,
            "top_speed": 0.0, "h2_used": 0.0, "deaths": 0, "downs": 0, "balance_start": None, "balance": None,
            "earned": 0, "spent": 0, "contracts": 0, "ships": []}


class SessionStats:
    def __init__(self, path, tracker_fn=None):
        self.path = Path(path)
        self.tracker_fn = tracker_fn            # fn() -> the Game.log tracker (contracts, tel_log), or None
        self.lock = threading.Lock()
        self.s = _session()
        self._prev = None                       # last frame's {t, speed, landed, h2, vehicle}
        self._credited = set()                  # contract ids already given a payout line
        try:
            self.log = json.loads(self.path.read_text(encoding="utf-8")).get("entries", [])[-KEEP:]
        except Exception:
            self.log = []

    # ---- fed by the telemetry reader, ~15 times a second
    def frame(self, d, now=None):
        now = now or time.time()
        tr = self.tracker_fn() if self.tracker_fn else None
        key = (getattr(tr, "tel_log", None) or {}).get("at") if tr else None
        with self.lock:
            s = self.s
            if s["last"] is None or now - s["last"] > GAP_NEW_SESSION or (key and s["key"] and key != s["key"]):
                self.s = s = _session()
                s["started"], s["key"] = now, key
                self._prev = None
            elif key and not s["key"]:
                s["key"] = key
            dt = min(now - s["last"], MAX_DT) if s["last"] else 0.0
            s["last"] = now
            s["in_game_s"] += dt
            v, a = d.get("vehicle"), d.get("actor") or {}
            if v:
                sp = v.get("speed") or 0.0
                if self._prev and self._prev.get("vehicle") and not v.get("landed") and v.get("flight_data") is not False:
                    s["flying_s"] += dt
                    s["distance_m"] += max(0.0, sp) * dt
                s["top_speed"] = max(s["top_speed"], sp if not v.get("landed") else 0.0)
                h2 = v.get("h_fuel")
                p2 = self._prev.get("h2") if self._prev else None
                if h2 is not None and p2 is not None and 0 < p2 - h2 < 0.05:      # a refuel or a ship change isn't use
                    s["h2_used"] += p2 - h2
                name = v.get("name")
                if name and name not in s["ships"]:
                    s["ships"].append(name)
            for ev in d.get("events") or []:
                if ev in ("dead", "killed", "death"):
                    s["deaths"] += 1
                elif ev in ("downed", "incapacitated"):
                    s["downs"] += 1
            bal = a.get("auec")
            if bal is not None:
                if s["balance_start"] is None:
                    s["balance_start"] = bal
                elif s["balance"] is not None and bal != s["balance"]:
                    self._change(s, bal - s["balance"], bal, now, tr)
                s["balance"] = bal
            self._prev = {"t": now, "vehicle": bool(v), "h2": (v or {}).get("h_fuel")}

    def _change(self, s, delta, bal, now, tr):
        label, kind = ("Balance went up", "in") if delta > 0 else ("Balance went down", "out")
        if delta > 0:
            s["earned"] += delta
            c = self._contract_for(now, tr)
            if c is not None:
                label, kind = c.name, "contract"
                self._credited.add(c.id)
                s["contracts"] += 1
        else:
            s["spent"] += -delta
        e = {"t": round(now, 1), "delta": int(delta), "balance": int(bal), "label": label, "kind": kind,
             "session": s["started"]}
        self.log.append(e)
        del self.log[:-KEEP]
        threading.Thread(target=self._save, daemon=True).start()

    def _contract_for(self, now, tr):
        best = None
        for c in list((getattr(tr, "contracts", None) or {}).values()):
            if c.status != "complete" or not c.closed_at or c.id in self._credited:
                continue
            d = now - c.closed_at
            if -CONTRACT_WINDOW[1] <= d <= -CONTRACT_WINDOW[0]:            # paid up to 4 min after, or 1 min before the log says
                if best is None or abs(d) < abs(now - best.closed_at):
                    best = c
        return best

    def _save(self):
        with self.lock:
            data = {"entries": list(self.log)}
        try:
            tmp = self.path.with_suffix(".tmp")
            tmp.write_text(json.dumps(data, separators=(",", ":")), encoding="utf-8")
            tmp.replace(self.path)
        except OSError:
            pass

    # ---- for the page
    def summary(self):
        with self.lock:
            s = dict(self.s)
            log = list(self.log)
        now = time.time()
        day = now - 86400
        week = now - 7 * 86400
        ins = [e for e in log if e["delta"] > 0]
        return {"session": {**s, "ships": list(s["ships"]), "net": (s["earned"] or 0) - (s["spent"] or 0),
                            "active": bool(s["last"] and now - s["last"] < 60)},
                "today": sum(e["delta"] for e in ins if e["t"] >= day),
                "week": sum(e["delta"] for e in ins if e["t"] >= week),
                "entries": log[-200:][::-1]}

    def clear_log(self):
        with self.lock:
            self.log = []
        self._save()
