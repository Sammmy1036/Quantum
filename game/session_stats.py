"""Session stats and the earnings log, worked out from the game's telemetry frames (game/telemetry.py).

A session is one run of the game: it starts again when Game.log starts over ("Log started on", the tracker's
tel_log["at"]) or after 15 minutes with no frames. Kept per session: time in game, time flying, distance
flown (speed x time while not landed), top speed, hydrogen used, deaths and downs, and every change to your
aUEC balance.

Balance changes also go to earnings.json (the last 2000), so the earnings log spans sessions. A rise from a
minute before to ten minutes after a contract the game says is complete is credited to that contract (if Game.log
says so a little after the money arrives, the line is put right then: see _recheck). Anything else is a plain
"Balance went up / down" line (shops, fines, transfers, refunds all look the same from here).

What Jobs needs to tell these apart is written with each rise (the server's jobs.py role_of decides):
  a contract payout: the contract's internal code, and from Quantum's mission data (the game files) its type and
    employer (code, ctype, giver). The mission data's payout range also picks which contract a rise is: one far
    bigger than a contract ever pays isn't its payout (a sale made just after handing it in, say)
  any other rise: the ship you were in (ship), and whether you were flying, landed or on foot then (pos); a rise
    that gives back exactly what you spent in the last 15 minutes is marked as a refund (src)
"""
import json
import threading
import time
from pathlib import Path

GAP_NEW_SESSION = 15 * 60       # s without frames: the next frame starts a new session
MAX_DT = 2.0                    # s: longer gaps between frames aren't counted as flying
KEEP = 2000                     # earnings.json lines kept
HISTORY = 60                    # finished sessions kept (time in game, earnings, distance…)
SAVE_EVERY = 30                 # s: the running session is written down this often, so a restart doesn't lose it
CONTRACT_WINDOW = (-600, 60)    # s around a contract's completion that a balance rise is credited to it
RECHECK_S = 120                 # s a plain rise waits for Game.log to say a contract completed (then it's that contract's)
PAY_OVER, PAY_SLACK = 3, 10_000   # a rise over 3 × a contract's top payout (+10k) isn't that contract's payout
REFUND_S = 15 * 60              # s: a rise that gives back exactly what you spent this long before is a refund


def _session():
    return {"started": None, "last": None, "key": None, "in_game_s": 0.0, "flying_s": 0.0, "distance_m": 0.0,
            "top_speed": 0.0, "h2_used": 0.0, "deaths": 0, "downs": 0, "balance_start": None, "balance": None,
            "earned": 0, "spent": 0, "contracts": 0, "ships": []}


class SessionStats:
    def __init__(self, path, tracker_fn=None, ctype_fn=None):
        self.path = Path(path)
        self.tracker_fn = tracker_fn            # fn() -> the Game.log tracker (contracts, tel_log), or None
        self.ctype_fn = ctype_fn                # fn(code, name) -> {type, giver, reward, reward_max} from the mission data, or None
        self._info = {}                         # contract id -> that, looked up once
        self._pos = None                        # flying / landed / foot, from the last frame
        self.lock = threading.Lock()
        self.s = _session()
        self._prev = None                       # last frame's {t, speed, landed, h2, vehicle}
        self._credited = set()                  # contract ids already given a payout line
        self._ship = (None, 0)                  # (the ship you're in or were last in, when)
        self._saved_at = 0.0
        self.dirty = False                      # changed since the last server sync (api_jobs.py)
        try:
            raw = json.loads(self.path.read_text(encoding="utf-8"))
        except Exception:
            raw = {}
        self.log = list(raw.get("entries") or [])[-KEEP:]
        self.history = list(raw.get("sessions") or [])[-HISTORY:]   # finished sessions, newest last
        # The session that was running when Quantum closed (an update, a restart) carries on if the game kept going:
        # same Game.log run and frames within GAP_NEW_SESSION. Otherwise it's history and a new one starts.
        old = raw.get("session")
        if isinstance(old, dict) and old.get("started"):
            self.s = {**_session(), **old}
            self.s["ships"] = list(self.s.get("ships") or [])

    # ---- fed by the telemetry reader, ~15 times a second
    def frame(self, d, now=None):
        now = now or time.time()
        tr = self.tracker_fn() if self.tracker_fn else None
        key = (getattr(tr, "tel_log", None) or {}).get("at") if tr else None
        with self.lock:
            s = self.s
            if s["last"] is None or now - s["last"] > GAP_NEW_SESSION or (key and s["key"] and key != s["key"]):
                self._finish(s)
                self.s = s = _session()
                s["started"], s["key"] = now, key
                self._prev = None
            elif key and not s["key"]:
                s["key"] = key
            dt = min(now - s["last"], MAX_DT) if s["last"] else 0.0
            s["last"] = now
            s["in_game_s"] += dt
            v, a = d.get("vehicle"), d.get("actor") or {}
            self._pos = ("flying" if not v.get("landed") and v.get("flight_data") is not False else "landed") if v else "foot"
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
                if name:
                    self._ship = (name, now)
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
            self._recheck(now, tr)
            self._prev = {"t": now, "vehicle": bool(v), "h2": (v or {}).get("h_fuel")}
            due = now - self._saved_at > SAVE_EVERY
            if due:
                self._saved_at = now
        if due:
            threading.Thread(target=self._save, daemon=True).start()

    def _change(self, s, delta, bal, now, tr):
        label, kind = ("Balance went up", "in") if delta > 0 else ("Balance went down", "out")
        c = None
        if delta > 0:
            s["earned"] += delta
            c = self._contract_for(now, tr, delta)
        else:
            s["spent"] += -delta
        e = {"t": round(now, 1), "delta": int(delta), "balance": int(bal), "label": label, "kind": kind,
             "session": s["started"]}
        if c is not None:
            self._credit(e, c, s)
        elif delta > 0:
            e["pos"] = self._pos or ""                 # where you were: terminals sell on the ground or at a station (Jobs)
            if self._refund(delta, now):
                e["src"] = "refund"                    # exactly what you spent a moment ago, back: nobody's job
        ship, seen = self._ship
        if ship and now - seen < 600:
            e["ship"] = ship                           # what you were flying: a sale from a Prospector is ore (Jobs)
        self.dirty = True
        self.log.append(e)
        del self.log[:-KEEP]
        threading.Thread(target=self._save, daemon=True).start()

    def _credit(self, e, c, s):
        """A rise is this contract's payout: its name, code and kind of work (from the game files) go with it."""
        e.update(label=c.name, kind="contract")
        e.pop("pos", None), e.pop("src", None)
        code = getattr(c, "code", "") or ""
        if code:
            e["code"] = code
        info = self._mission(c)
        if info.get("type"):
            e["ctype"] = str(info["type"])[:60]
        if info.get("giver"):
            e["giver"] = str(info["giver"])[:60]
        what = getattr(c, "subtitle", "") or ""
        if what:
            e["what"] = what                           # the cargo: shown, never used to pick the job
        self._credited.add(c.id)
        s["contracts"] += 1

    def _refund(self, delta, now):
        """Did you spend exactly this much in the last few minutes (and not get it back already)?"""
        for x in reversed(self.log):
            if now - (x.get("t") or 0) > REFUND_S:
                break
            if x.get("delta") == delta and x.get("src") == "refund":
                return False                           # that spend has its refund already
            if x.get("delta") == -delta:
                return True
        return False

    def _recheck(self, now, tr):
        """A plain rise from the last couple of minutes becomes a contract's payout once Game.log says that
        contract completed (the money can arrive before the log line is read)."""
        if not tr:
            return
        for e in reversed(self.log):
            if now - (e.get("t") or 0) > RECHECK_S:
                break
            if e.get("kind") != "in" or e.get("src"):
                continue
            c = self._contract_for(e["t"], tr, e.get("delta"))
            if c is not None:
                self._credit(e, c, self.s)
                self.dirty = True
                threading.Thread(target=self._save, daemon=True).start()

    def _mission(self, c):
        """The contract's mission data: {type, giver, reward, reward_max} (empty if Quantum doesn't know it)."""
        if c.id not in self._info:
            info = None
            if self.ctype_fn:
                try:
                    info = self.ctype_fn(getattr(c, "code", "") or "", c.name)
                except Exception:
                    info = None
            self._info[c.id] = info if isinstance(info, dict) else {"type": info} if info else {}
        return self._info[c.id]

    def _pays(self, c, delta):
        """Could this contract have paid delta? None: its payout isn't known. Loose on purpose: a shared contract's
        payout is split between the party, and some pay a bonus, so only a rise far over its top payout says no."""
        info = self._mission(c)
        top = max(float(info.get("reward") or 0), float(info.get("reward_max") or 0))
        if not top or not delta:
            return None
        return delta <= top * PAY_OVER + PAY_SLACK

    def _contract_for(self, now, tr, delta=None):
        """The completed contract a rise at `now` is the payout of: inside CONTRACT_WINDOW, not credited yet, and
        able to pay that much; one whose payout matches beats one whose payout isn't known, then the nearest in time."""
        best, best_key = None, None
        for c in list((getattr(tr, "contracts", None) or {}).values()):
            if c.status != "complete" or not c.closed_at or c.id in self._credited:
                continue
            d = now - c.closed_at
            if not -CONTRACT_WINDOW[1] <= d <= -CONTRACT_WINDOW[0]:        # paid up to 10 min after, or 1 min before the log says
                continue
            fits = self._pays(c, delta)
            if fits is False:
                continue                                                    # far more than it ever pays: not this one
            key = (0 if fits else 1, abs(d))
            if best_key is None or key < best_key:
                best, best_key = c, key
        return best

    def _finish(self, s):
        """A session that ended goes into the history (if there was anything to it)."""
        if s.get("started") and (s.get("in_game_s") or 0) >= 60:
            h = {k: s.get(k) for k in ("started", "last", "in_game_s", "flying_s", "distance_m", "top_speed", "h2_used",
                                       "deaths", "downs", "earned", "spent", "contracts")}
            h["ships"] = list(s.get("ships") or [])[:12]
            self.history = [x for x in self.history if x.get("started") != h["started"]] + [h]
            del self.history[:-HISTORY]
            self.dirty = True

    def merge(self, entries=None, sessions=None):
        """Put the server's copy together with this PC's (the same balance change once: its time and amount).
        Returns True when anything new came in."""
        with self.lock:
            n0, h0 = len(self.log), len(self.history)
            have = {(round(e.get("t") or 0, 1), e.get("delta")): i for i, e in enumerate(self.log)}
            relabelled = 0
            for e in entries or []:
                if not isinstance(e, dict) or not e.get("t"):
                    continue
                k = (round(e["t"], 1), e.get("delta"))
                if k not in have:
                    have[k] = len(self.log)
                    self.log.append(e)
                elif e.get("kind") == "contract" and self.log[have[k]].get("kind") != "contract":
                    self.log[have[k]] = e              # another PC tied it to its contract: that copy wins
                    relabelled += 1
            self.log.sort(key=lambda e: e.get("t") or 0)
            del self.log[:-KEEP]
            seen = {x.get("started") for x in self.history}
            for h in sessions or []:
                if isinstance(h, dict) and h.get("started") and h["started"] not in seen and h["started"] != self.s.get("started"):
                    self.history.append(h)
                    seen.add(h["started"])
            self.history.sort(key=lambda x: x.get("started") or 0)
            del self.history[:-HISTORY]
            changed = len(self.log) != n0 or len(self.history) != h0 or relabelled > 0
        if changed:
            self._save()
        return changed

    def snapshot(self):
        """What goes to the server: the log, the finished sessions and the one running now."""
        with self.lock:
            return {"entries": list(self.log), "sessions": list(self.history), "session": dict(self.s, ships=list(self.s["ships"]))}

    def _save(self):
        with self.lock:
            data = {"entries": list(self.log), "sessions": list(self.history), "session": dict(self.s, ships=list(self.s["ships"]))}
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
        hist = list(self.history)
        life = {k: sum((x.get(k) or 0) for x in hist + [s]) for k in ("in_game_s", "flying_s", "distance_m", "earned", "spent", "contracts", "deaths")}
        return {"session": {**s, "ships": list(s["ships"]), "net": (s["earned"] or 0) - (s["spent"] or 0),
                            "active": bool(s["last"] and now - s["last"] < 60)},
                "history": hist[-12:][::-1], "lifetime": life, "sessions_n": len(hist) + (1 if s.get("started") else 0),
                "today": sum(e["delta"] for e in ins if e["t"] >= day),
                "week": sum(e["delta"] for e in ins if e["t"] >= week),
                "entries": log[-200:][::-1]}

    def clear_log(self):
        with self.lock:
            self.log = []
        self._save()
