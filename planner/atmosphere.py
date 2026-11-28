"""Can you breathe on a planet or moon? Shown on its card.

Three sources, the game's own reading first:
  1. What the game's telemetry said when you were out on foot there (its environment "breathable" flag).
     Quantum remembers it per body (atmosphere.json next to Quantum). Only readings taken on foot or in EVA,
     away from any known place on that body, count: inside a hab, an outpost, a station or a ship the air is
     the building's, not the planet's.
  2. The game files: atmosphere_bodies.json, built from Data.p4k by tools/build_atmospheres.py (the game's
     breathable flag, or oxygen and pressure) and bundled with the build like game_bodies.json.
  3. Otherwise the Star Citizen Wiki's description of the body (starcitizen.tools, CC BY-SA 4.0). Bodies the
     wiki doesn't describe say "Not known yet" until someone walks around outside there.

Statuses: "yes" breathable, "high" breathable only high up (Crusader), "harmful" breathable but bad for you
over time, "thin" too thin to breathe (pressure suits can top up their oxygen from it), "no" toxic or none.
"""
from __future__ import annotations

import json
import time
from pathlib import Path

LABEL = {"yes": "Breathable", "high": "Breathable high up", "harmful": "Breathable, harmful over time",   # noqa
         "thin": "Too thin to breathe", "no": "Not breathable", None: "Not known yet"}

# From the wiki's body pages (Nov 2026). Keep the note short: it's one line on the card.
WIKI = {
    "microTech": ("yes", "Nitrogen-oxygen air; very cold, dress for it"),
    "Crusader": ("high", "Gas giant: breathable at the altitude of its floating platforms (Orison)"),
    "Yela": ("yes", "Oxygen atmosphere, breathable since Alpha 3.17.2"),
    "Daymar": ("no", "Toxic nitrogen-methane atmosphere, extreme temperatures"),
    "Cellin": ("thin", "Thin and toxic; suits can draw oxygen from it"),
    "Magda": ("no", "Toxic nitrogen atmosphere; breathing gear required"),
    "Lyria": ("thin", "About 0.09 atm, mostly oxygen; suits can draw oxygen from it"),
    "Wala": ("thin", "About 0.09 atm; suits can draw oxygen from it"),
    "Euterpe": (None, "Frigid: survival gear required outdoors"),
    "Bloom": ("yes", "Naturally breathable nitrogen-oxygen air"),
    "Terminus": ("harmful", "Enough oxygen to breathe, but methane and CO2 harm you over time"),
    "Monox": ("no", "Part-oxygen, with toxic carbon monoxide"),
}

CHEM = {"N2": "nitrogen", "O2": "oxygen", "CO2": "carbon dioxide", "CO": "carbon monoxide", "CH4": "methane",
        "NH3": "ammonia", "H2": "hydrogen", "He": "helium", "Ar": "argon", "SO2": "sulphur dioxide", "SO": "sulphur monoxide",
        "HCN": "hydrogen cyanide", "H2O2": "hydrogen peroxide", "NaCl": "salt", "PM": "fine dust", "Sarin": "sarin"}


def _mix_note(f, plain=False) -> str:
    """'0.90 atm · 78% nitrogen, 21% oxygen' from the game files' gas mix."""
    parts = []
    if f.get("quality") is not None and not plain:
        parts.append(f"air quality {int(f['quality'] * 100)}%")   # floored: 94.5% isn't 95%
    if f.get("pressure_atm") is not None:
        parts.append(f"{f['pressure_atm']:.2f} atm")
    g = sorted((f.get("gases") or {}).items(), key=lambda x: -x[1])
    mix = ", ".join(f"{round(x * 100) if x >= 0.01 else '<1'}% {CHEM.get(k, k)}" for k, x in g[:3] if x > 0)
    if mix:
        parts.append(mix)
    if plain:
        pass
    elif f.get("toxic"):
        parts.append("toxic: " + ", ".join(CHEM.get(k, k) for k in f["toxic"]))
    elif f.get("harmful_gases"):
        parts.append("some " + ", ".join(CHEM.get(k, k) for k in f["harmful_gases"]))
    if f.get("temp_c") is not None:
        parts.append(f"{f['temp_c']} °C")
    return " · ".join(parts)


def _props(f):
    """Atmosphere Properties for a confirmed body's card, from the game files: every gas in the mix with its
    share (largest first), plus pressure and temperature. None when the files have no mix for it."""
    if not f or not f.get("gases"):
        return None
    gases = [[CHEM.get(k, k).capitalize(), round(x * 100, 1)] for k, x in sorted(f["gases"].items(), key=lambda x: -x[1])
             if x > 0]
    return {"gases": gases, "pressure_atm": f.get("pressure_atm"), "temp_c": f.get("temp_c")}


# Confirmed by players in game (no helmet needed). The game's own files can disagree: Bloom's gas-mix record is
# 68% CO2 and 9% oxygen, which its breathing rules call unbreathable, yet you breathe fine there. So what players
# see in game wins over the files; your own telemetry reading (on foot, outside) wins over this list.
# Add a body here once it's confirmed: True = breathable without a helmet, False = you need one.
CONFIRMED = {"Hurston": True, "Bloom": True, "ArcCorp": True,  # ArcCorp: Area18 is all city, never 1.5 km from a place
             "Arial": False, "Ariel": False}   # no air at all (Sam, in game): the "breathable" it once showed was his ship's cabin

STALE_S = 15          # a telemetry reading older than this isn't "now"
AWAY_M = 1500         # this far from every known place on the body, you're outside, not in a building
HOLD_S = 8            # the same answer this long, on foot, before it counts: spawning, a lift or a loading
                      # screen can say "not breathable" for a moment (Lorville once came out Not breathable)
HOLD_BREATHABLE_S = 45  # "breathable" has to hold longer: walking about inside your ship, its cabin air reads
                        # breathable too, and that's the mistake that's easy to make (Ariel came out Breathable)


def _atm(p):
    """The telemetry's pressure in atm (it may come in kPa)."""
    try:
        p = float(p)
    except (TypeError, ValueError):
        return None
    return p / 101.325 if p > 20 else p


def cabin_air(body, f, actor) -> str | None:
    """Why a "breathable" reading on foot is the air of a ship, hab or room rather than the planet's, or None.
    The game's breathable flag is about the air around you, and indoors that's the room's: walking about your
    landed ship on an airless moon reads breathable. Told apart by what the reading says next to what's known
    of the body: a moon's low gravity (a ship's or building's gravity generator gives a full 1 g), the game
    files' surface pressure (a cabin is ~1 atm), or an airless body."""
    if CONFIRMED.get(body.name) is False:
        return "confirmed not breathable"
    g = (actor or {}).get("gravity")
    if body.kind == "moon" and isinstance(g, (int, float)) and g >= 0.85:
        return f"{g:.2f} g on a moon: a gravity generator, so indoors"
    pa = (f or {}).get("pressure_atm")
    if isinstance(pa, (int, float)) and pa < 0.05:
        return "no atmosphere in the game files"
    if f and "gases" in f and not any((x or 0) > 0 for x in (f.get("gases") or {}).values()):
        return "no air in the game files"
    rp = _atm((actor or {}).get("pressure"))
    if isinstance(pa, (int, float)) and rp is not None and abs(rp - pa) > max(0.3, pa * 0.5):
        return f"{rp:.2f} atm around you, {pa:.2f} atm outside: indoors"
    return None


class Atmosphere:
    def __init__(self, path: Path, files=()):
        self.path = Path(path)
        self.seen: dict[str, dict] = {}
        self.files: dict[str, dict] = {}
        for f in files:                                   # bundled first, then a newer copy next to Quantum
            try:
                for n, r in (json.loads(Path(f).read_text(encoding="utf-8")).get("bodies") or {}).items():
                    if isinstance(r, dict) and (r.get("breathable") is not None or r.get("status")):
                        self.files[n] = r
            except Exception:
                pass
        self.community: dict[str, dict] = {}            # agreed on the Quantum server (everyone's readings)
        self.waiting: dict[str, int] = {}                 # bodies with readings, not agreed yet: {body: people}
        try:
            d = json.loads(self.path.read_text(encoding="utf-8"))
            self.seen = d.get("bodies", {})
            self.community = d.get("community", {}) or {}
        except Exception:
            self.seen = {}
        self._pend = None                                 # (body, answer, since): a reading not held long enough yet
        # A reading that says a hand-confirmed body is the opposite (Hurston "not breathable") was a glitch: drop it
        # and a "breathable" kept from before cabin_air existed, on a body whose files say it has no air
        bad = [b for b, r in self.seen.items() if (b in CONFIRMED and bool(r.get("breathable")) != CONFIRMED[b])
               or (r.get("breathable") and self._airless(b))]
        for b in bad:
            del self.seen[b]
        if bad:
            self._save()

    def _airless(self, name) -> bool:
        f = self.files.get(name) or {}
        pa = f.get("pressure_atm")
        return (isinstance(pa, (int, float)) and pa < 0.05) or ("gases" in f and not any(
            (x or 0) > 0 for x in (f.get("gases") or {}).values()))

    def _save(self):
        try:
            tmp = self.path.with_suffix(".tmp")
            tmp.write_text(json.dumps({"bodies": self.seen, "community": self.community}, indent=1), encoding="utf-8")
            tmp.replace(self.path)
        except Exception:
            pass

    def set_community(self, agreed: dict, waiting: dict) -> bool:
        """The Quantum server's agreed answers (/v1/breathability). True if anything changed."""
        agreed = {b: {k: v for k, v in a.items() if k in ("breathable", "build", "reporters", "at")}
                  for b, a in (agreed or {}).items() if isinstance(a, dict) and isinstance(a.get("breathable"), bool)}
        waiting = {b: int(n) for b, n in (waiting or {}).items() if isinstance(n, (int, float))}
        if agreed == self.community and waiting == self.waiting:
            return False
        self.community, self.waiting = agreed, waiting
        self._save()
        return True

    def learn(self, db, player: dict | None, actor: dict | None, age: float | None) -> bool:
        """Remember a body's air from a live telemetry reading taken outside. True if anything changed."""
        if not player or not actor or actor.get("breathable") is None or (age is not None and age > STALE_S):
            return False
        if actor.get("locomotion") not in ("on_foot", "eva"):
            return False                                  # in a seat: it's the ship's air
        body, local = player.get("body"), player.get("local")
        if not body or not local or body not in db.bodies:
            return False
        from planner.nav_core import dist
        ok = bool(actor["breathable"])
        now = time.time()
        if ok and cabin_air(db.bodies[body], self.files.get(body), actor):
            self._pend = None                             # the cabin's air, not the planet's: not a reading of it
            return False
        if not self._pend or self._pend[0] != body or self._pend[1] != ok or now - self._pend[3] > STALE_S:
            self._pend = [body, ok, now, now]             # a new answer: it has to hold for HOLD_S first
            return False
        self._pend[3] = now
        if now - self._pend[2] < (HOLD_BREATHABLE_S if ok else HOLD_S):
            return False
        near = any(l.body == body and l.kind == "surface" and l.pos is not None and dist(tuple(l.pos), tuple(local)) < AWAY_M
                   for l in db.locations.values())
        # By a building you may be inside it, breathing its air: a "breathable" reading there could be the room's.
        # "Not breathable" can't be a room's, so it counts anywhere you're on foot (outside an outpost, say), except
        # against a body players have confirmed breathable by hand: by a city that's a glitch, not the air.
        if near and (ok or CONFIRMED.get(body) is True):
            return False
        b = db.bodies[body]
        alt = (sum(c * c for c in local) ** 0.5) - b.radius_m
        if alt > b.radius_m * 0.5:
            return False                                  # not down on it
        have = self.seen.get(body)
        if have and have.get("breathable") == ok and time.time() - have.get("at", 0) < 86400:
            return False
        self.seen[body] = {"breathable": ok, "at": time.time(), "pressure": actor.get("pressure"),
                           "temp": actor.get("outside_temp"), "alt_m": round(alt)}
        self._save()
        return True

    def view(self, body) -> dict:
        """For a body's card: {status, label, note, mix, source, confirmed}. Confirmed answers come from the game
        itself: your own reading there (telemetry, on foot outside), the Quantum server's (enough players'
        readings agree), or a body players have confirmed by hand (CONFIRMED). Anything else is "Not confirmed
        yet" (confirmed False, status None), with what the game files suggest as a hint only; place cards
        show nothing until a body is confirmed."""
        f = self.files.get(body.name)
        wiki = WIKI.get(body.name)
        if body.kind in ("star", "asteroid"):
            return {"status": None, "label": "", "note": "", "props": None, "source": None, "confirmed": False}  # not shown

        def answer(ok, source, note):
            # breathable: the game files' grade if they agree (Hurston: the HUD warns), else plainly breathable
            if ok:
                st = f.get("status") if f and f.get("status") in ("yes", "harmful") else "yes"
                if body.name == "Crusader" and st == "yes":
                    st = "high"
            else:
                st = "thin" if f and f.get("status") == "thin" else "no"
            label = {"harmful": "Breathable", "thin": "Too thin to breathe", "no": "Not breathable"}.get(st, LABEL[st])
            if st == "thin" and f and f.get("pressure_atm") is not None:
                label += f" · {f['pressure_atm']:.2f} atm"      # why: thin air can still be mostly oxygen (Lyria, Wala)
            return {"status": st, "label": label, "note": note, "mix": "", "props": _props(f), "source": source,
                    "confirmed": True}

        s = self.seen.get(body.name)
        if s:
            out = answer(bool(s["breathable"]), "game", "")
            c = self.community.get(body.name)
            if c and bool(c["breathable"]) != bool(s["breathable"]):
                out["note"] = f"Other players found it {'breathable' if c['breathable'] else 'not breathable'}"
            return out
        c = self.community.get(body.name)
        if c:
            return answer(bool(c["breathable"]), "community", "")
        ok = CONFIRMED.get(body.name)
        if ok is not None:
            return answer(ok, "confirmed", "")
        # not confirmed yet: what the files suggest, as a hint
        hint = ""
        if f and f.get("status") in LABEL:
            hint = "Game files suggest: " + {"yes": "breathable", "harmful": "breathable", "thin": "too thin",
                                             "no": "not breathable"}[f["status"]]
        elif wiki:
            hint = "The wiki says: " + wiki[1]
        n = self.waiting.get(body.name, 0)
        note = (f"{n} player{'s' if n != 1 else ''} checked so far; confirmed once another agrees" if n else
                "Walk around outside there with telemetry on to confirm it")
        return {"status": None, "label": "Not confirmed yet", "note": note, "mix": hint, "props": None, "source": None,
                "confirmed": False}
