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

from nav_core import SYSTEMS, Location

# name in Quantum -> (system, leads to, position or None, note)
GATEWAYS = {
    "Pyro Gateway": ("Stanton", "Pyro", (3310484799.0, -27979313941.0, -2676300515.0), ""),
    "Nyx Gateway": ("Stanton", "Nyx", (-62284229191.638901, 23467598946.457104, 20198395415.087944),
                    "Gateway station for the temporary link to Nyx (the old Magnus gate). The jump point "
                    "itself is Nyx Jump Point, about 50 km away. Position from a /showlocation at the station"),
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
    # From the game files (Star Citizen Wiki's starmap_positions.json, Sept 2026). The station's map
    # marker: a /showlocation docked at Stanton Gateway (Nyx) came out 2.6 km from it.
    "Stanton Gateway (Nyx)": (-13499931610.0, -23382701964.0, -36662.0),
    "Pyro Gateway (Nyx)": (-12000044530.0, 20784580529.0, -38674.0),
    "Nyx Gateway (Pyro)": (32993982419.0, -38151730073.0, 6728.0),
    "Stanton Gateway (Pyro)": (-37609223453.0, 37435743642.0, 6728.0),
}
FROM_GAME_FILES = {"Stanton Gateway (Nyx)", "Pyro Gateway (Nyx)", "Nyx Gateway (Pyro)", "Stanton Gateway (Pyro)"}
RENAMED = {"Magnus Gateway": "Nyx Gateway"}   # older Quantum names -> current ones

# Jump points drawn apart from their gateway station, where the two positions are both known
# (the station is tens of km from the wormhole): name -> (system, leads to, position, note).
JUMP_POINTS = {
    "Nyx Jump Point": ("Stanton", "Nyx", (-62284273860.7205, 23467618051.3957, 20198396608.0),
                       "The wormhole to Nyx (temporary link through the old Magnus gate). "
                       "Nyx Gateway station is about 50 km away"),
    # The rest from the game files (Star Citizen Wiki data); each is tens of km from its gateway.
    "Pyro Jump Point": ("Stanton", "Pyro", (3310491640.0, -27979408221.0, -2676285679.0),
                        "The wormhole to Pyro. Pyro Gateway station is close by"),
    "Stanton Jump Point (Pyro)": ("Pyro", "Stanton", (-37609204291.0, 37435781484.0, 0.0),
                                  "The wormhole to Stanton. Stanton Gateway station is close by"),
    "Nyx Jump Point (Pyro)": ("Pyro", "Nyx", (32994001581.0, -38151692231.0, 0.0),
                              "The wormhole to Nyx. Nyx Gateway station is close by"),
    "Pyro Jump Point (Nyx)": ("Nyx", "Pyro", (-12000043845.0, 20784584131.0, 0.0),
                              "The wormhole to Pyro. Pyro Gateway station is close by"),
    "Stanton Jump Point (Nyx)": ("Nyx", "Stanton", (-13499935650.0, -23382715138.0, 0.0),
                                 "The wormhole to Stanton (the game files call it the Castra jump point; "
                                 "it's the temporary Stanton link). Stanton Gateway station is close by"),
}
# Gateways that have their own jump point marker are drawn (and routed to) as stations.
STATION_GATEWAYS = {"Nyx Gateway", "Pyro Gateway", "Stanton Gateway (Pyro)", "Nyx Gateway (Pyro)",
                    "Pyro Gateway (Nyx)", "Stanton Gateway (Nyx)"}


def system_of(name):
    """System of a station you can place with /showlocation (gateways and STATIONS), else None."""
    g = GATEWAYS.get(name) or STATIONS.get(name)
    return g[0] if g else None


def near_body(name):
    return STATIONS[name][1] if name in STATIONS else None


def leads_to(name):
    g = GATEWAYS.get(name) or JUMP_POINTS.get(name)
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
    return not text or text.startswith(("Gateway", "Temporary link", "The jump point", "The wormhole"))


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
            pos, how = KNOWN_POS[name], ("the game files (Star Citizen Wiki data)" if name in FROM_GAME_FILES
                                         else "a /showlocation at the station")
        notes = note or f"Gateway station: jump point to {to}"
        cat = "station" if name in STATION_GATEWAYS else "jump"
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
            existing.qt, existing.category, existing.kind, existing.body = True, cat, "space", None
        else:
            db.locations[name] = Location(name, "space", tuple(pos), None, notes=notes, source="db",
                                          system=system, qt=True, category=cat)
    for name, (system, to, pos, note) in JUMP_POINTS.items():
        existing = db.locations.get(name)
        if existing and existing.source != "db":
            continue
        if existing:
            existing.pos, existing.system, existing.kind, existing.body = tuple(pos), system, "space", None
            existing.qt, existing.category = True, "jump"
            if _auto_note(existing.notes):
                existing.notes = note
        else:
            db.locations[name] = Location(name, "space", tuple(pos), None, notes=note, source="db",
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


# ---------------------------------------------------------------- routing between systems
# A route that goes from one system to another goes through a gateway: fly to the gateway station in the
# system you're in, jump, and you come out at the gateway in the other system that leads back. Systems
# without a direct link are reached through the one in between (Stanton -> Pyro -> Nyx, when the
# temporary Stanton - Nyx link is closed). Built from what's actually on the map, so a gateway whose
# position isn't known yet isn't used.

def _gate_names(db, frm, to):
    """Places in system `frm` you jump from to reach system `to`: the gateway station first (it's the
    quantum marker you fly to), then the jump point itself. Only ones with a position."""
    out = []
    for table in (GATEWAYS, JUMP_POINTS):
        for name, entry in table.items():
            loc = db.locations.get(name)
            if entry[0] == frm and entry[1] == to and loc is not None and loc.pos is not None \
                    and loc.system == frm and name not in out:
                out.append(name)
    return out


def links(db):
    """{system: {systems you can jump to from it}}, from the gateways on the map."""
    out = {}
    for table in (GATEWAYS, JUMP_POINTS):
        for name, entry in table.items():
            frm, to = entry[0], entry[1]
            if to in SYSTEMS and frm in SYSTEMS and _gate_names(db, frm, to):
                out.setdefault(frm, set()).add(to)
    return out


def gate_path(db, frm, to):
    """Gateways to fly to, in order, to get from system `frm` to system `to`: one per jump, each in the
    system you're in at that point. [] if it's the same system, None if there's no way through."""
    if not frm or not to or frm == to:
        return []
    graph, prev, queue = links(db), {frm: None}, [frm]
    while queue:
        cur = queue.pop(0)
        if cur == to:
            break
        for nxt in sorted(graph.get(cur, ())):
            if nxt not in prev:
                prev[nxt] = cur
                queue.append(nxt)
    if to not in prev:
        return None
    hops, cur = [], to
    while prev[cur] is not None:
        hops.append((prev[cur], cur))
        cur = prev[cur]
    return [_gate_names(db, a, b)[0] for a, b in reversed(hops)]


def arrival(db, gate_name, frm):
    """Where you come out after jumping through `gate_name` (which is in system `frm`): the gateway on
    the other side that leads back to `frm`. None if unknown."""
    to = leads_to(gate_name)
    names = _gate_names(db, to, frm) if to else []
    return names[0] if names else None
