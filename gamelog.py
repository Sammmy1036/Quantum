"""Contract tracking from Star Citizen's Game.log (read-only, no game hooks).

What the log gives us (formats checked against a real 4.x Game.log):

  Added notification "Contract Accepted:  NAME: " [4] to queue. ... MissionId: [uuid], ObjectiveId: []
  Added notification "New Objective: TEXT: " ... MissionId: [uuid], ObjectiveId: [pickup_..._0]
  <CLocalMissionPhaseMarker::CreateMarker> Creating objective marker: missionId [uuid], ...
      contract [FTL_Courier_Stanton_...], objectiveId [dropoff_..._0], zoneHostId [id],
      position [x: 884199.1, y: 468607.6, z: -18090.1]      <- exact spot, planet-local meters
  <ObjectiveUpserted> ... mission_id uuid - objective_id X - state MISSION_OBJECTIVE_STATE_COMPLETED
  <MissionEnded> ... mission_id uuid - mission_state MISSION_STATE_COMPLETED
  <EndMission> ... MissionId[uuid] ... CompletionType[Abandon] ...
  <RequestLocationInventory> ... Location[Stanton4_NewBabbage]   <- which system/planet you're at

Notification text can wrap onto following lines, so notifications are buffered until
their MissionId line arrives. Logs from older builds without IDs still work (objectives
then attach to the latest accepted contract).
"""
from __future__ import annotations

import calendar
import hashlib
import json
import math
import os
import re
import secrets
import string
import threading
import time
from dataclasses import asdict, dataclass, field
from pathlib import Path

ZERO_ID = "00000000-0000-0000-0000-000000000000"
RE_TS = re.compile(r"^<(\d{4})-(\d\d)-(\d\d)T(\d\d):(\d\d):(\d\d)(?:\.(\d+))?Z>")
RE_NOTE = re.compile(r'Added notification "(.*?)"\s*\[\d+\](?:.*?MissionId: \[([0-9a-f-]*)\], ObjectiveId: \[([^\]]*)\])?',
                     re.S)
RE_MARKER = re.compile(r"Creating objective marker: missionId \[([0-9a-f-]+)\].*?contract \[([^\]]*)\].*?"
                       r"objectiveId \[([^\]]+)\].*?zoneHostId \[(\d+)\], position \[x: ([-\d.eE]+), "
                       r"y: ([-\d.eE]+), z: ([-\d.eE]+)\]")
RE_OBJ_STATE = re.compile(r"<ObjectiveUpserted>.*?mission_id ([0-9a-f-]+) - objective_id (\S+) - state (\w+)")
RE_MISSION_ENDED = re.compile(r"<MissionEnded>.*?mission_id ([0-9a-f-]+) - mission_state (\w+)")
RE_END_MISSION = re.compile(r"<EndMission>.*?MissionId\[([0-9a-f-]+)\].*?CompletionType\[(\w+)\]")
RE_QT_SHIP = re.compile(r"\| ([A-Za-z0-9_]+?)_?\[(\d+)\]\|CSCItemNavigation")
RE_QT_SELECT = re.compile(r"Player has selected point (\S+) as their destination")
RE_QT_START = re.compile(r"Projected Start Location is (.+?) for route to destination (\S+)")
RE_DEATH = re.compile(r"Actor '([^']+)' \[\d+\] ejected from zone '[^']*' \[\d+\] to zone '([^']+)'")
RE_OOC = re.compile(r"OOC_(Stanton|Pyro|Nyx)_\d+[a-z]?_(\w+)", re.I)
RE_INV_MOVE = re.compile(r"<Update Inventory Location> Player \[[^\]]*\] is changing location\. Landing \[(\d+)\] -> "
                         r"\[(\d+)\]\. Location \[(\d+)\] -> \[(\d+)\]")
RE_LOCATION = re.compile(r"<RequestLocationInventory>.*?Location\[([^\]]+)\]")
RE_ATC = re.compile(r"(ATC_DataManager_Port_[A-Za-z0-9_\-]+)'? \[(\d+)\]")   # quoted in "ATC '...' [id]" lines
RE_JURISDICTION = re.compile(r"Entered (.+?) Jurisdiction")
# What you personally are doing, from lines that name you or come from your own terminals:
RE_CHARACTER = re.compile(r"geid (\d+) - accountId \d+ - name (\S+) - state STATE_CURRENT")
RE_COMMS_ATC = re.compile(r"DoEstablishCommunicationCommon: .*? for (\S+) \[\d+\] to track their communication partner "
                          r"(ATC_DataManager_Port_[\w\-]+) \[(\d+)\]")
RE_VEH_READY = re.compile(r"SetVehicleSpawnedInformations - VehicleEntityId: \[\d+\], LandingATCId: \[(\d+)\], "
                          r"LandingArea: (.+?) \[\d+\]")
RE_CHANNEL = re.compile(r"You have (joined|left) (?:the )?channel '(.+?) : ([^']+)'")
RE_CLEAR_DRIVER = re.compile(r"ClearDriver: Local client node \[(\d+)\] releasing control token for '([A-Za-z0-9_]+?)_\d+'")
# The physics stats dump the game writes from time to time lists the planets it has loaded, e.g.
#   PHYSICS INSTANCE STATS BEGIN 3 ... planet cells: 0 [0] meshes: 0 [0] name: OOC_Stanton_4_Microtech
#   ... name: pyro5 ... PHYSICS INSTANCE STATS END
# A system's planets appear when you arrive there through a gateway (the old system's can stay listed
# for a while), so a system that's new since the previous dump is where you've just jumped to.
RE_PHYS_PLANET = re.compile(r"planet cells:.*?name: (\S+)")
RE_PLANET_SYS = re.compile(r"^(?:OOC_)?(Stanton|Pyro|Nyx)(?:_|\d|$)", re.I)
RE_SHOP = re.compile(r"playerId\[(\d+)\] shopId\[\d+\] shopName\[SCShop_([A-Za-z0-9]+)_([A-Za-z0-9_]+)\]"
                     r"(?:.*?itemName\[([A-Za-z0-9_]+)\])?")
MAKERS = {"AEGS": "Aegis", "ANVL": "Anvil", "ARGO": "Argo", "BANU": "Banu", "CNOU": "C.O.", "CRUS": "Crusader",
          "DRAK": "Drake", "ESPR": "Esperia", "GAMA": "Gatac", "GLSN": "Gallenson", "GRIN": "Greycat", "KRIG": "Kruger",
          "MISC": "MISC", "MRAI": "Mirai", "ORIG": "Origin", "RSI": "RSI", "TMBL": "Tumbril", "XIAN": "Aopoa", "XNAA": "Aopoa"}


def vehicle_name(code):
    """'DRAK_Corsair' -> 'Drake Corsair', 'TMBL_Cyclone' -> 'Tumbril Cyclone', 'AEGS_Avenger_Titan' -> 'Aegis Avenger Titan'."""
    parts = code.split("_")
    maker = MAKERS.get(parts[0].upper())
    rest = " ".join(p for p in (parts[1:] if maker else parts) if p)
    return f"{maker} {rest}".strip() if maker else rest


def spaced(word):
    return re.sub(r"(?<=[a-z])(?=[A-Z])", " ", word).replace("_", " ").strip()


def atc_label(name):
    """'ATC_DataManager_Port_Lawful_Gate_03' -> 'Gate 3'. Generic ids ('Lawful-001') -> None."""
    code = re.sub(r"^ATC_DataManager_Port_", "", name)
    code = re.sub(r"^(Lawful|SemiLawful|Unlawful)[_\-]?", "", code)
    m = re.fullmatch(r"(Gate|Dock|Pad|Hangar)[_\-]?0*(\d+)", code, re.I)
    if m:
        return f"{m.group(1).title()} {int(m.group(2))}"
    if not code or re.fullmatch(r"[\d\-_]+", code) or re.search(r"\d{3}$", code):
        return None
    return spaced(code)
SYSTEM_RE = re.compile(r"^(Stanton|Pyro|Nyx)", re.I)
# Hangar elevators and landing areas streamed in around you carry the system's name, e.g.
# "LoadingPlatformManager_ShipElevator_HangarMediumFront_Nyx", "LandingArea_ShipElevator_HangarMediumFront_Nyx".
# After a wormhole jump these are the first lines in the log that say which system you're in.
RE_HANGAR_SYS = re.compile(r"\b(?:LoadingPlatformManager|LandingArea)_[A-Za-z0-9_]*?_(Stanton|Pyro|Nyx)\b")


def log_time(line: str) -> float | None:
    m = RE_TS.match(line)
    if not m:
        return None
    y, mo, d, h, mi, s, frac = m.groups()
    return calendar.timegm((int(y), int(mo), int(d), int(h), int(mi), int(s))) + float("0." + (frac or "0"))


def objective_key(text: str) -> str:
    return re.sub(r"\d+\s*/\s*\d+", "#/#", text.strip().lower())


# Wikelo-style collection objectives: "Need 0/1 of Berry Blend Smoothie". The items come from anywhere
# (shops, loot, mining); they're handed in at a Wikelo Emporium, any of the three.
NEED_RE = re.compile(r"^need\s+(\d+)\s*/\s*(\d+)\s+(?:scu\s+)?(?:of\s+)?(.+?)\s*$", re.I)
BUY_SUFFIX = "#get"          # id suffix of the "get this item at <place>" step you can add per item


def need_item(text: str):
    """'Need 0/1 of Berry Blend Smoothie' -> (0, 1, 'Berry Blend Smoothie'), else None."""
    m = NEED_RE.match(text or "")
    return (int(m.group(1)), int(m.group(2)), m.group(3)) if m else None


def is_collection(c) -> bool:
    """A collection contract (Wikelo): items gathered anywhere, turned in at an emporium."""
    return "wikelo" in f"{c.code} {c.name}".lower() or any(need_item(o.text) for o in c.objectives)


# Contract types Quantum doesn't track for now: Wikelo collections and bounties don't fit the
# pickup/delivery model well. Their code stays in place for when they're turned back on.
TRACK_COLLECTION = False
TRACK_BOUNTY = False


def is_bounty(c) -> bool:
    return "bounty" in f"{c.code} {c.name}".lower()


def is_tracked(c) -> bool:
    return (TRACK_COLLECTION or not is_collection(c)) and (TRACK_BOUNTY or not is_bounty(c))


def objective_kind(text: str, oid: str = "") -> str:
    o, t = oid.lower(), text.lower()
    if need_item(text):
        return "dropoff"                  # handed in at the emporium
    if o.startswith("pickup") or t.startswith(("collect", "pick up", "pickup", "retrieve", "obtain")):
        return "pickup"
    if o.startswith("dropoff") or t.startswith(("deliver", "drop off", "dropoff")):
        return "dropoff"
    if t.startswith(("kill", "eliminate", "defeat", "destroy", "neutralize")):
        return "combat"
    return "goto"


def _norm(s: str) -> str:
    s = s.lower().replace("&", " and ")
    return " ".join("".join(c if c.isalnum() else " " for c in s).split())


class LocationMatcher:
    """Find the database location an objective's text names (longest name wins)."""

    def __init__(self, names):
        self.keys = []
        for name in names:
            variants = {name, re.sub(r"\s*\([^)]*\)\s*$", "", name)}
            for v in list(variants):
                if v.lower().startswith("r&r "):
                    variants.add(v[4:])
            for v in variants:
                k = _norm(v)
                if len(k) >= 4 and not re.fullmatch(r"om \d", k):
                    self.keys.append((k, name))
        self.keys.sort(key=lambda kv: -len(kv[0]))

    def match(self, text: str) -> str | None:
        t = f" {_norm(text)} "
        for k, name in self.keys:
            if f" {k} " in t:
                return name
        return None


@dataclass
class Objective:
    id: str
    text: str
    status: str = "active"          # active | done | failed | withdrawn
    kind: str = "goto"
    location: str | None = None     # matched database place, if any
    marker: dict | None = None      # {"body", "system", "pos": [x,y,z] body-local m}
    done_at: float | None = None
    zone: str | None = None         # interior zone (building/station) the marker sits in
    found: str = ""                 # how the place was worked out: text|marker|zone|station|visited|manual
    manual: bool = False            # marked done by you (the game didn't log it)
    item_for: str = ""              # a "get the item" step you added: the id of the item it's for
    space: dict | None = None       # a marker out in open space: {"zone", "offset": [x,y,z], "system", "at"}


@dataclass
class Contract:
    id: str
    name: str
    status: str = "active"          # active | complete | failed | abandoned
    accepted_at: float = 0.0
    updated_at: float = 0.0
    code: str = ""                  # internal contract name, e.g. FTL_Courier_Stanton_Hydrogen_Rank0
    system: str | None = None
    objectives: list[Objective] = field(default_factory=list)
    departed_at: float | None = None   # left the pickup with the cargo ("out for delivery")
    closed_at: float | None = None
    pickup_code: str = ""              # location code where the cargo was collected
    turn_in: str = ""                  # collection contracts: the emporium to hand the items in at
    turn_in_how: str = ""              # "nearest" (picked by Quantum) or "manual" (picked by you)
    tracking_no: str = ""              # Quantum's own parcel-style number: 1SC + 15 random digits

DEPART_FALLBACK_S = 180   # no departure signal? call it out for delivery 3 minutes after pickup
GENERIC_TOKENS = {"lawful", "semilawful", "unlawful", "port", "station", "stanton", "pyro", "nyx", "location",
                  "distributioncentre", "distribution", "centre", "center", "datamanager", "outpost"}


def _compact(s: str) -> str:
    return "".join(c for c in s.lower() if c.isalnum())


def scu_progress(text: str):
    """'Deliver 3/5 SCU of Aluminum to ...' -> [3, 5]."""
    m = re.search(r"(\d+)\s*/\s*(\d+)\s*SCU", text or "")
    return [int(m.group(1)), int(m.group(2))] if m else None


def contract_cargo(code: str) -> str:
    """'FTL_Courier_Stanton_MedicalSupplies_Rank0_2' -> 'Medical Supplies'."""
    m = re.search(r"_(?:Stanton|Pyro|Nyx)_([A-Za-z]+?)_Rank", code or "")
    if not m:  # 'HaulCargo_SingleToMulti2_RefinedOre_Aluminium_Stanton4_SmallGrade' -> 'Aluminium'
        parts = (code or "").split("_")
        i = next((k for k, p in enumerate(parts) if re.fullmatch(r"(Stanton|Pyro|Nyx)\d*", p)), None)
        if code and code.startswith("HaulCargo") and i and i >= 3:
            words = re.sub(r"(?<=[a-z])(?=[A-Z])", " ", parts[i - 1])
            return "Mixed cargo" if parts[i - 2] == "Mixed" and len(words.split()) > 2 else words
        return ""
    return re.sub(r"(?<=[a-z])(?=[A-Z])", " ", m.group(1))


def default_log_paths():
    suffixes = [r"Program Files\Roberts Space Industries\StarCitizen\LIVE\Game.log",
                r"Roberts Space Industries\StarCitizen\LIVE\Game.log",
                r"Games\Roberts Space Industries\StarCitizen\LIVE\Game.log",
                r"StarCitizen\LIVE\Game.log"]
    out = []
    if os.name == "nt":
        for d in string.ascii_uppercase:
            if os.path.exists(f"{d}:\\"):
                out += [f"{d}:\\{s}" for s in suffixes]
    return out


def running_game_logs():
    """Game.log paths of any running StarCitizen.exe (LIVE, PTU, ...): <channel>\\Bin64\\StarCitizen.exe
    writes <channel>\\Game.log. Windows only; [] elsewhere or if it can't tell."""
    if os.name != "nt":
        return []
    try:
        import ctypes
        from ctypes import wintypes
        psapi, k32 = ctypes.WinDLL("psapi"), ctypes.WinDLL("kernel32")
        k32.OpenProcess.restype = wintypes.HANDLE
        k32.OpenProcess.argtypes = (wintypes.DWORD, wintypes.BOOL, wintypes.DWORD)
        k32.QueryFullProcessImageNameW.argtypes = (wintypes.HANDLE, wintypes.DWORD, wintypes.LPWSTR,
                                                   ctypes.POINTER(wintypes.DWORD))
        k32.CloseHandle.argtypes = (wintypes.HANDLE,)
        pids = (wintypes.DWORD * 8192)()
        got = wintypes.DWORD()
        if not psapi.EnumProcesses(ctypes.byref(pids), ctypes.sizeof(pids), ctypes.byref(got)):
            return []
        out = []
        for pid in pids[:got.value // ctypes.sizeof(wintypes.DWORD)]:
            h = k32.OpenProcess(0x1000, False, pid)          # PROCESS_QUERY_LIMITED_INFORMATION
            if not h:
                continue
            try:
                buf, n = ctypes.create_unicode_buffer(1024), wintypes.DWORD(1024)
                if k32.QueryFullProcessImageNameW(h, 0, buf, ctypes.byref(n)) and \
                        os.path.basename(buf.value).lower() == "starcitizen.exe":
                    out.append(os.path.join(os.path.dirname(os.path.dirname(buf.value)), "Game.log"))
            finally:
                k32.CloseHandle(h)
        return out
    except Exception:
        return []


class ContractTracker(threading.Thread):
    """Tails Game.log and keeps contracts, objective markers and the player's location in
    missions.json. `nav` (a NavDB) is used to place markers on the right planet."""

    def __init__(self, store_path, nav, log_path=None, interval=0.5):
        super().__init__(daemon=True)
        self.store_path = Path(store_path)
        self.nav = nav
        self.matcher = LocationMatcher(nav.locations)
        self.interval = interval
        self.lock = threading.RLock()
        self.contracts: dict[str, Contract] = {}
        self.version = 0
        self.log_sig, self.offset = None, 0
        self.log_path = log_path
        self.status = "idle"
        self.where = {}            # {"code", "system", "body"} from the latest location event
        self.marker_hits = []      # objectives just completed on a planet marker: you were standing there
        self.loc_ids = {}          # game location id -> place, learned from arrivals (kept across sessions)
        self.cur = {}              # {"id", "landing", "at", "place", "left"}: where the log says you are now
        self.dest_ids = {}         # quantum destination id -> {"place", "n", "ambiguous"}, learned (kept)
        self.player_name = ""
        self.player_geid = ""
        self.activity = None       # latest thing you did that says where you are: {"text", "at"}
        self.vehicle = None        # {"name", "aboard", "at"}: your own ship or ground vehicle
        self.armistice = None      # (inside: bool, at)
        self.qt = {}               # current/last jump: {"dest", "ship", "start", "selected", "arrived", "place"}
        self.build = ""            # game build number, e.g. "12660092" (calibrations are tagged with it)
        self.zone_bodies = {}      # zoneHostId -> body name, learned per game session
        self.zone_places = {}      # zoneHostId -> place name (buildings/stations), learned per session
        self.atc = {}              # entity id -> "ATC_DataManager_Port_..." name (station traffic control)
        self.player_ref = None     # set by the app: () -> (global pos, system, time) of your last /showlocation
        self.phys_systems = []     # systems whose planets the last physics stats dump listed (this session)
        self._phys = None          # systems seen in the dump being read now
        self._pending = None       # buffered multi-line notification
        self._reopen = False
        self.game_running = False
        self.proc_seen = False
        self.last_growth = 0.0       # when the game last added lines while Quantum watched (not catch-up)
        self._seen = None            # (signature, size) at the previous pass
        self.log_note = ""
        self._stop = threading.Event()
        self._load()
        if self.recheck_markers():
            self._save()
        if not self.log_path:
            self.log_path = next((p for p in default_log_paths() if os.path.isfile(p)), None)

    # ---------------------------------------------------------- persistence
    def _load(self):
        try:
            raw = json.loads(self.store_path.read_text(encoding="utf-8"))
        except Exception:
            return
        self.log_path = self.log_path or raw.get("log_path")
        self.log_sig, self.offset = raw.get("log_sig"), raw.get("offset", 0)
        self.where, self.zone_bodies = raw.get("where", {}), raw.get("zone_bodies", {})
        self.build = raw.get("build", "")
        self.phys_systems = raw.get("phys_systems", [])
        self.loc_ids, self.cur = raw.get("loc_ids", {}), raw.get("cur", {})
        self.dest_ids, self.qt = raw.get("dest_ids", {}), raw.get("qt", {})
        self.zone_places, self.atc = raw.get("zone_places", {}), {int(k): v for k, v in raw.get("atc", {}).items()}
        for c in raw.get("contracts", []):
            if "id" not in (c.get("objectives") or [{}])[0] and c.get("objectives"):
                continue  # file from the older text-only tracker
            c["objectives"] = [Objective(**{k: v for k, v in o.items() if k in Objective.__dataclass_fields__})
                               for o in c.get("objectives", [])]
            con = Contract(**{k: v for k, v in c.items() if k in Contract.__dataclass_fields__})
            self.contracts[con.id] = con

    def _save(self):
        data = {"log_path": self.log_path, "log_sig": self.log_sig, "offset": self.offset,
                "where": self.where, "zone_bodies": self.zone_bodies, "build": self.build,
                "loc_ids": self.loc_ids, "cur": self.cur, "dest_ids": self.dest_ids, "qt": self.qt, "zone_places": self.zone_places,
                "phys_systems": self.phys_systems,
                "atc": {str(k): v for k, v in self.atc.items()},
                "contracts": [asdict(c) for c in self.contracts.values()]}
        tmp = self.store_path.with_suffix(".tmp")
        tmp.write_text(json.dumps(data, indent=1), encoding="utf-8")
        tmp.replace(self.store_path)

    def _changed(self):
        self.version += 1
        self._save()

    # -------------------------------------------------------------- public
    def set_log_path(self, path):
        with self.lock:
            if path == self.log_path:
                return
            self.log_path, self.log_sig, self.offset, self._reopen = path, None, 0, True
            self._save()

    def relink(self):
        """Re-resolve places after the location database changes."""
        with self.lock:
            self.matcher = LocationMatcher(self.nav.locations)
            self.recheck_markers()
            for c in self.contracts.values():
                for o in c.objectives:
                    # Places you set, learned ones and hand-ins stay; only text/marker matches are redone.
                    if o.item_for or need_item(o.text) or o.found in ("manual", "visited", "zone", "station"):
                        if o.location and o.location not in self.nav.locations and not need_item(o.text):
                            o.location = None               # that place was deleted
                        continue
                    o.location = self._match_location(o)
            self._changed()

    def dismiss(self, cid):
        with self.lock:
            self.contracts.pop(cid, None)
            self._changed()

    def clear_finished(self):
        with self.lock:
            self.contracts = {k: c for k, c in self.contracts.items() if c.status == "active"}
            self._changed()

    def snapshot(self):
        """Contracts for the UI, newest first, with readable labels filled in. The game only
        announces some objectives in text; the rest are described from the contract code."""
        with self.lock:
            out = []
            for c in sorted(self.contracts.values(), key=lambda c: -c.accepted_at):
                if not is_tracked(c):
                    continue
                self._tracking_no(c)          # contracts from before tracking numbers existed
                d = asdict(c)
                cargo = contract_cargo(c.code)
                d["subtitle"] = cargo
                for o in d["objectives"]:
                    if o["text"] in ("", "Objective"):
                        verb = {"pickup": "Pick up", "dropoff": "Deliver"}.get(o["kind"], "Go")
                        what = f" {cargo}" if cargo and o["kind"] in ("pickup", "dropoff") else ""
                        prep = {"pickup": "at", "dropoff": "to"}.get(o["kind"], "to")
                        where = o["location"] or (f"the marked spot {'on ' + o['marker']['body'] if o['marker'].get('body') else 'near ' + (o['marker'].get('lpoint') or o['marker'].get('near') or 'a Lagrange point')}{' (approximate)' if o['marker'].get('approx') else ''}" if o["marker"]
                                                   else "a spot the log didn't give")
                        o["label"] = f"{verb}{what} {prep} {where}"
                    else:
                        o["label"] = o["text"]
                d["tracking"] = self._tracking(c)
                d["collection"] = is_collection(c)
                for o in d["objectives"]:
                    o["need"] = need_item(o["text"])
                out.append(d)
            return out

    def _tracking(self, c: Contract):
        """Delivery progress: 0 accepted, 1 collected, 2 out for delivery, 3 delivered."""
        picks = [o for o in c.objectives if o.kind == "pickup"]
        drops = [o for o in c.objectives if o.kind == "dropoff"]
        if not picks and not drops:
            return None
        now = time.time()
        picked = [o for o in picks if o.status == "done"]
        dropped = [o for o in drops if o.status == "done"]
        collection = is_collection(c)
        collected_at = None
        if picks and len(picked) == len(picks) and (not collection or len(picks) >= len(drops)):
            collected_at = max((o.done_at or c.updated_at) for o in picked)
        elif not picks and not collection:
            collected_at = c.accepted_at
        elif collection and dropped:          # handing items in: you had them
            collected_at = min(o.done_at or c.updated_at for o in dropped)
        departed_at = c.departed_at
        if collected_at and not departed_at and (c.status != "active" or now - collected_at > DEPART_FALLBACK_S):
            departed_at = collected_at + DEPART_FALLBACK_S if c.status == "active" else (c.closed_at or collected_at)
        if c.status == "complete":
            stage = 3
        elif collected_at:
            stage = 2 if departed_at else 1
        else:
            stage = 0
        last_drop = max((o.done_at or 0) for o in dropped) if dropped else None
        # Cargo: "Deliver 0/12 SCU of Aluminum to ..." gives the amount per commodity. Pickup objectives
        # don't state it, but what you pick up is what you have to deliver.
        cargo = {}
        for o in drops:
            n = need_item(o.text)
            if n:                                  # collection item: count, not SCU
                k = cargo.setdefault(n[2], [0, 0])
                k[0] += n[1] if o.status == "done" or c.status == "complete" else n[0]
                k[1] += n[1]
                continue
            m = re.search(r"(\d+)\s*/\s*(\d+)\s*SCU of (.+?) to ", o.text or "")
            if m:
                k = cargo.setdefault(m.group(3).strip(), [0, 0])
                k[0] += int(m.group(2)) if o.status == "done" or c.status == "complete" else int(m.group(1))
                k[1] += int(m.group(2))
        return {"stage": stage, "collection": collection, "cancelled": c.status in ("failed", "abandoned"), "status": c.status,
                "times": [c.accepted_at, collected_at, departed_at, c.closed_at if c.status == "complete" else None],
                "picked": len(picked), "pickups": len(picks), "dropoffs": len(drops),
                "delivered": len(dropped), "last_drop": last_drop,
                "cargo": [{"what": k, "done": v[0], "total": v[1]} for k, v in cargo.items()],
                "scu_total": sum(v[1] for v in cargo.values()),
                "drops": [{"id": o.id, "where": o.location or (o.marker and (f"Marker on {o.marker['body']}" if o.marker.get('body') else f"Marker near {o.marker.get('lpoint') or o.marker.get('near') or 'a Lagrange point'}")),
                           "status": o.status, "at": o.done_at, "scu": scu_progress(o.text)} for o in drops]}

    def mark_collected(self, cid, oid):
        """The player says they collected the cargo (the game didn't log it). Same as the game's
        "Objective Complete" for that pickup; if the game reports it later, nothing changes."""
        with self.lock:
            c = self.contracts.get(cid)
            if not c or c.status != "active":
                return False
            todo = [o for o in c.objectives if o.kind == "pickup" and o.status == "active"
                    and (oid is None or o.id == oid)]           # no oid: every open pickup
            for o in todo:
                o.manual = True
                self._set_status(c, o, "done", time.time(), manual=True)
            if todo:
                self._changed()
            return bool(todo)

    def set_item_source(self, cid, oid, place):
        """Where you'll get an item for a collection contract: adds (or moves, or with place=None
        removes) a pickup step for it, which then shows up in routes like any pickup."""
        with self.lock:
            c = self.contracts.get(cid)
            o = next((o for o in c.objectives if o.id == oid), None) if c else None
            if not o or not need_item(o.text) or (place and place not in self.nav.locations):
                return False
            gid = o.id + BUY_SUFFIX
            g = next((g for g in c.objectives if g.id == gid), None)
            if not place:
                if g and g.status == "active":
                    c.objectives.remove(g)
            elif g:
                g.location, g.status, g.done_at, g.manual = place, "active", None, False
            else:
                c.objectives.append(Objective(gid, f"Get {need_item(o.text)[2]}", "active", "pickup", place,
                                              found="manual", item_for=o.id))
            self._changed()
            return True

    def set_turn_in(self, cid, place, how):
        with self.lock:
            c = self.contracts.get(cid)
            if not c or (c.turn_in == place and c.turn_in_how == how):
                return False
            c.turn_in, c.turn_in_how = place, how
            self._changed()
            return True

    def mark_departed(self, cid, ts):
        with self.lock:
            c = self.contracts.get(cid)
            if c and c.status == "active" and not c.departed_at:
                c.departed_at = ts
                self._changed()

    def set_objective_place(self, cid, oid, place):
        """The player tells us where an objective is. Also teaches the interior zone it sits in."""
        with self.lock:
            c = self.contracts.get(cid)
            o = next((o for o in c.objectives if o.id == oid), None) if c else None
            if not o or place not in self.nav.locations:
                return False
            o.location, o.found = place, "manual"
            if o.zone:
                self.zone_places[o.zone] = place
                self._propagate_zones()
            self._changed()
            return True

    def get(self, cid):
        with self.lock:
            return self.contracts.get(cid)

    def stop(self):
        self._stop.set()

    # -------------------------------------------------------------- helpers
    def _contract(self, mid, ts, name=None):
        c = self.contracts.get(mid)
        if c is None:
            c = Contract(mid, name or "Contract", "active", ts, ts)
            self.contracts[mid] = c
            self._tracking_no(c)
        return c

    def _tracking_no(self, c):
        """Give a contract a tracking number like a parcel's, never one already in use."""
        if not c.tracking_no:
            used = {x.tracking_no for x in self.contracts.values()}
            while True:
                n = "1SC" + "".join(secrets.choice("0123456789") for _ in range(15))
                if n not in used:
                    c.tracking_no = n
                    break
        return c.tracking_no

    def _objective(self, c, oid, text=""):
        for o in c.objectives:
            if (oid and o.id == oid) or (not oid and text and objective_key(o.text) == objective_key(text)):
                return o
        return None

    def _body_by_internal(self, code):
        code = code.lower()
        for b in self.nav.bodies.values():
            if b.internal and b.internal.lower() == code:
                return b.name
        return None

    def _nearest_place_dist(self, body, pos):
        best = float("inf")
        for loc in self.nav.locations.values():
            if loc.body == body and loc.kind == "surface" and loc.source == "db":
                d = math.dist(loc.pos, pos)
                if d < best:
                    best = d
        return best

    def _resolve_body(self, zone, pos, text, system, code=""):
        """Which planet/moon a marker's zone-local position belongs to.

        Several bodies can fit the same distance from their centre (Hurston and microTech are both
        exactly 1,000 km), so the evidence is weighed in this order:
          1. the marker sits on a known place on that body (pickups and drop-offs almost always do)
          2. the contract's code names the body (e.g. HaulCargo_..._Stanton4_... is microTech)
          3. the objective text names the body
          4. it's the body the log last put you on
        """
        if zone in self.zone_bodies:
            return self.zone_bodies[zone]
        r = math.sqrt(sum(v * v for v in pos))
        if r < 20_000:
            return None  # inside a building or hangar zone: not placeable on the map
        cands = []
        for b in self.nav.bodies.values():
            if b.kind == "star" or b.radius_m <= 0 or (system and b.system != system):
                continue
            zone_r = 3 * b.om_radius_m if b.om_radius_m else 1.6 * b.radius_m
            if b.radius_m * 0.97 - 5_000 <= r <= zone_r:
                cands.append(b)
        if not cands:
            return None
        low = _norm(text)
        code_bodies = {self._body_by_internal(m) for m in re.findall(r"(?i)(?:stanton|pyro|nyx)\d+[a-z]?", code or "")}
        near = {b.name: self._nearest_place_dist(b.name, pos) for b in cands} if len(cands) > 1 else {}
        cands.sort(key=lambda b: (
            near.get(b.name, 0) > 3_000,                  # a known place right under the marker
            b.name not in code_bodies,                    # named by the contract code
            _norm(b.name) not in low,                     # named in the objective text
            b.name != self.where.get("body"),             # where the log last put you
            abs(r - b.radius_m)))
        best = cands[0]
        decisive = (len(cands) == 1 or near.get(best.name, 0) <= 3_000 or best.name in code_bodies
                    or abs(cands[0].radius_m - cands[1].radius_m) > 20_000 or _norm(best.name) in low)
        if decisive:
            self.zone_bodies[zone] = best.name
        return best.name

    def _lpoint_station(self, pos, system):
        """Rest stops are logged relative to their Lagrange point, not a planet. If center+pos lands on a
        known station (within 5 km) at some L-point, return (lpoint, station, global position)."""
        best = None
        for lp in self.nav.locations.values():
            if lp.category != "lpoint" or (system and lp.system != system):
                continue
            g = [lp.pos[i] + pos[i] for i in range(3)]
            for st in self.nav.locations.values():
                if st.kind == "space" and st.system == lp.system and st.category != "lpoint" and st.source == "db":
                    d = math.dist(st.pos, g)
                    if d < 5_000 and (best is None or d < best[3]):
                        best = (lp.name, st.name, g, d)
        return best[:3] if best else None

    def _any_body_has_place(self, pos, system):
        """Is there a known place right under this marker on some planet/moon of a fitting size?"""
        r = math.sqrt(sum(v * v for v in pos))
        for b in self.nav.bodies.values():
            if b.kind == "star" or b.radius_m <= 0 or (system and b.system != system):
                continue
            if b.radius_m * 0.97 - 5_000 <= r <= (3 * b.om_radius_m if b.om_radius_m else 1.6 * b.radius_m):
                if self._nearest_place_dist(b.name, pos) <= 3_000:
                    return True
        return False

    def _space_marker(self, zone, pos, system):
        """Marker in a Lagrange-point zone -> {"body": None, "lpoint", "system", "pos": global}."""
        hit = self._lpoint_station(pos, system)
        if not hit:
            return None
        lp, station, g = hit
        self.zone_bodies[zone] = "@" + lp
        return {"body": None, "lpoint": lp, "system": self.nav.locations[lp].system, "pos": g}, station

    # ------------------------------------------------------------ markers out in open space
    # Some missions (Gilly's Pilot School, some combat and salvage jobs) put their marker at a random
    # spot in space. The log gives that spot only relative to its zone (zoneHostId), and for these the
    # zone is a small local one around where the mission was set up, whose own position isn't logged.
    # Quantum places the marker relative to the known space place (station, Lagrange point, gateway)
    # closest to you when the marker was created: usually that's the zone it was spawned in. It's marked
    # approximate, and recomputed if a /showlocation arrives later than the marker (logs read on startup).
    FREE_MARKER_REACH = 2.0e9      # the frame must be within 2 Gm of you to be believed

    def _reference(self, system, ts):
        """Where you were around time ts: your /showlocation if it's recent, else the place the log puts
        you at. (global pos, system) or None."""
        ref = self.player_ref() if self.player_ref else None
        if ref and ref[0] is not None and (not system or ref[1] == system) and abs((ref[2] or 0) - ts) < 1800:
            return ref[0], ref[1], "reading"
        code = self.where.get("code") or ""
        try:
            place = self.place_for_code(code) if code else None
        except Exception:
            place = None
        L = self.nav.locations.get(place) if place else None
        if L is not None and L.pos is not None and (not system or L.system == system):
            return self.nav.global_pos(L, ts), L.system, "log"
        return None

    def _free_marker(self, o, zone, offset, system, ts):
        """Place an open-space marker; True if it could be placed."""
        o.space = {"zone": zone, "offset": list(offset), "system": system, "at": ts}
        ref = self._reference(system, ts)
        if not ref:
            return False
        rpos, rsys, how = ref
        best, bd = None, self.FREE_MARKER_REACH
        for loc in self.nav.locations.values():
            # stations in orbit are stored on their planet, so "space or a station" rather than kind alone
            if loc.source != "db" or loc.pos is None or loc.system != rsys or \
                    not (loc.kind == "space" or loc.category in ("station", "lpoint", "jump")):
                continue
            try:
                lp = self.nav.global_pos(loc, ts)
            except Exception:
                continue
            d = math.dist(lp, rpos)
            if d < bd:
                best, bd, bpos = loc, d, lp
        if best is None:
            return False
        g = [bpos[i] + offset[i] for i in range(3)]
        o.marker = {"body": None, "near": best.name, "system": best.system, "pos": g, "approx": True, "ref": how}
        if o.found != "manual":
            o.location, o.found = None, "space"
        return True

    def resolve_free_markers(self):
        """Markers in open space that couldn't be placed yet (no position for you then): try again."""
        changed = False
        with self.lock:
            for c in self.contracts.values():
                if c.status != "active":
                    continue
                for o in c.objectives:
                    sp = o.space
                    if not sp or o.status != "active" or o.found == "manual":
                        continue
                    if o.marker and (not o.marker.get("approx") or o.marker.get("ref") == "reading"):
                        continue                  # placed from a reading already (or not a free marker)
                    old = dict(o.marker) if o.marker else None
                    if self._free_marker(o, sp["zone"], sp["offset"], sp.get("system"), sp["at"]) and o.marker != old:
                        changed = True
            if changed:
                self._changed()
        return changed

    def recheck_markers(self):
        """Fix markers placed on the wrong same-size body by an older version: if the marker lands on
        a known place on another body of the same radius, move it there."""
        changed = False
        for c in self.contracts.values():
            for o in c.objectives:
                m = o.marker
                if not m or m.get("body") not in self.nav.bodies:
                    continue
                if self._nearest_place_dist(m["body"], m["pos"]) <= 3_000:
                    continue
                sp = self._space_marker("recheck", m["pos"], m["system"])
                if sp:
                    o.marker = sp[0]
                    if o.found != "manual":
                        o.location, o.found = sp[1], "marker"
                    changed = True
                    continue
                r0 = self.nav.bodies[m["body"]].radius_m
                for b in self.nav.bodies.values():
                    if b.name != m["body"] and b.system == m["system"] and abs(b.radius_m - r0) < 1_000 \
                            and self._nearest_place_dist(b.name, m["pos"]) <= 3_000:
                        m["body"] = b.name
                        if o.found != "manual":
                            o.location = self._match_location(o)
                            o.found = "marker" if o.location else ""
                        changed = True
                        break
        return changed

    LEO = {"HUR": "Everus Harbor", "CRU": "Seraphim Station", "ARC": "Baijini Point", "MIC": "Port Tressler"}

    def place_for_code(self, code: str, body: str | None = None):
        """Game location code -> database place. Handles station codes like RR_MIC_LEO (Port Tressler)
        and RR_CRU_L1 (the CRU-L1 rest stop), then falls back to matching words in the name."""
        if (code or "").startswith("PLACE:"):
            name = code[6:]
            return name if name in self.nav.locations else None
        if (code or "").startswith(("ACTIVITY:", "HANGAR:")):  # only the system is known from these
            return None
        m = re.fullmatch(r"RR_([A-Z]{3})_(LEO|L\d)", code or "")
        if m:
            if m.group(2) == "LEO":
                name = self.LEO.get(m.group(1))
                return name if name in self.nav.locations else None
            tag = f"{m.group(1)}-{m.group(2)}".lower()
            return next((n for n, l in self.nav.locations.items() if l.source == "db" and tag in n.lower()
                         and l.category != "lpoint" and "station" in n.lower()), None)
        return self._place_for_words(code, body)

    def _place_for_words(self, code: str, body: str | None = None):
        """'Stanton4_DistributionCentre_SakuraSun_Goldenrod' or 'ATC_DataManager_Port_Lawful_s4_dc_cvlx_s4dc05'
        -> the database place those words point at (None if it's not clear)."""
        code = re.sub(r"^ATC_DataManager_Port_", "", code)
        code = re.sub(r"-\d+$", "", code)
        parts = code.split("_")
        if parts and re.fullmatch(r"(?i)(stanton|pyro|nyx)\d*[a-z]?", parts[0]):
            body = body or self._body_by_internal(parts[0])
            parts = parts[1:]
        toks = [t.lower() for p in parts for t in re.split(r"(?<=[a-z])(?=[A-Z])|-", p)]
        toks += [p.lower() for p in parts]                     # also whole words: "goldenrod", "s4dc05"
        toks = {t for t in toks if len(t) >= 4 and t not in GENERIC_TOKENS}
        if not toks:
            return None
        scores = []
        for loc in self.nav.locations.values():
            if loc.source != "db" or (body and loc.body != body):
                continue
            name = _compact(loc.name)
            sc = sum(len(t) for t in toks if t in name)
            if sc:
                scores.append((sc, -len(name), loc.name))
        if not scores:
            return None
        scores.sort(reverse=True)
        if len(scores) > 1 and scores[1][0] == scores[0][0] and scores[1][1] == scores[0][1]:
            return None  # a tie: not sure enough
        return scores[0][2] if scores[0][0] >= 5 else None

    def _zone_place(self, zone):
        if zone in self.zone_places:
            return self.zone_places[zone], "zone"
        # Station/building traffic control is spawned right next to the zone it serves.
        z = int(zone)
        near = min(self.atc, key=lambda i: abs(i - z), default=None)
        if near is not None and abs(near - z) <= 600:
            place = self.place_for_code(self.atc[near])
            if place:
                self.zone_places[zone] = place
                return place, "station"
        return None, ""

    def _propagate_zones(self):
        changed = False
        for c in self.contracts.values():
            for o in c.objectives:
                if o.zone and not o.location:
                    place, how = self._zone_place(o.zone)
                    if place:
                        o.location, o.found, changed = place, how, True
        return changed

    def _set_status(self, c, o, status, ts, manual=False):
        o.status = status
        c.updated_at = ts
        if status != "done":
            return
        o.done_at = ts
        for g in c.objectives:            # handed the item in: its "get it" step is done too
            if g.item_for == o.id and g.status == "active":
                g.status, g.done_at = "done", ts
        if not manual and o.marker and o.marker.get("body") and o.kind in ("pickup", "dropoff"):
            # You complete a pickup/drop-off standing at its marker: an exact, known spot for calibration.
            self.marker_hits = (self.marker_hits + [{"t": ts, "body": o.marker["body"], "pos": o.marker["pos"],
                                                     "name": o.location or f"{o.kind} marker", "used": False}])[-10:]
        if o.kind == "pickup":
            c.pickup_code = self.where.get("code", "") or "collected"
            # Where were we when we collected? That's the pickup, if the log didn't say.
            if not o.location and self.where.get("at") and abs(ts - self.where["at"]) < 1800:
                place = self.place_for_code(self.where["code"])
                if place:
                    o.location, o.found = place, "visited"
                    if o.zone:
                        self.zone_places[o.zone] = place
                        self._propagate_zones()

    def _match_location(self, o: Objective):
        if o.marker and o.marker.get("body") is None:
            best, bd = None, 5_000.0
            for loc in self.nav.locations.values():
                if loc.kind == "space" and loc.category != "lpoint" and loc.source != "mission":
                    d = math.dist(loc.pos, o.marker["pos"])
                    if d < bd:
                        best, bd = loc.name, d
            return best or self.matcher.match(o.text)
        if o.marker:
            best, bd = None, 3_000.0   # a known place within 3 km of the marker
            for loc in self.nav.locations.values():
                if loc.body == o.marker["body"] and loc.kind == "surface" and loc.source != "mission":
                    d = math.dist(loc.pos, o.marker["pos"])
                    if d < bd:
                        best, bd = loc.name, d
            if best:
                return best
        return self.matcher.match(o.text)

    # -------------------------------------------------------------- parsing
    def feed(self, line: str) -> bool:
        """Process one log line. Returns True if contracts changed."""
        if self._pending is not None:
            if "Added notification" in line:          # a new one started: flush the old
                full, self._pending = self._pending, None
                changed = self._notification(full)
                return self.feed(line) or changed
            self._pending += line
            if "MissionId:" in line or self._pending.count("\n") > 6:
                full, self._pending = self._pending, None
                return self._notification(full)
            return False
        if "Added notification" in line:
            if "MissionId:" not in line and "to queue" not in line:
                self._pending = line          # text wrapped onto the next lines
                return False
            return self._notification(line)
        if not self.build and "Build(" in line:
            m = re.search(r"Build\((\d+)\)", line)
            if m:
                self.build = m.group(1)
        if "objective marker" in line:
            return self._marker(line)
        if "PHYSICS INSTANCE STATS" in line or (self._phys is not None and "planet cells:" in line):
            return self._physics_stats(line)
        if ("LoadingPlatformManager_" in line or "LandingArea_" in line) and (m := RE_HANGAR_SYS.search(line)):
            return self._system_seen(m.group(1).capitalize(), log_time(line) or time.time(), "HANGAR:" + m.group(0))
        if "STATE_CURRENT" in line and (m := RE_CHARACTER.search(line)):
            self.player_geid, self.player_name = m.group(1), m.group(2)
            return False
        if "DoEstablishCommunicationCommon" in line and (m := RE_COMMS_ATC.search(line)):
            self.atc[int(m.group(3))] = m.group(2)
            if not self.player_name or m.group(1) == self.player_name:
                label = atc_label(m.group(2))
                if label:
                    return self._activity(f"Talking to {label} traffic control", line)
            return False
        if "SetVehicleSpawnedInformations" in line and (m := RE_VEH_READY.search(line)):
            label = atc_label(self.atc.get(int(m.group(1)), "")) if m.group(1) != "0" else None
            return self._activity(f"Vehicle delivered to {m.group(2)}" + (f", {label}" if label else ""), line,
                                  place=m.group(2))
        if "ClearDriver: Local client" in line and (m := RE_CLEAR_DRIVER.search(line)):
            if not self.player_geid or m.group(1) == self.player_geid:
                self.vehicle = {"name": vehicle_name(m.group(2)), "aboard": True, "seat": False, "at": log_time(line) or time.time()}
                return True
        if "shopName[SCShop_" in line and (m := RE_SHOP.search(line)):
            if not self.player_geid or m.group(1) == self.player_geid:
                shop, where, item = spaced(m.group(2)), spaced(m.group(3)), m.group(4)
                verb = "Rented" if "Rental" in line else "Bought" if "Buy" in line or "Purchase" in line else None
                text = f"{verb} a {vehicle_name(item)} at {shop}, {where}" if verb and item else f"At {shop}, {where}"
                return self._activity(text, line, place=where)
        if "ATC_DataManager_Port_" in line:
            for name, eid in RE_ATC.findall(line):
                self.atc[int(eid)] = name
            return self._propagate_zones()
        if "<ObjectiveUpserted>" in line:
            m = RE_OBJ_STATE.search(line)
            if m and (c := self.contracts.get(m.group(1))):
                o = self._objective(c, m.group(2))
                state = m.group(3).rsplit("_", 1)[-1].lower()
                if o and state in ("completed", "failed", "withdrawn", "abandoned"):
                    new = {"completed": "done", "abandoned": "withdrawn"}.get(state, state)
                    if o.status != new:
                        self._set_status(c, o, new, log_time(line) or time.time())
                    return True
            return False
        for rx, mapper in ((RE_MISSION_ENDED, lambda s: s.rsplit("_", 1)[-1].lower()),
                           (RE_END_MISSION, lambda s: s.lower())):
            if (m := rx.search(line)) and (c := self.contracts.get(m.group(1))):
                state = {"completed": "complete", "complete": "complete", "abandon": "abandoned",
                         "abandoned": "abandoned", "failed": "failed", "fail": "failed"}.get(mapper(m.group(2)))
                if state and c.status == "active":
                    self._close(c, state, line)
                    return True
                return False
        if "[QuantumTravel]" in line and "CSCItemNavigation" in line:
            return self._quantum(line)
        if "<Update Inventory Location>" in line and not self.player_name:
            pm = re.search(r"Player \[([^\]]+)\] is changing location", line)
            if pm:
                self.player_name = pm.group(1)
        if "<Update Inventory Location>" in line and (m := RE_INV_MOVE.search(line)):
            return self._moved(int(m.group(1)), int(m.group(2)), int(m.group(3)), int(m.group(4)),
                               log_time(line) or time.time())
        if "<[ActorState] Dead>" in line and (m := RE_DEATH.search(line)):
            return self._died(m.group(1), m.group(2), log_time(line) or time.time())
        if m := RE_LOCATION.search(line):
            code = m.group(1)
            sysm = SYSTEM_RE.match(code)
            ts = log_time(line) or time.time()
            place = self.place_for_code(code)
            pbody = self.nav.locations[place].body if place else None
            self.where = {"code": code, "system": sysm.group(1).capitalize() if sysm else
                          (self.nav.locations[place].system if place else self.where.get("system")),
                          "body": self._body_by_internal(code.split("_")[0]) or pbody, "at": ts}
            cur = self.cur or {}
            if cur.get("landing") and ts - cur.get("at", 0) < 120 and place:
                self.loc_ids[str(cur["id"])] = place       # this arrival's id is that place: remember it
                self.cur["place"] = self._resolve_loc(cur.get("landing"), cur["id"])
            if place:
                self._learn_after_jump(place, ts, "named location")
            for c in self.contracts.values():   # somewhere new with the cargo: out for delivery
                if c.status == "active" and not c.departed_at and c.pickup_code and code != c.pickup_code:
                    c.departed_at = ts
            return True
        return False

    # ------------------------------------------------------------ quantum travel
    def dest_place(self, dest):
        """A jump destination -> known place (learned, or readable from its own name). None if unknown
        or ambiguous (a template shared by several places)."""
        d = self.dest_ids.get(dest)
        if d and self.dest_is_specific(dest):
            return None if d.get("ambiguous") else d["place"]
        direct = self.place_for_code(dest)
        if direct:
            return direct
        m = re.search(r"(?i)\bom[-_ ]?(\d)\b", dest)
        body = self._body_by_internal(dest.split("_")[0]) or (self.qt.get("start_body") if self.qt else None)
        if m and body and f"OM-{m.group(1)} ({body})" in self.nav.locations:
            return f"OM-{m.group(1)} ({body})"
        key = _compact(dest)
        for n in self.nav.locations:
            if _compact(n) == key:
                return n
        return None

    @staticmethod
    def dest_is_specific(dest):
        """Only destinations with their own id can be learned. Generic names like
        'ObjectContainer_RestStop' are shared by many places."""
        return bool(re.search(r"\d{5,}|\{[0-9A-Fa-f-]{20,}\}", dest or ""))

    def learn_dest(self, dest, place, how):
        """Remember what a jump destination is. A destination seen at two different places (a shared
        building template) is marked ambiguous and not used."""
        if not dest or place not in self.nav.locations or not self.dest_is_specific(dest):
            return False
        d = self.dest_ids.get(dest)
        if d and d["place"] != place:
            if how == "reading":                 # a /showlocation beats a guess from landing nearby
                d.update(place=place, n=1, ambiguous=False, how=how)
            else:
                d["ambiguous"] = True
        elif d:
            d["n"] = d.get("n", 1) + 1
        else:
            self.dest_ids[dest] = {"place": place, "n": 1, "ambiguous": False, "how": how}
        if self.qt.get("dest") == dest:
            self.qt["place"] = self.dest_place(dest)
        self._save()
        return True

    def _learn_after_jump(self, place, ts, how):
        """Landed/docked (or the game named where you are) within 4 minutes of arriving from a jump:
        that jump's destination was this place."""
        q = self.qt or {}
        if q.get("arrived") and not q.get("learned") and 0 <= ts - q["arrived"] <= 240:
            q["learned"] = True
            self.learn_dest(q["dest"], place, how)

    def _quantum(self, line):
        ts = log_time(line) or time.time()
        ship = RE_QT_SHIP.search(line)
        ship_id = ship.group(2) if ship else None
        if m := RE_QT_SELECT.search(line):
            self.qt = {"dest": m.group(1), "ship": ship_id, "selected": ts, "arrived": None,
                       "start": (self.qt or {}).get("start") if (self.qt or {}).get("dest") == m.group(1) else None,
                       "start_body": None, "place": None, "learned": False}
            self.qt["place"] = self.dest_place(m.group(1))
            return True
        if m := RE_QT_START.search(line):
            start = m.group(1).strip()
            if self.qt and self.qt.get("dest") == m.group(2):
                self.qt["start"] = start
                b = start if start in self.nav.bodies else (self.nav.locations[start].body if start in self.nav.locations else None)
                self.qt["start_body"] = b
                self.qt["place"] = self.dest_place(m.group(2))
            return True
        if "has arrived at final destination" in line:
            q = self.qt or {}
            # Arrival lines are logged for other ships nearby too: only count the ship that jumped.
            if q.get("dest") and not q.get("arrived") and (not q.get("ship") or q["ship"] == ship_id) \
                    and ts - (q.get("selected") or 0) < 3600:
                q["arrived"] = ts
                self.cur = {"id": None, "landing": 0, "at": ts, "place": None, "left": None,
                            "near": q.get("place"), "jump": q["dest"]}
                return True
        return False

    def _resolve_loc(self, landing, loc):
        """A location id -> place. A city's landing-zone id covers the whole city (spaceport, shops,
        hangars): moving between them isn't logged, so we don't guess which part you're in. Buildings
        with their own inventory (a hospital, say) get their own id."""
        return self.loc_ids.get(str(loc))

    def _moved(self, old_landing, landing, old_loc, loc, ts):
        """The game logs a location change with ids whenever you land, dock, take off, respawn or move
        between areas (a city and its spaceport, say). We learn which place each id is from the named
        location logged right after, and track where you are."""
        prev = self.cur.get("place") if self.cur else None
        if landing == 0 and old_landing == 0 and old_loc == 0:
            # Spawned (logging in, or respawning after death): not a take-off. Where comes next.
            self.cur = {"id": loc, "landing": 0, "at": ts, "place": self._resolve_loc(0, loc),
                        "left": None, "spawned": True, "died_near": (self.cur or {}).get("died_near")}
            return True
        if landing == 0:
            if old_landing == 0:
                return False                      # already in flight: nothing new
            self.cur = {"id": loc, "landing": 0, "at": ts, "place": None, "left": prev}
            for c in self.contracts.values():   # took off with the cargo: out for delivery
                if c.status == "active" and not c.departed_at and c.pickup_code:
                    c.departed_at = ts
            return True
        place = self._resolve_loc(landing, loc)
        spawned = bool(self.cur and self.cur.get("spawned") and ts - self.cur.get("at", 0) < 60)
        self.cur = {"id": loc, "landing": landing, "at": ts, "place": place, "left": None,
                    "spawned": spawned, "died_near": (self.cur or {}).get("died_near") if spawned else None}
        if place:
            self._learn_after_jump(place, ts, "landing")
            L = self.nav.locations[place]
            self.where = {"code": "PLACE:" + place, "system": L.system, "body": L.body, "at": ts}
        return True

    def _died(self, actor, zone, ts):
        """You died; the zone you were thrown into names the planet/moon you were near."""
        if self.player_name and actor != self.player_name:
            return False
        m = RE_OOC.search(zone)
        near = None
        if m:
            name = {"ariel": "Arial"}.get(m.group(2).lower(), m.group(2))
            near = next((b for b in self.nav.bodies if b.lower() == name.lower()), name)
        self.cur = {"id": None, "landing": 0, "at": ts, "place": None, "left": None, "dead": True, "died_near": near}
        return True

    def _close(self, c, state, line):
        ts = log_time(line) or time.time()
        c.status, c.updated_at, c.closed_at = state, ts, ts
        for o in c.objectives:
            if o.status == "active":
                self._set_status(c, o, "done" if state == "complete" else "withdrawn", ts)

    def _activity(self, text, line, place=None):
        ts = log_time(line) or time.time()
        self.activity = {"text": text, "at": ts}
        # A shop or landing area you used names the place you're at, so it says which system you're in.
        # This is often the only sign of a wormhole jump in the log (nothing is written for the jump),
        # e.g. "SCShop_AdminOffice_NyxSocialStation" right after arriving in Nyx.
        sysname = self.system_of_name(place) if place else None
        if sysname:
            self._system_seen(sysname, ts, f"ACTIVITY:{place}")
        return True

    def _physics_stats(self, line):
        """Collect the planets of one physics stats dump; at its end, a system that's newly loaded (or
        the only one left) is the one you're in."""
        if "STATS BEGIN" in line:
            self._phys = set()
            return False
        if "STATS END" in line:
            now, self._phys = self._phys or set(), None
            prev, self.phys_systems = set(self.phys_systems), sorted(now)
            new = now - prev
            if len(now) == 1:
                sysname = next(iter(now))
            elif prev and len(new) == 1:
                sysname = next(iter(new))
            else:
                return False                  # first dump of the session, or nothing changed
            return self._system_seen(sysname, log_time(line) or time.time(), "PHYSICS:" + sysname)
        if self._phys is not None and (m := RE_PHYS_PLANET.search(line)) and (n := RE_PLANET_SYS.match(m.group(1))):
            self._phys.add(n.group(1).capitalize())
        return False

    def _system_seen(self, sysname, ts, code):
        """The log shows you're in this system (a hangar or shop that only exists there). Updates the
        system only: which place you're at still comes from the location lines."""
        if sysname == self.where.get("system") or ts < (self.where.get("at") or 0) - 5:
            return False
        self.where = {**self.where, "system": sysname, "at": ts, "code": code, "body": None}
        return True

    def system_of_name(self, name):
        """System of a place named in the log ("Nyx Social Station", "Levski"), or None if unsure.
        Gateways are named after the system they lead to, so the name alone isn't trusted for them."""
        if not name:
            return None
        key = re.sub(r"[^a-z0-9]", "", name.lower())
        if "gateway" in key:
            return None                                   # every system has gateways named after others
        hits = {L.system for n, L in self.nav.locations.items()
                if L.system and re.sub(r"[^a-z0-9]", "", re.sub(r"\s*\([^)]*\)$", "", n).lower()) == key}
        if len(hits) == 1:
            return hits.pop()
        if hits:
            return None                                   # same name in two systems
        m = re.search(r"\b(Stanton|Pyro|Nyx)\b", name, re.I)
        return m.group(1).capitalize() if m else None

    def _notification(self, full: str) -> bool:
        ts0 = log_time(full) or time.time()
        if "channel '" in full and (c := RE_CHANNEL.search(full)):
            if not self.player_name or c.group(3).strip() == self.player_name:
                self.vehicle = {"name": c.group(2).strip(), "aboard": c.group(1) == "joined", "at": ts0}
                return True
            return False
        if "Armistice Zone" in full:
            self.armistice = ("Entering" in full, ts0)
            return True
        m = RE_NOTE.search(full)
        if not m:
            return False
        text, mid, oid = m.group(1), m.group(2) or "", m.group(3) or ""
        text = " ".join(text.split()).rstrip(": ").strip()
        ts = log_time(full) or time.time()
        if j := RE_JURISDICTION.match(text):
            if j.group(1) in self.nav.bodies:
                self.where = {**self.where, "body": j.group(1), "system": self.nav.bodies[j.group(1)].system}
            return False
        kind, _, rest = text.partition(":")
        rest = rest.strip()
        has_id = mid and mid != ZERO_ID
        latest = next((c for c in sorted(self.contracts.values(), key=lambda c: -c.accepted_at)
                       if c.status == "active"), None)
        c = self.contracts.get(mid) if has_id else latest

        if kind == "Contract Accepted":
            cid = mid if has_id else f"noid-{int(ts * 1000)}"
            c = self._contract(cid, ts, rest)
            c.name, c.status = rest, "active"
            sysm = re.search(r"\b(Stanton|Pyro|Nyx)\b", rest, re.I)
            c.system = c.system or (sysm.group(1).capitalize() if sysm else self.where.get("system"))
            return True
        if kind == "New Objective":
            if c is None:
                c = self._contract(mid if has_id else f"noid-{int(ts * 1000)}", ts, "Contract")
            o = self._objective(c, oid, rest)
            if o:
                o.text = rest
            else:
                o = Objective(oid or f"t{len(c.objectives)}", rest, "active", objective_kind(rest, oid))
                c.objectives.append(o)
            if not o.location and not need_item(rest):   # item names aren't places ("Ermer Family Farms")
                o.location = self._match_location(o)
                o.found = "text" if o.location else o.found
            c.updated_at = ts
            return True
        if kind in ("Objective Complete", "Objective Withdrawn", "Objective Failed"):
            status = {"Objective Complete": "done", "Objective Withdrawn": "withdrawn",
                      "Objective Failed": "failed"}[kind]
            for cand in ([c] if c else []) + [x for x in self.contracts.values() if x is not c]:
                o = self._objective(cand, oid, rest) if cand else None
                if o and o.status == "active":
                    self._set_status(cand, o, status, ts)
                    return True
            return False
        if kind in ("Contract Complete", "Contract Failed", "Contract Abandoned"):
            if not has_id:  # old logs: match by name
                c = next((x for x in sorted(self.contracts.values(), key=lambda x: -x.accepted_at)
                          if x.status == "active" and x.name == rest), None)
            if c and c.status == "active":
                self._close(c, {"Contract Complete": "complete", "Contract Failed": "failed",
                                "Contract Abandoned": "abandoned"}[kind], full)
                return True
        return False

    def _marker(self, line: str) -> bool:
        m = RE_MARKER.search(line)
        if not m:
            return False
        mid, code, oid, zone = m.group(1), m.group(2), m.group(3), m.group(4)
        pos = [float(m.group(5)), float(m.group(6)), float(m.group(7))]
        ts = log_time(line) or time.time()
        c = self._contract(mid, ts)
        c.code = c.code or code
        sysm = re.search(r"_(Stanton|Pyro|Nyx)_", code, re.I)
        if sysm:
            c.system = sysm.group(1).capitalize()
        o = self._objective(c, oid)
        if o is None:
            o = Objective(oid, "Objective", "active", objective_kind("", oid))
            c.objectives.append(o)
        known = self.zone_bodies.get(zone, "")
        if known.startswith("@") or (not known and math.sqrt(sum(v * v for v in pos)) >= 20_000
                                    and not self._any_body_has_place(pos, c.system)):
            sp = self._space_marker(zone, pos, c.system)
            if sp:
                o.marker = sp[0]
                if o.found != "manual":
                    o.location, o.found = sp[1], "marker"
                return True
        body = self._resolve_body(zone, pos, o.text + " " + c.name, c.system, c.code or code)
        if body is not None and body.startswith("@"):
            return False
        if body is None and math.sqrt(sum(v * v for v in pos)) >= 20_000:
            # Too far out for a building, not on any planet or at a Lagrange point: open space.
            self._free_marker(o, zone, pos, c.system or self.where.get("system"), ts)
            return True
        if body is None:
            # Marker inside a building or station: the log gives no planet position, only the zone.
            o.zone = zone
            if not o.location:
                place, how = self._zone_place(zone)
                if place:
                    o.location, o.found = place, how
            return True
        o.marker = {"body": body, "system": self.nav.bodies[body].system, "pos": pos}
        if o.found != "manual":
            o.location = self._match_location(o)
            o.found = "marker" if o.location else ""
        if o.zone and o.location:           # this interior belongs to that place: remember it
            self.zone_places[o.zone] = o.location
            self._propagate_zones()
        return True

    # ------------------------------------------------------------- tailing
    @staticmethod
    def _signature(path):
        with open(path, "rb") as f:
            return hashlib.sha1(f.readline()[:512]).hexdigest()

    def _locate_log(self, force=False):
        """Find Game.log. A running Star Citizen wins: its own folder's Game.log is the one being written,
        even if Quantum was pointed somewhere else before (another drive, LIVE vs PTU). Otherwise keep the
        current file if it exists, else the first standard install location that has one."""
        now = time.time()
        if not force and now - getattr(self, "_last_locate", 0) < 2:
            return
        self._last_locate = now
        logs = running_game_logs()
        self.game_running = bool(logs)
        self.proc_seen = self.proc_seen or self.game_running   # the process check works on this PC
        running = [p for p in logs if os.path.isfile(p)]
        if running and (not self.log_path or os.path.normcase(self.log_path) not in map(os.path.normcase, running)):
            self.log_path, self.log_note = running[0], "Found Game.log next to the running Star Citizen"
            return
        if self.log_path and os.path.isfile(self.log_path):
            return
        found = next((p for p in default_log_paths() if os.path.isfile(p)), None)
        if found:
            self.log_path, self.log_note = found, "Found Game.log in the standard install folder"

    def run(self):
        """Tail Game.log. The file is opened, read and closed on every pass rather than held open, so the
        game can move it into logbackups and start a fresh one when it launches; a new file (different
        first line) or a shorter one means a new session, read from the start."""
        while not self._stop.is_set():
            try:
                self._locate_log(force=self.status in ("idle", "not_found"))
                path = self.log_path
                if not path or not os.path.isfile(path):
                    self.status = "not_found"
                    self._stop.wait(2)
                    continue
                sig = self._signature(path)
                size = os.path.getsize(path)
                with self.lock:
                    if self._reopen or sig != self.log_sig or size < self.offset:
                        if sig != self.log_sig or size < self.offset:     # new game session
                            self.log_sig, self.offset, self.zone_bodies = sig, 0, {}
                            self.zone_places, self.atc = {}, {}
                            self.phys_systems, self._phys = [], None
                        self._reopen = False
                if self._seen and self._seen[0] == sig and size > self._seen[1]:
                    self.last_growth = time.time()        # written since the last pass: the game is live
                self._seen = (sig, size)
                changed = False
                if size > self.offset:
                    with open(path, "r", encoding="utf-8", errors="replace", newline="") as fh:
                        fh.seek(self.offset)
                        with self.lock:
                            while True:
                                pos = fh.tell()
                                line = fh.readline()
                                if not line or not line.endswith("\n"):
                                    fh.seek(pos)
                                    break
                                changed |= self.feed(line)
                            self.offset = fh.tell()
                with self.lock:
                    self.status = "watching"
                    if changed:
                        self._changed()
            except (OSError, ValueError):
                self.status = "error"
            self._stop.wait(self.interval)
