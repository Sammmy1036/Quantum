import hashlib
import sys
import threading
from pathlib import Path

try:
    from updater import VERSION
except Exception:                       
    VERSION = "0"

_value = [None]
_ready = threading.Event()          # set once the build id has been worked out (or failed)
WAIT = 60                           # longest a request waits for it, in seconds


def build_for(exe, base):
    h = hashlib.sha256()
    with open(exe, "rb") as f:
        for chunk in iter(lambda: f.read(1 << 20), b""):
            h.update(chunk)
    base = Path(base)
    ui = base / "ui"
    if ui.is_dir():
        for p in sorted(x for x in ui.rglob("*") if x.is_file() and x.suffix.lower() in (".html", ".js", ".css")):
            h.update(str(p.relative_to(base)).replace("\\", "/").encode("utf-8") + b"\0")
            h.update(p.read_bytes())
    return h.hexdigest()


def _compute():
    try:
        if getattr(sys, "frozen", False):
            digest = build_for(sys.executable, getattr(sys, "_MEIPASS", Path(sys.executable).parent))
            kind = "exe"
        else:
            h = hashlib.sha256()
            here = Path(__file__).resolve().parent
            files = sorted(here.glob("*.py")) + [here / "ui" / "index.html"]
            for p in files:
                if p.is_file():
                    h.update(p.name.encode("utf-8") + b"\0")
                    h.update(p.read_bytes().replace(b"\r\n", b"\n"))
            digest, kind = h.hexdigest(), "src"
        _value[0] = f"{VERSION}; {kind}; {digest}"
    except Exception:
        _value[0] = ""
    finally:
        _ready.set()


def start():
    threading.Thread(target=_compute, daemon=True, name="client-id").start()


def header():
    # Hashing the whole Quantum.exe takes a few seconds, and the app talks to the server as soon as it starts.
    # Without waiting, those first calls went out with no build id and showed up as "Older version" on the server.
    _ready.wait(WAIT)
    return _value[0] or ""


def build_id():
    v = _value[0] or ""                 # for Settings: doesn't wait, shows nothing until it's ready
    return v.rsplit(";", 1)[-1].strip() if v else ""


start()
