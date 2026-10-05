"""Stations without published positions, placed with /showlocation. Mostly gateway stations: the stations at the jump points between systems, where you dock, shop and refuel
before jumping. The game names each one after the system it leads to ("Pyro Gateway" in Stanton).

Current game (4.10): Stanton - Pyro, Pyro - Nyx, and a temporary Stanton - Nyx link that reuses the
old Stanton - Magnus gate (Stanton's "Magnus Gateway" is now "Nyx Gateway"). Terra Gateway has a station
but its jump point isn't open.

Positions:
  - Stanton: from the starnav community data (Pyro Gateway: the station itself; Nyx and Terra
    Gateway: the jump point, with the station a short hop away).
  - Pyro and Nyx: no community dataset has them yet. Dock at the station, type /showlocation and press
    "I'm here: set position" on its card. Quantum saves it to places.json (shareable), and positions
    added to KNOWN_POS below ship with Quantum.

Same-named stations in two systems are told apart the way the rest of the map does it: "(System)".
"""
import json
import time
from pathlib import Path

from nav_core import Location

# name in Quantum -> (system, leads to, position or None, note)
GATEWAYS = {
    "Pyro Gateway": ("Stanton", "Pyro", (3310484799.0, -27979313941.0, -2676300515.0), ""),
    "Nyx Gateway": ("Stanton", "Nyx", (-62284273860.7205, 23467618051.3957, 20198396608.0),
                    "Temporary link to Nyx through the old Magnus gate. Position is the jump point's; "
                    "the station is close by"),
    "Terra Gateway": ("Stanton", "Terra", (51118221616.9033, -5269981303.11381, -4339551619.0),
                      "The jump point to Terra isn't open yet. Position is the jump point's; the station "
                      "is close by"),
    "Stanton Gateway (Pyro)": ("Pyro", "Stanton", None, ""),
    "Nyx Gateway (Pyro)": ("Pyro", "Nyx", None, ""),
    "Pyro Gateway (Nyx)": ("Nyx", "Pyro", None, ""),
    "Stanton Gateway (Nyx)": ("Nyx", "Stanton", None, ""),
}
# Other stations no community dataset has a position for yet: name -> (system, near body, note).
# Wikelo's three emporiums; his collection contracts can be turned in at any of them.
STATIONS = {
    "Wikelo Emporium Dasi Station": ("Stanton", "Hurston", "Wikelo Emporium: asteroid base near Hurston"),
    "Wikelo Emporium Selo Station": ("Stanton", "Yela", "Wikelo Emporium: asteroid base near Yela (Crusader)"),
    "Wikelo Emporium Kinga Station": ("Stanton", "microTech", "Wikelo Emporium: asteroid base near microTech"),
}
WIKELO = [n for n in STATIONS if n.startswith("Wikelo Emporium")]
# Measured positions that ship with Quantum (from /showlocation at the station): name -> (x, y, z)
KNOWN_POS = {
    "Wikelo Emporium Kinga Station": (23761435998.552826, 39225376833.414856, 492.206296),   # Sam, 4.10.1
}
RENAMED = {"Magnus Gateway": "Nyx Gateway"}   # older Quantum names -> current ones


def system_of(name):
    """System of a station you can place with /showlocation (gateways and STATIONS), else None."""
    g = GATEWAYS.get(name) or STATIONS.get(name)
    return g[0] if g else None


def near_body(name):
    return STATIONS[name][1] if name in STATIONS else None


def leads_to(name):
    g = GATEWAYS.get(name)
    return g[1] if g else None


def load_learned(path):
    try:
        return json.loads(Path(path).read_text(encoding="utf-8")).get("places", {})
    except Exception:
        return {}


def save_learned(path, name, system, pos):
    places = load_learned(path)
    places[name] = {"system": system, "pos": list(pos), "at": time.time()}
    Path(path).write_text(json.dumps({"places": places}, indent=1), encoding="utf-8")


def _auto_note(text):
    return not text or text.startswith(("Gateway", "Temporary link", "The jump point"))


def apply(db, learned=None):
    """Put every gateway station in the database. Returns ({old name: new name}, {name: Location}),
    the second being the stations whose position isn't known yet (kept off the map, still searchable)."""
    learned = learned or {}
    renamed = {}
    for old, new in RENAMED.items():
        loc = db.locations.get(old)
        if loc and loc.source == "db" and new not in db.locations:
            db.locations[new] = db.locations.pop(old)
            loc.name = new
            renamed[old] = new
    unplaced = {}
    for name, (system, to, pos, note) in GATEWAYS.items():
        how = "community data"
        l = learned.get(name)
        if l and l.get("system") == system and l.get("pos"):
            pos, how = tuple(l["pos"]), "your /showlocation"
        elif pos is None and name in KNOWN_POS:
            pos, how = KNOWN_POS[name], "a /showlocation at the station"
        notes = note or f"Gateway station: jump point to {to}"
        if pos is not None and how != "community data":
            notes += f". Position from {how}"
        existing = db.locations.get(name)
        if pos is None:
            if existing and existing.source == "db":
                db.locations.pop(name)
            unplaced[name] = Location(name, "space", None, None, notes=notes + ". Position not known yet",
                                      source="db", system=system, qt=True, category="jump")
            continue
        if existing and existing.source != "db":
            continue                              # a waypoint of yours with that name: leave it alone
        if existing:
            if _auto_note(existing.notes):          # keep notes you wrote yourself
                existing.notes = notes
            existing.pos, existing.system = tuple(pos), system
            existing.qt, existing.category, existing.kind, existing.body = True, "jump", "space", None
        else:
            db.locations[name] = Location(name, "space", tuple(pos), None, notes=notes, source="db",
                                          system=system, qt=True, category="jump")
    for name, (system, near, note) in STATIONS.items():
        l = learned.get(name)
        pos = tuple(l["pos"]) if l and l.get("system") == system and l.get("pos") else KNOWN_POS.get(name)
        existing = db.locations.get(name)
        if existing and existing.source != "db":
            continue
        if pos is None:
            db.locations.pop(name, None)
            unplaced[name] = Location(name, "space", None, None, notes=note + ". Position not known yet",
                                      source="db", system=system, qt=True, category="station")
        elif existing:
            existing.pos, existing.kind, existing.body = tuple(pos), "space", None
        else:
            db.locations[name] = Location(name, "space", tuple(pos), None, notes=note, source="db",
                                          system=system, qt=True, category="station")
    return renamed, unplaced
