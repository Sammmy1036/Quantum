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


def _mix_note(f) -> str:
    """'0.90 atm · 78% nitrogen, 21% oxygen' from the game files' gas mix."""
    parts = []
    if f.get("pressure_atm") is not None:
        parts.append(f"{f['pressure_atm']:.2f} atm")
    g = sorted((f.get("gases") or {}).items(), key=lambda x: -x[1])
    mix = ", ".join(f"{round(x * 100) if x >= 0.01 else '<1'}% {CHEM.get(k, k)}" for k, x in g[:3] if x > 0)
    if mix:
        parts.append(mix)
    if f.get("toxic"):
        parts.append("toxic: " + ", ".join(CHEM.get(k, k) for k in f["toxic"]))
    elif f.get("harmful_gases"):
        parts.append("harmful: " + ", ".join(CHEM.get(k, k) for k in f["harmful_gases"]))
    if f.get("temp_c") is not None:
        parts.append(f"{f['temp_c']} °C")
    return " · ".join(parts)


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
        try:
            self.seen = json.loads(self.path.read_text(encoding="utf-8")).get("bodies", {})
        except Exception:
            self.seen = {}

    def _save(self):
        try:
            tmp = self.path.with_suffix(".tmp")
            tmp.write_text(json.dumps({"bodies": self.seen}, indent=1), encoding="utf-8")
            tmp.replace(self.path)
        except Exception:
            pass

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
        near = any(l.body == body and l.kind == "surface" and l.pos is not None and dist(tuple(l.pos), tuple(local)) < AWAY_M
                   for l in db.locations.values())
        if near:
            return False                                  # by a building: maybe inside it
        b = db.bodies[body]
        alt = (sum(c * c for c in local) ** 0.5) - b.radius_m
        if alt > b.radius_m * 0.5:
            return False                                  # not down on it
        ok = bool(actor["breathable"])
        have = self.seen.get(body)
        if have and have.get("breathable") == ok and time.time() - have.get("at", 0) < 86400:
            return False
        self.seen[body] = {"breathable": ok, "at": time.time(), "pressure": actor.get("pressure"),
                           "temp": actor.get("outside_temp"), "alt_m": round(alt)}
        self._save()
        return True

    def view(self, body) -> dict:
        """{status, label, note, source} for a body's card."""
        s = self.seen.get(body.name)
        wiki = WIKI.get(body.name)
        if s:
            st = "yes" if s["breathable"] else "no"
            if body.name == "Crusader" and s["breathable"]:
                st = "high"
            if wiki and not s["breathable"] and wiki[0] == "thin":
                st = "thin"
            note = wiki[1] if wiki else ""
            return {"status": st, "label": LABEL[st], "note": note, "source": "game",
                    "at": s.get("at"), "pressure": s.get("pressure"), "temp": s.get("temp")}
        f = self.files.get(body.name)
        if f:
            atm = f.get("pressure_atm")
            st = f.get("status")                          # yes / harmful / thin / no (tools/build_atmospheres.py)
            if st not in LABEL:
                st = "yes" if f["breathable"] else ("thin" if not f.get("toxic") and atm is not None and atm < 0.3 else "no")
            if body.name == "Crusader" and st == "yes":
                st = "high"
            return {"status": st, "label": LABEL[st], "note": _mix_note(f), "source": "files", "pressure": atm,
                    "mix": wiki[1] if wiki else ""}
        if wiki:
            return {"status": wiki[0], "label": LABEL[wiki[0]], "note": wiki[1], "source": "wiki"}
        if body.kind in ("star", "asteroid"):
            return {"status": None, "label": "", "note": "", "source": None}     # not shown
        return {"status": None, "label": LABEL[None], "note": "Walk around outside there with telemetry on and Quantum will find out",
                "source": None}
