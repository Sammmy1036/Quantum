"""Star Citizen's local game telemetry (on by default, can be turned off: Settings > Game telemetry).

The game client can serve a live stream of your ship's and your character's state on this PC, at 127.0.0.1:2942
(gRPC, about 14-20 frames a second, only once you've spawned). CIG hasn't documented it and it can change with any
patch, so Quantum treats it as a bonus: with it on, Quantum shows more (your ship's speed, fuel, shields and warning
lights, your health and oxygen, your aUEC balance); with it off or unavailable, everything works from Game.log and
/showlocation as before. It carries no position, so it never replaces those.

Read-only: Quantum only listens to the stream. It never calls the API's "trigger a game action" part.

No generated code or schema file: the stream is read with a plain gRPC call that hands back the raw bytes, and the
few fields Quantum uses are decoded here by their field numbers (protobuf wire format). A field the game stops
sending just goes missing; one it adds is ignored. Needs the grpcio package (requirements.txt); without it the
setting says so and nothing else changes.

The game's side has to be switched on once:
  4.10 LIVE: the Windows user environment variable GRPC_CLIENT_SERVER_ENABLED=true, then restart the RSI Launcher
  5.0 PTU:   on by itself in testers' builds; else the line  server.game.telemetry.enabled = 1  in USER.cfg
setup_game() does both for you.
"""
import os
import re
import struct
import subprocess
import threading
import time
from pathlib import Path

METHOD = "/sc.game.telemetry.v1.GameTelemetryService/TelemetryStream"
DEFAULT_PORT = 2942
FPS_WINDOW = 5.0            # s over which frames per second is measured
STALE_S = 4.0               # no frame for this long: the stream has paused (menus, loading, not spawned)


# ---------------------------------------------------------------- protobuf wire format, just enough to read
def _varint(b, i):
    n = shift = 0
    while True:
        c = b[i]
        i += 1
        n |= (c & 0x7F) << shift
        if c < 0x80:
            return n, i
        shift += 7


def parse(b):
    """Raw message bytes -> {field number: [values]}. Varints as ints, fixed32 as raw 4 bytes, fixed64 as raw
    8 bytes, length-delimited as bytes (a nested message, a string or a packed list: the reader decides)."""
    out, i, n = {}, 0, len(b)
    while i < n:
        key, i = _varint(b, i)
        f, wt = key >> 3, key & 7
        if wt == 0:
            v, i = _varint(b, i)
        elif wt == 1:
            v, i = b[i:i + 8], i + 8
        elif wt == 2:
            ln, i = _varint(b, i)
            v, i = b[i:i + ln], i + ln
        elif wt == 5:
            v, i = b[i:i + 4], i + 4
        else:
            raise ValueError("unsupported wire type %d" % wt)
        out.setdefault(f, []).append(v)
    return out


def _last(m, f, default=None):
    v = m.get(f)
    return v[-1] if v else default


def _f32(m, f, default=0.0):
    v = _last(m, f)
    return struct.unpack("<f", v)[0] if isinstance(v, (bytes, bytearray)) and len(v) == 4 else default


def _int(m, f, default=0):
    v = _last(m, f)
    return v if isinstance(v, int) else default


def _i64(m, f, default=0):
    v = _int(m, f, None)
    if v is None:
        return default
    return v - (1 << 64) if v >= (1 << 63) else v


def _bool(m, f):
    return bool(_int(m, f, 0))


def _str(m, f):
    v = _last(m, f)
    return v.decode("utf-8", "replace") if isinstance(v, (bytes, bytearray)) else ""


def _msg(m, f):
    v = _last(m, f)
    return parse(v) if isinstance(v, (bytes, bytearray)) else None


def _msgs(m, f):
    return [parse(v) for v in m.get(f, []) if isinstance(v, (bytes, bytearray))]


def _floats(m, f):
    out = []
    for v in m.get(f, []):
        if isinstance(v, (bytes, bytearray)) and len(v) % 4 == 0 and len(v) != 4:
            out += list(struct.unpack("<%df" % (len(v) // 4), v))       # packed
        elif isinstance(v, (bytes, bytearray)) and len(v) == 4:
            out.append(struct.unpack("<f", v)[0])
    return out


def _gauge(m, f):
    g = _msg(m, f)
    return {"cur": round(_f32(g, 1), 2), "max": round(_f32(g, 2), 2)} if g is not None else None


def _num(x, nd=1):
    """A float as sent, rounded; the game's 'no reading' (the largest float) as None."""
    return None if x is None or x != x or abs(x) > 1e30 else round(x, nd)


DEPLOY = {1: "retracted", 2: "deploying", 3: "deployed", 4: "retracting"}
VTYPE = {1: "spaceship", 2: "ground", 3: "gravlev", 4: "boat"}
MODE = {1: "nav", 2: "scm", 3: "stealth"}
LOCO = {1: "on_foot", 2: "eva", 3: "seated"}
ROLE = {1: "pilot", 2: "gunner", 3: "crew"}
WARN = {1: "nominal", 2: "off", 3: "minor_flashing", 4: "minor", 5: "major_flashing", 6: "major"}
WARN_NAMES = ("PWR", "WPN", "THR", "SHLD", "COOL", "QDRV", "RADR", "PROX", "HIT", "MISL")
POWER_NAMES = ("power_plants", "engines", "weapons", "coolers", "life_support", "gravity", "sensors", "shield_generators", "shield_emitters")
HELD_KEYS = ("shields", "health", "mode", "spooled", "boost")   # sent in some frames only: kept a while (Telemetry._hold)
HOLD_S = 15
EVENTS = {1: "spawn", 2: "dead", 3: "enter_seat", 4: "leave_seat", 5: "respawn", 6: "downed"}


def clean_name(s):
    """'DRAK_Cutlass_Red_943238544642' -> 'DRAK_Cutlass_Red': the entity id the game appends."""
    return re.sub(r"_\d{6,}$", "", s or "")


def decode(raw):
    """One stream frame -> {vehicle, weapons, events, actor} with what Quantum uses (missing parts left out)."""
    top = parse(raw)
    out = {}
    vf = _msg(top, 3)
    vs = _msg(vf, 2) if vf is not None else None
    if vs is not None:
        v = {"name": clean_name(_str(vs, 1)), "class": clean_name(_str(vs, 2)), "maker": _str(vs, 3),
             "type": VTYPE.get(_int(vs, 4)), "lights": _bool(vs, 5)}
        an = _msg(vs, 7)
        if an is not None:
            v["warnings"] = {n: WARN.get(_int(an, i + 1), "off") for i, n in enumerate(WARN_NAMES)}
        fl = _msg(vs, 8)
        v["flight_data"] = fl is not None and _msg(fl, 3) is not None     # speed, heading, altitude... (ships send it)
        if fl is not None:
            st, ins, se = _msg(fl, 1), _msg(fl, 3), _msg(fl, 2)
            if st is not None:
                v.update(landed=_bool(st, 1), gear=DEPLOY.get(_int(st, 2)), vtol=DEPLOY.get(_int(st, 3)))
            if ins is not None:
                bo = _msg(ins, 5)
                v.update(speed=_num(_f32(ins, 1)), h_fuel=_num(_f32(ins, 2), 3), q_fuel=_num(_f32(ins, 3), 3), g=_gauge(ins, 4),
                         altitude=_num(_f32(ins, 6), 0), radar_alt=_num(_f32(ins, 7), 0), vspeed=_num(_f32(ins, 8)),
                         heading=_num(_f32(ins, 10)),
                         boost={"on": _bool(bo, 1), "reserve": _num(_f32(bo, 3), 3), "critical": _bool(bo, 4)} if bo is not None else None)
            if se is not None:
                cpl, cru = _msg(se, 1), _msg(se, 5)
                v.update(coupled=_bool(cpl, 2) if cpl is not None else None, cruise=_bool(cru, 2) if cru is not None else None)
        pw = _msg(vs, 9)
        if pw is not None:
            v["power"] = {n: _bool(pw, i + 1) for i, n in enumerate(POWER_NAMES)}
        sh = _msg(vs, 10)
        if sh is not None:
            v["shields"] = {"level": _num(_f32(sh, 1), 3), "faces": [_num(x, 3) for x in _floats(sh, 2)]}
        hp = _f32(vs, 11, None)
        if hp is not None:
            v["health"] = _num(hp, 3)
        mm = _msg(vs, 12)
        if mm is not None:
            v["mode"] = MODE.get(_int(mm, 1))
            v["spooled"] = _bool(mm, 2)
        out["vehicle"] = v
    wf = _msg(top, 4)
    if wf is not None:
        out["weapons"] = {"preset": _str(wf, 3), "guns": [{"name": clean_name(_str(w, 1)), "powered": _bool(w, 2), "ready": _bool(w, 3)}
                                                            for w in _msgs(wf, 4)],
                          "countermeasures": [{"type": {1: "decoy", 2: "noise"}.get(_int(c, 1), "?"), "n": _int(c, 2)} for c in _msgs(wf, 5)]}
    ef = _msg(top, 5)
    if ef is not None:
        out["events"] = [EVENTS.get(_int(e, 1)) for e in _msgs(ef, 1) if EVENTS.get(_int(e, 1))]
    af = _msg(top, 6)
    if af is not None:
        vi, st, en = _msg(af, 1), _msg(af, 2), _msg(af, 3)
        a = {}
        if vi is not None:
            a.update(health=_gauge(vi, 1), oxygen=_gauge(vi, 2), hunger=_gauge(vi, 3), thirst=_gauge(vi, 4), body_temp=_gauge(vi, 5),
                     heart_rate=_num(_f32(vi, 7), 0), gravity=_num(_f32(vi, 8), 2), pressure=_num(_f32(vi, 9), 2))
        if st is not None:
            a.update(locomotion=LOCO.get(_int(st, 1)), role=ROLE.get(_int(st, 2)), seat=clean_name(_str(st, 3)),
                     auec=_i64(st, 4, None))
        if en is not None:
            t = _f32(en, 1)
            a.update(outside_temp=None if t <= -273 else _num(t), radiation=_num(_f32(en, 2), 3), breathable=_bool(en, 3))
        out["actor"] = a
    return out


# ---------------------------------------------------------------- the reader
class Telemetry(threading.Thread):
    """Listens to the game's telemetry while it's switched on. state() gives the latest of everything."""

    def __init__(self, port=DEFAULT_PORT, on_event=None, on_port=None):
        super().__init__(daemon=True, name="game-telemetry")
        self.port = int(port or DEFAULT_PORT)
        self.on_port = on_port                # fn(port): the game turned out to serve on another port (saved)
        self.may_discover = None              # fn() -> bool: you've been spawned in a while (the app sets it)
        self._listen = None                   # what the game is listening on, last looked at: {at, game, ports}
        self.enabled = False
        self.on_event = on_event              # fn(name, at): spawn, dead, downed, enter_seat... (the app's notes)
        self.on_frame = None                  # fn(frame, at): every decoded frame (session stats, earnings)
        self._lock = threading.Lock()
        self._wake = threading.Event()
        self._call = None
        self._status, self._error = "off", None
        self._latest, self._at, self._frames = {}, 0.0, []
        self._events = []                     # [(name, at)], newest last
        self._balance = None                  # last aUEC balance seen (kept through pauses)
        self._vehicle = None                  # last vehicle seen, and when you left it

    # the app's switch
    def set_enabled(self, on, port=None):
        if port:
            self.port = int(port)
        self.enabled = bool(on)
        if not on:
            self._cancel()
            with self._lock:
                self._status, self._error, self._latest = "off", None, {}
        self._wake.set()

    def _cancel(self):
        c = self._call
        if c is not None:
            try:
                c.cancel()
            except Exception:
                pass

    def run(self):
        backoff = 3
        while True:
            if not self.enabled:
                self._wake.wait(5)
                self._wake.clear()
                continue
            try:
                import grpc                    # optional dependency: only needed with telemetry on
            except Exception:
                with self._lock:
                    self._status, self._error = "no_grpc", "grpcio isn't installed in this copy of Quantum"
                self._wake.wait(30)
                self._wake.clear()
                continue
            with self._lock:
                if self._status not in ("connected", "paused"):
                    self._status = "waiting"
            try:
                with grpc.insecure_channel(f"localhost:{self.port}") as ch:
                    stream = ch.unary_stream(METHOD, request_serializer=lambda _: b"", response_deserializer=lambda b: b)
                    self._call = stream(None, wait_for_ready=False)
                    for raw in self._call:
                        if not self.enabled:
                            break
                        self._frame(raw)
                        backoff = 3
                with self._lock:
                    if self._status != "off":
                        self._status = "waiting"
            except Exception as e:
                code = getattr(e, "code", lambda: None)()
                name = getattr(code, "name", "") if code is not None else ""
                with self._lock:
                    if not self.enabled:
                        self._status = "off"
                    elif name in ("UNAVAILABLE", "DEADLINE_EXCEEDED", "CANCELLED", ""):
                        # the game isn't serving it (not running, or not switched on): kept as a hint, not an error
                        det = getattr(e, "details", None)
                        self._status, self._error = "waiting", (det() if callable(det) else str(e))[:200] or None
                    else:
                        self._status, self._error = "error", f"{name}: {getattr(e, 'details', lambda: str(e))()}"[:200]
                if self.enabled and name in ("UNAVAILABLE", "") and self._discover():
                    backoff = 1                  # found where the game really serves it: try that straight away
            finally:
                self._call = None
            self._wake.wait(backoff)
            self._wake.clear()
            backoff = min(30, backoff * 2)

    def _discover(self):
        """Nothing on our port: look at what Star Citizen is actually listening on (Windows), at most every 15 s.
        If it serves on another port, switch to it (and tell the app to save it). True if the port changed."""
        if os.name != "nt" or (self._listen and time.time() - self._listen["at"] < 15):
            return False
        if self.may_discover and not self.may_discover():
            return False                      # not spawned (long enough): the game doesn't serve it yet
        try:
            pids = game_pids()
            ports = listening_ports(pids) if pids else []
        except Exception:
            pids, ports = [], []
        with self._lock:
            self._listen = {"at": time.time(), "game": bool(pids), "ports": ports}
        if ports and (self.port not in ports or len(ports) > 1):
            # not ours, or ours and still refused: the next one it listens on (each tried in turn)
            self.port = ports[(ports.index(self.port) + 1) % len(ports)] if self.port in ports else ports[0]
            if self.on_port:
                try:
                    self.on_port(self.port)
                except Exception:
                    pass
            return True
        return False

    def _frame(self, raw):
        try:
            d = decode(raw)
        except Exception:
            return
        now = time.time()
        with self._lock:
            self._status, self._error = "connected", None
            self._at = now
            self._frames.append(now)
            while self._frames and now - self._frames[0] > FPS_WINDOW:
                self._frames.pop(0)
            if "vehicle" in d:
                self._hold(d["vehicle"], now)
                self._vehicle = {**d["vehicle"], "at": now}
            elif self._vehicle and not self._vehicle.get("left"):
                self._vehicle = {**self._vehicle, "left": now}
            bal = (d.get("actor") or {}).get("auec")
            if bal is not None:
                self._balance = {"auec": bal, "at": now}
            new = d.get("events") or []
            for ev in new:
                self._events.append((ev, now))
            del self._events[:-30]
            self._latest = d
        if self.on_frame:
            try:
                self.on_frame(d, now)
            except Exception:
                pass
        for ev in new:
            if self.on_event:
                try:
                    self.on_event(ev, now)
                except Exception:
                    pass

    def _hold(self, v, now):
        """The game doesn't send a ship's shields, hull and NAV/SCM mode in every frame: a frame without them made those
        items blink out of the bar until the next one that had them. The last reading is kept for the same ship for
        HOLD_S seconds, so they stay put; a ship with no shields (or a new ship) still shows none. Called under the lock."""
        held = getattr(self, "_held", None)
        if held is None or held.get("name") != v.get("name"):
            held = self._held = {"name": v.get("name")}
        for k in HELD_KEYS:
            if v.get(k) is not None:
                held[k] = (v[k], now)
            elif k in held and now - held[k][1] <= HOLD_S:
                v[k] = held[k][0]

    def state(self):
        """{on, status, error, fps, age, vehicle, weapons, actor, balance, events} for the page."""
        with self._lock:
            now = time.time()
            st = self._status
            if st == "connected" and now - self._at > STALE_S:
                st = "paused"                                   # menus, loading or not spawned
            fps = len(self._frames) / FPS_WINDOW if self._frames and now - self._frames[-1] < STALE_S else 0
            d = self._latest if st == "connected" else {}
            return {"on": self.enabled, "status": st, "error": self._error if st in ("error", "no_grpc") else None,
                    "detail": self._error if st == "waiting" else None, "port": self.port, "fps": round(fps, 1),
                    "age": round(now - self._at, 1) if self._at else None,
                    "vehicle": d.get("vehicle"), "weapons": d.get("weapons"), "actor": d.get("actor"),
                    "last_vehicle": self._vehicle, "balance": self._balance, "listen": self._listen,
                    "events": [{"type": e, "at": t} for e, t in self._events[-8:]]}


# ---------------------------------------------------------------- what's running (Windows tools only, no extra packages)
def _run(cmd, timeout=10):
    return subprocess.run(cmd, capture_output=True, text=True, timeout=timeout, errors="replace",
                          creationflags=getattr(subprocess, "CREATE_NO_WINDOW", 0)).stdout or ""


def _pids(image):
    out = _run(["tasklist", "/FI", f"IMAGENAME eq {image}", "/FO", "CSV", "/NH"])
    pids = []
    for line in out.splitlines():
        cells = [c.strip('"') for c in line.split('","')]
        if len(cells) > 1 and cells[0].strip('"').lower() == image.lower() and cells[1].isdigit():
            pids.append(int(cells[1]))
    return pids


def game_pids():
    return _pids("StarCitizen.exe")


def listening_ports(pids):
    """Ports those processes listen on, on this PC only (loopback first). From netstat -ano."""
    want, found = {str(p) for p in pids}, []
    for proto in ("TCP", "TCPv6"):
        for line in _run(["netstat", "-ano", "-p", proto]).splitlines():
            parts = line.split()
            if len(parts) >= 5 and parts[3].upper() == "LISTENING" and parts[4] in want:
                addr, _, port = parts[1].rpartition(":")
                if port.isdigit():
                    found.append((0 if addr in ("127.0.0.1", "[::1]") else 1, int(port)))
    return [p for _, p in sorted(set(found))]


LAUNCHER_EXE = "RSI Launcher.exe"


def launcher_path(log_path=None):
    """Where the RSI Launcher is: the running one's path, else the usual places next to the game."""
    try:
        out = _run(["powershell", "-NoProfile", "-Command",
                    "(Get-Process -Name 'RSI Launcher' -ErrorAction SilentlyContinue | Select-Object -First 1).Path"], timeout=15).strip()
        if out and Path(out).exists():
            return out
    except Exception:
        pass
    cands = []
    if log_path:
        root = Path(log_path).parent.parent.parent           # ...\Roberts Space Industries
        cands.append(root / "RSI Launcher" / LAUNCHER_EXE)
    for base in (os.environ.get("ProgramFiles"), os.environ.get("ProgramFiles(x86)"), os.environ.get("LOCALAPPDATA")):
        if base:
            cands += [Path(base) / "Roberts Space Industries" / "RSI Launcher" / LAUNCHER_EXE, Path(base) / "Programs" / "RSI Launcher" / LAUNCHER_EXE]
    return next((str(c) for c in cands if c.exists()), None)


def _spawn_launcher(path, env):
    """Start the RSI Launcher on its own: no console, and not tied to Quantum's. Its output goes nowhere (before,
    it inherited Quantum's console: the launcher's log filled Quantum's CMD window, and that window stayed open
    after Quantum closed because the launcher was still holding it)."""
    subprocess.Popen([path], cwd=str(Path(path).parent), env=env, close_fds=True,
                     stdin=subprocess.DEVNULL, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL,
                     creationflags=getattr(subprocess, "DETACHED_PROCESS", 0) | getattr(subprocess, "CREATE_NEW_PROCESS_GROUP", 0))


def launcher_running():
    """Is the RSI Launcher running? (Windows; elsewhere never.)"""
    return os.name == "nt" and bool(_pids(LAUNCHER_EXE))


def start_launcher(log_path=None, telemetry=True):
    """The sidebar's Start Launcher button: start the RSI Launcher if it isn't running (never closes anything).
    With telemetry on, it's given the setting directly too, so the game it starts serves its telemetry.
    -> {ok, error, path, already}."""
    if os.name != "nt":
        return {"ok": False, "error": "Only on Windows"}
    if _pids(LAUNCHER_EXE):
        return {"ok": True, "already": True}
    path = launcher_path(log_path)
    if not path:
        return {"ok": False, "error": "Couldn't find the RSI Launcher. Start it from the Start menu once and Quantum will find it after that"}
    env = dict(os.environ, **({"GRPC_CLIENT_SERVER_ENABLED": "true"} if telemetry else {}))
    try:
        _spawn_launcher(path, env)
    except OSError as e:
        return {"ok": False, "error": f"Couldn't start the RSI Launcher: {e}", "path": path}
    return {"ok": True, "path": path}


def restart_launcher(log_path=None):
    """Close the RSI Launcher and start it again with the telemetry setting given to it directly, so the game it
    starts serves its telemetry (whatever Windows' own copy of the setting says). Refused while Star Citizen runs:
    the game only reads it when it starts, and Quantum never closes the game for you. -> {ok, error, path}."""
    if os.name != "nt":
        return {"ok": False, "error": "Only on Windows"}
    if game_pids():
        return {"ok": False, "game_running": True, "error": "Close Star Citizen first: it only reads the setting when it starts"}
    path = launcher_path(log_path)
    if not path:
        return {"ok": False, "error": "Couldn't find the RSI Launcher. Quit it from its icon by the clock and start it again yourself"}
    if _pids(LAUNCHER_EXE):
        _run(["taskkill", "/IM", LAUNCHER_EXE, "/T", "/F"], timeout=20)
        for _ in range(20):
            if not _pids(LAUNCHER_EXE):
                break
            time.sleep(0.5)
    env = dict(os.environ, GRPC_CLIENT_SERVER_ENABLED="true")
    try:
        _spawn_launcher(path, env)
    except OSError as e:
        return {"ok": False, "error": f"Couldn't start the RSI Launcher: {e}", "path": path}
    return {"ok": True, "path": path}


# ---------------------------------------------------------------- switching the game's side on
def _channels(log_path):
    """The game channel folders (LIVE, PTU...) next to Game.log: where USER.cfg goes."""
    folders = set()
    if log_path:
        p = Path(log_path).parent
        folders.add(p)
        if p.parent.exists():
            for ch in ("LIVE", "PTU", "EPTU", "TECH-PREVIEW"):
                if (p.parent / ch / "Bin64").exists() or (p.parent / ch / "Game.log").exists():
                    folders.add(p.parent / ch)
    return sorted(folders)


CFG_LINE = re.compile(r"(?im)^\s*server\.game\.telemetry\.enabled\s*=\s*1\b")


def _env_set():
    """Is GRPC_CLIENT_SERVER_ENABLED=true saved for your Windows user? (Read from the registry: Quantum's own
    environment only has it after Quantum restarts.) None off Windows."""
    if os.name != "nt":
        return None
    try:
        import winreg
        with winreg.OpenKey(winreg.HKEY_CURRENT_USER, "Environment") as k:
            v, _ = winreg.QueryValueEx(k, "GRPC_CLIENT_SERVER_ENABLED")
        return str(v).strip().lower() in ("true", "1", "yes")
    except OSError:
        return False


def game_ready(log_path=None):
    """Is the game's side switched on? {env, channels: [{name, cfg}], configured, known}.
    known: False while Quantum hasn't found Game.log, so it can't look for USER.cfg."""
    env = _env_set()
    ch = []
    for f in _channels(log_path):
        try:
            text = (f / "USER.cfg").read_text(encoding="utf-8", errors="replace") if (f / "USER.cfg").exists() else ""
        except OSError:
            text = ""
        ch.append({"name": f.name, "cfg": bool(CFG_LINE.search(text))})
    configured = (env is not False) and bool(ch) and all(c["cfg"] for c in ch)
    return {"env": env, "channels": ch, "configured": configured, "known": bool(ch)}


def setup_game(log_path=None):
    """Turn the game's telemetry server on for this PC: the 4.10 environment variable (for your Windows user) and,
    for 5.0, the USER.cfg line in the game channel folders next to Game.log (LIVE, PTU...). -> {ok, did: [...], error}.
    Takes effect the next time the RSI Launcher and the game start."""
    did, errs = [], []
    if os.name == "nt":
        try:
            r = subprocess.run(["setx", "GRPC_CLIENT_SERVER_ENABLED", "true"], capture_output=True, text=True, timeout=20,
                               creationflags=getattr(subprocess, "CREATE_NO_WINDOW", 0))
            if r.returncode == 0:
                did.append("Set GRPC_CLIENT_SERVER_ENABLED=true for your Windows user (4.10)")
            else:
                errs.append((r.stderr or r.stdout or "setx failed").strip()[:150])
        except Exception as e:
            errs.append(f"Couldn't set the environment variable: {e}")
    folders = _channels(log_path)
    for f in folders:
        cfg = f / "USER.cfg"
        try:
            text = cfg.read_text(encoding="utf-8", errors="replace") if cfg.exists() else ""
            if re.search(r"(?im)^\s*server\.game\.telemetry\.enabled\s*=\s*1\b", text):
                did.append(f"{f.name}\\USER.cfg already has it")
                continue
            text = re.sub(r"(?im)^\s*server\.game\.telemetry\.enabled\s*=.*\n?", "", text)
            if text and not text.endswith("\n"):
                text += "\n"
            cfg.write_text(text + "server.game.telemetry.enabled = 1\n", encoding="utf-8")
            did.append(f"Added server.game.telemetry.enabled = 1 to {f.name}\\USER.cfg (5.0)")
        except Exception as e:
            errs.append(f"{f.name}\\USER.cfg: {e}")
    if not folders:
        errs.append("Quantum hasn't found your Game.log yet, so it doesn't know where USER.cfg goes")
    return {"ok": bool(did), "did": did, "error": "; ".join(errs) or None}
