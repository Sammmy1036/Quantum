"""Gateways (the jump points between systems) and the gateway stations next to them, plus a few other
stations no published dataset has a position for.

In game a Gateway is the jump point itself, the wormhole you fly into: "Pyro Gateway" in Stanton leads to
Pyro. Its station, where you dock, shop, refuel and pick up cargo, sits a short hop away and is a separate
place: "Pyro Gateway Station". Each has its own card: the station has the services, the Gateway has the
"Jump to" button and no services. Missions, UEX and the services data call the station by the Gateway's
name ("Pyro Gateway"), so those are matched to the station (see LEGACY and the matchers in services.py,
uex.py and gamelog.py).

Current game (4.10): Stanton - Pyro, Pyro - Nyx, and a temporary Stanton - Nyx link that reuses the
old Stanton - Magnus gate. Terra Gateway Station is open but its Gateway isn't.

Same-named places in two systems are told apart the way the rest of the map does it: "(System)".
"""
import json
import time
from pathlib import Path

from nav_core import SYSTEMS, Location

# Gateway stations. name in Quantum -> (system, leads to, position or None, note).
GATEWAYS = {
    "Pyro Gateway Station": ("Stanton", "Pyro", (3310484799.0, -27979313941.0, -2676300515.0), ""),
    "Nyx Gateway Station": ("Stanton", "Nyx", (-62284229191.638901, 23467598946.457104, 20198395415.087944),
                            "Gateway station for the temporary link to Nyx (the old Magnus gate). "
                            "Position from a /showlocation at the station"),
    "Terra Gateway Station": ("Stanton", "Terra", (51118210044.76286, -5270029473.660545, -4339552358.888522),
                              "Gateway station. Terra Gateway isn't open yet"),
    "Stanton Gateway Station (Pyro)": ("Pyro", "Stanton", None, ""),
    "Nyx Gateway Station (Pyro)": ("Pyro", "Nyx", None, ""),
    "Pyro Gateway Station (Nyx)": ("Nyx", "Pyro", None, ""),
    "Stanton Gateway Station (Nyx)": ("Nyx", "Stanton", None, ""),
}
# Other stations no community dataset has a position for yet: name -> (system, near body, note).
# Wikelo's three emporiums; his collection contracts can be turned in at any of them.
STATIONS = {
    "Wikelo Emporium Dasi Station": ("Stanton", "Hurston", "Wikelo Emporium: asteroid base near Hurston"),
    "Wikelo Emporium Selo Station": ("Stanton", "Yela", "Wikelo Emporium: asteroid base near Yela (Crusader)"),
    "Wikelo Emporium Kinga Station": ("Stanton", "microTech", "Wikelo Emporium: asteroid base near microTech"),
}
WIKELO = [n for n in STATIONS if n.startswith("Wikelo Emporium")]
# Pyro in the game files (the Star Citizen Wiki's starmap_positions.json) is rotated 85.23 deg from
# the game's own coordinates. Every Pyro position below taken from the game files has been turned
# into the in-game frame; the angle comes from a /showlocation at Stanton Gateway Station (Pyro) and
# agrees with Pyro I, Monox, Bloom and Pyro V to within a few km.
PYRO_FILE_ROTATION_DEG = -85.22993
# Measured positions that ship with Quantum (from /showlocation at the station): name -> (x, y, z)
KNOWN_POS = {
    "Wikelo Emporium Kinga Station": (23761435998.552826, 39225376833.414856, 492.206296),   # Sam, 4.10.1
    "Stanton Gateway Station (Pyro)": (34178602716.244999, 40592012681.869659, 5875.998474),  # Sam, 4.10
    # From the game files (Star Citizen Wiki's starmap_positions.json, Sept 2026). The station's map
    # marker: a /showlocation docked at Stanton Gateway Station (Nyx) came out 2.6 km from it.
    "Stanton Gateway Station (Nyx)": (-13499931610.0, -23382701964.0, -36662.0),
    "Pyro Gateway Station (Nyx)": (-12000044530.0, 20784580529.0, -38674.0),
    "Nyx Gateway Station (Pyro)": (-35275901220.5, -36052297797.3, 6727.8),     # game files, turned (see above)
}
FROM_GAME_FILES = {"Stanton Gateway Station (Nyx)", "Pyro Gateway Station (Nyx)", "Nyx Gateway Station (Pyro)"}
RENAMED = {"Magnus Gateway": "Nyx Gateway"}   # older Quantum names -> current ones

# The Gateways themselves (the jump points), each tens of km from its station.
# name -> (system, leads to, position, note).
JUMP_POINTS = {
    "Nyx Gateway": ("Stanton", "Nyx", (-62284273860.7205, 23467618051.3957, 20198396608.0),
                    "The jump point to Nyx (temporary link through the old Magnus gate)"),
    # The rest from the game files (Star Citizen Wiki data) unless noted.
    "Pyro Gateway": ("Stanton", "Pyro", (3310491640.0, -27979408221.0, -2676285679.0), "The jump point to Pyro"),
    "Terra Gateway": ("Stanton", "Terra", (51118221616.9033, -5269981303.11381, -4339551619.0),
                      "The jump point to Terra. Not open yet"),
    "Stanton Gateway (Pyro)": ("Pyro", "Stanton", (34178615254.810284, 40591999809.317162, 10973.401248),
                               "The jump point to Stanton. Position from a /showlocation there"),
    "Nyx Gateway (Pyro)": ("Pyro", "Nyx", (-35275861916.0, -36052313746.2, 0.0), "The jump point to Nyx"),
    "Pyro Gateway (Nyx)": ("Nyx", "Pyro", (-12000043845.0, 20784584131.0, 0.0), "The jump point to Pyro"),
    "Stanton Gateway (Nyx)": ("Nyx", "Stanton", (-13499935650.0, -23382715138.0, 0.0),
                              "The jump point to Stanton (the game files call it the Castra jump point; "
                              "it's the temporary Stanton link)"),
}
# Names earlier versions of Quantum used. Stations used to have the Gateway's name and Gateways were
# "... Jump Point": positions saved under an old station name (places.json, the community's) belong to
# the station; old map entries under these names are replaced.
LEGACY_STATION = {st.replace(" Station", ""): st for st in GATEWAYS}        # "Pyro Gateway" -> "Pyro Gateway Station"
LEGACY_JUMP = {"Nyx Jump Point", "Pyro Jump Point", "Terra Jump Point", "Stanton Jump Point (Pyro)",
               "Nyx Jump Point (Pyro)", "Pyro Jump Point (Nyx)", "Stanton Jump Point (Nyx)"}
STATION_GATEWAYS = set(GATEWAYS)        # kept for older imports
# Gateways that aren't open in the game: on the map, never used to route between systems.
CLOSED = {"Terra Gateway", "Terra Gateway Station"}


def is_jump(name):
    return name in JUMP_POINTS


def jump_point_of(station):
    """The Gateway (jump point) a gateway station sits next to, else None."""
    g = GATEWAYS.get(station)
    if not g:
        return None
    return next((n for n, j in JUMP_POINTS.items() if j[0] == g[0] and j[1] == g[1]), None)


def station_of(jump_point):
    """The gateway station next to a Gateway (jump point), else None."""
    j = JUMP_POINTS.get(jump_point)
    if not j:
        return None
    return next((n for n, g in GATEWAYS.items() if g[0] == j[0] and g[1] == j[1]), None)


def station_alias(name):
    """A name missions, UEX or the services data use for a gateway station ("Pyro Gateway", "Stanton
    Gateway") -> the station's name in Quantum, for `system`. None if it isn't one."""
    return LEGACY_STATION.get(name)


def system_of(name):
    """System of a place you can place with /showlocation (gateway stations, Gateways, STATIONS), else None."""
    g = GATEWAYS.get(name) or JUMP_POINTS.get(name) or STATIONS.get(name)
    return g[0] if g else None


# A Gateway's /showlocation is saved and shared under its own key, apart from the station's: earlier
# versions saved the station's under the Gateway's name ("Stanton Gateway (Pyro)").
JUMP_PREFIX = "Jump point: "


def learn_key(name):
    """The name a place's /showlocation is saved and shared under."""
    return JUMP_PREFIX + name if name in JUMP_POINTS else name


# Positions that came from someone's /showlocation in game (shipped with Quantum). Every other gateway
# station and Gateway position is from the game files or older community data, and stays a "Check its
# position" job until a datarunner confirms it with a /showlocation there.
VERIFIED = {"Stanton Gateway Station (Pyro)", "Stanton Gateway (Pyro)", "Nyx Gateway Station",
            "Stanton Gateway Station (Nyx)"}


def unverified(learned=None):
    """Gateway stations and Gateways whose position nobody has confirmed in game yet."""
    learned = learned or {}
    out = set()
    for name in list(GATEWAYS) + list(JUMP_POINTS):
        if name in VERIFIED or name in CLOSED and name in JUMP_POINTS:
            continue
        if learned.get(learn_key(name)) or (name in GATEWAYS and learned.get(name.replace(" Station", ""))):
            continue
        out.add(name)
    return out


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
    # Earlier versions' map entries: stations under the Gateway's name and "... Jump Point" Gateways.
    # Ours (source "db") are rebuilt below; a waypoint of yours with one of those names is left alone.
    for old in list(LEGACY_JUMP) + list(LEGACY_STATION):
        loc = db.locations.get(old)
        if loc is not None and loc.source == "db" and (old in LEGACY_JUMP or loc.category == "station"):
            db.locations.pop(old)
    for name, (system, to, pos, note) in GATEWAYS.items():
        how = "community data"
        l = learned.get(name) or learned.get(name.replace(" Station", ""))     # saved under the old name
        if l and l.get("system") == system and l.get("pos"):
            pos, how = tuple(l["pos"]), "your /showlocation"
        elif pos is None and name in KNOWN_POS:
            pos, how = KNOWN_POS[name], ("the game files (Star Citizen Wiki data)" if name in FROM_GAME_FILES
                                         else "a /showlocation at the station")
        jp = jump_point_of(name)
        notes = note or (f"Gateway station for the jump to {to}" + (f". {jp}, the jump point itself, is a short hop away" if jp else ""))
        cat = "station"
        if pos is not None and how != "community data":
            notes += f". Position from {how}"
        existing = db.locations.get(name)
        if pos is None:
            if existing and existing.source == "db":
                db.locations.pop(name)
            unplaced[name] = Location(name, "space", None, None, notes=notes + ". Position not known yet",
                                      source="db", system=system, qt=True, category="station")
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
        st = station_of(name)
        l = learned.get(learn_key(name))
        if l and l.get("system") == system and l.get("pos"):          # your (or datarunners') /showlocation
            pos, note = tuple(l["pos"]), note.split(". Position from")[0] + ". Position from a /showlocation there"
        note = note + (f". The station, {st}, is a short hop away (shops, refuel, cargo)" if st else "")
        existing = db.locations.get(name)
        if existing and existing.source != "db":
            continue
        if existing:
            existing.pos, existing.system, existing.kind, existing.body = tuple(pos), system, "space", None
            existing.qt, existing.category, existing.pad = True, "jump", "unknown"
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
# A route that goes from one system to another goes through a Gateway: fly to the Gateway (jump point) in
# the system you're in, jump, and you come out at the Gateway in the other system that leads back. Systems
# without a direct link are reached through the one in between (Stanton -> Pyro -> Nyx, when the
# temporary Stanton - Nyx link is closed). Built from what's actually on the map, so a gateway whose
# position isn't known yet isn't used.

def _gate_names(db, frm, to):
    """Places in system `frm` you jump from to reach system `to`: the Gateway (jump point) first, then
    its station (used if the Gateway has no position). Only ones with a position."""
    out = []
    for table in (JUMP_POINTS, GATEWAYS):
        for name, entry in table.items():
            loc = db.locations.get(name)
            if entry[0] == frm and entry[1] == to and loc is not None and loc.pos is not None \
                    and loc.system == frm and name not in out and name not in CLOSED:
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
