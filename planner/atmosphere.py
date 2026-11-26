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
CONFIRMED = {"Hurston": True, "Bloom": True, "ArcCorp": True}   # ArcCorp: Area18 is all city, never 1.5 km from a place

STALE_S = 15          # a telemetry reading older than this isn't "now"
AWAY_M = 1500         # this far from every known place on the body, you're outside, not in a building


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
        # By a building you may be inside it, breathing its air: a "breathable" reading there could be the room's.
        # "Not breathable" can't be a room's, so it counts anywhere you're on foot (outside an outpost, say).
        if ok:
            near = any(l.body == body and l.kind == "surface" and l.pos is not None and dist(tuple(l.pos), tuple(local)) < AWAY_M
                       for l in db.locations.values())
            if near:
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
