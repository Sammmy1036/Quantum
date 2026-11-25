"""Where you are between /showlocations, worked out from the game's telemetry.

Two estimates, both laid on top of your last real reading (never replacing it: calibrations, datarunner
readings and "you're here" checks still only use a real /showlocation):

  Flying near a planet or moon (DeadReckoner)
      From the last /showlocation, every telemetry frame moves you along your compass heading by your
      ground speed (speed with the climb taken out) over the time since the frame before, on the turning
      planet's own surface frame, and sets your height from the game's altitude. The heading is where the
      nose points, so sliding sideways, hovering in VTOL or strafing isn't seen: the error is taken as 30 m
      plus 8% of the distance flown, and grows for any stretch the telemetry went quiet. It stops (and the
      map goes back to your reading) once you climb out of the planet's space (above a fifth of its radius),
      go faster than atmospheric flight allows (quantum, or out in space), or 30 minutes after the reading.

  In a quantum jump (QuantumTrack)
      From where you were when the jump was selected to its destination, moved along by the speed the
      telemetry gives while the drive is engaged (above 20 km/s). With no speed coming in, there's no guess:
      the map waits for the arrival line in Game.log, which puts you at the destination as before.
"""
from __future__ import annotations

import math
import threading
import time

Vec = tuple[float, float, float]

MAX_AFTER_FIX_S = 1800       # an estimate this long after the reading is too loose to show
QUIET_S = 10                 # no telemetry frame for this long: not flying any more (or telemetry stopped)
ATMO_MAX_SPEED = 2500        # m/s: faster than this is quantum travel or open space, not flying over a planet
QT_MIN_SPEED = 20000         # m/s: the quantum drive is engaged
LEAVE_FRACTION = 0.2         # above radius * this, you've left the planet's space


def _norm(a):
    return math.sqrt(a[0] * a[0] + a[1] * a[1] + a[2] * a[2])


def _unit(a):
    n = _norm(a) or 1.0
    return (a[0] / n, a[1] / n, a[2] / n)


def step_on_sphere(u: Vec, heading_deg: float, angle: float) -> Vec:
    """Unit vector u moved `angle` radians along a great circle starting at compass heading (0 = north, the
    +z pole; 90 = east). The same north/east the map's heading arrow uses."""
    N = (-u[2] * u[0], -u[2] * u[1], 1 - u[2] * u[2])
    if _norm(N) < 1e-9:                                  # at a pole every way is south: pick one
        N = (1.0, 0.0, 0.0)
    N = _unit(N)
    E = _unit((-u[1], u[0], 0.0)) if math.hypot(u[0], u[1]) > 1e-9 else (0.0, 1.0, 0.0)
    h = math.radians(heading_deg)
    d = tuple(N[i] * math.cos(h) + E[i] * math.sin(h) for i in range(3))
    return _unit(tuple(u[i] * math.cos(angle) + d[i] * math.sin(angle) for i in range(3)))


class DeadReckoner:
    def __init__(self):
        self._lock = threading.Lock()
        self._a = None
        self.flying_at = 0.0        # when the last telemetry frame had you flying (not landed, moving)

    def anchor(self, body_name: str, radius_m: float, local: Vec, t: float):
        """A new real reading on a planet or moon: start again from it."""
        r = _norm(local)
        with self._lock:
            self._a = None if r <= 0 else {
                "body": body_name, "R": radius_m, "u": _unit(local), "r0": r, "r": r, "t": t,
                "alt0": None, "last": None, "moved": 0.0, "gap_err": 0.0, "frames": 0}

    def drop(self):
        with self._lock:
            self._a = None

    @property
    def body(self):
        a = self._a
        return a["body"] if a else None

    def frame(self, d: dict, now: float):
        """One telemetry frame (called from the telemetry thread)."""
        with self._lock:
            a = self._a
            if not a or now < a["t"]:
                return
            v = (d or {}).get("vehicle") or {}
            if not v or v.get("flight_data") is False or v.get("heading") is None or v.get("speed") is None:
                a["last"] = None                          # on foot, or a vehicle that sends no flight data
                return
            speed, vs, alt = float(v["speed"]), float(v.get("vspeed") or 0.0), v.get("altitude")
            self.flying_at = now if (not v.get("landed") and speed > 3) else 0.0   # for "is the log's landing real?"
            if speed > ATMO_MAX_SPEED:
                self._a = None                            # quantum, or out in space: this estimate is over
                return
            if a["alt0"] is None and alt is not None:
                a["alt0"] = float(alt)                    # the game's altitude when the reading was taken
            if a["last"] is None:
                a["last"] = now
                return
            dt, a["last"] = now - a["last"], now
            if dt <= 0:
                return
            if dt > 1.5:                                  # frames went missing: don't guess the stretch, widen the error
                a["gap_err"] += speed * (dt - 1.5)
                dt = 1.5
            a["frames"] += 1
            if v.get("landed"):
                return
            ground = math.sqrt(max(0.0, speed * speed - vs * vs))
            stepm = ground * dt
            if stepm > 0:
                a["u"] = step_on_sphere(a["u"], float(v["heading"]), stepm / a["r"])
                a["moved"] += stepm
            if alt is not None and a["alt0"] is not None:
                a["r"] = max(a["R"] * 0.9, a["r0"] + (float(alt) - a["alt0"]))
            else:
                a["r"] += vs * dt
            if a["r"] - a["R"] > a["R"] * LEAVE_FRACTION:
                self._a = None                            # climbed out of the planet's space

    def estimate(self, now: float | None = None) -> dict | None:
        """{body, local, moved_m, err_m, since_fix_s} once you've flown somewhere since the reading, else None."""
        now = now or time.time()
        with self._lock:
            a = self._a
            if not a or a["moved"] < 30 or now - a["t"] > MAX_AFTER_FIX_S:
                return None
            if a["last"] is None or now - a["last"] > QUIET_S:
                return None
            local = tuple(c * a["r"] for c in a["u"])
            return {"body": a["body"], "local": local, "moved_m": round(a["moved"]),
                    "err_m": round(30 + 0.08 * a["moved"] + a["gap_err"]), "since_fix_s": round(now - a["t"])}


class QuantumTrack:
    def __init__(self):
        self._lock = threading.Lock()
        self._j = None

    def begin(self, key, start: Vec, system: str):
        """A jump was selected (key: when). Tracks from where you were then."""
        with self._lock:
            if self._j and self._j["key"] == key:
                return
            self._j = {"key": key, "start": tuple(start), "system": system, "moved": 0.0, "last": None,
                       "speed": 0.0, "engaged": None}

    def end(self):
        with self._lock:
            self._j = None

    def frame(self, d: dict, now: float):
        with self._lock:
            j = self._j
            if not j:
                return
            v = (d or {}).get("vehicle") or {}
            sp = v.get("speed")
            if sp is None or float(sp) < QT_MIN_SPEED:
                j["last"] = None
                j["speed"] = 0.0
                return
            sp = float(sp)
            if j["last"] is not None:
                dt = min(2.0, max(0.0, now - j["last"]))
                j["moved"] += sp * dt
            else:
                j["engaged"] = j["engaged"] or now
            j["last"], j["speed"] = now, sp

    def estimate(self, dest: Vec | None, now: float | None = None) -> dict | None:
        """{pos, progress, eta_s, speed} along the way to `dest`, or None with no speed seen yet."""
        now = now or time.time()
        with self._lock:
            j = self._j
            if not j or dest is None or j["moved"] <= 0:
                return None
            s = j["start"]
            total = math.dist(s, dest)
            if total <= 0:
                return None
            f = min(0.995, j["moved"] / total)
            pos = tuple(s[i] + (dest[i] - s[i]) * f for i in range(3))
            sp = j["speed"] if j["last"] and now - j["last"] < QUIET_S else 0.0
            return {"pos": pos, "system": j["system"], "progress": round(f, 4),
                    "eta_s": max(0, round((total - j["moved"]) / sp)) if sp > 0 else None, "speed": round(sp)}
