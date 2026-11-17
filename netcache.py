"""Shared rules for data Quantum downloads from other people's services (UEX, the Star Citizen Wiki,
starcitizen.tools, RSI), so the app asks them as little as it can.

Two things live here:

1. The patch gate. Reference data (terminals, commodities, item lists, ships, gear) only really changes
   with a game patch. Instead of fetching it again every day, it's kept until the game version changes,
   with two safety nets:
     - for the first few days after a new patch it's still refreshed daily, because UEX and the wiki
       catch up with a patch over a day or two after it lands;
     - nothing is kept longer than MAX_AGE, in case a patch goes unnoticed.
   The game version comes from whatever the app registers with set_patch_source(): the LIVE Game.log's
   build when there is one (our own data, no API call), otherwise UEX's game_versions list.

2. Backoff. When a service says "too many requests" (HTTP 429, or UEX's requests_limit_reached), every
   fetch to that host stops for a while and callers serve what they already have, instead of each one
   asking again and making it worse.
"""
import json
import threading
import time
import urllib.parse
from pathlib import Path

DAY = 86400
MAX_AGE = 7 * DAY            # reference data is never kept longer than this, patch or not
SETTLE = 3 * DAY             # after a new patch is first seen: refresh daily for this long
SETTLE_TTL = DAY             # ...at this interval (what everything used before the gate)
UNKNOWN_TTL = 3 * DAY        # when no game version is known at all
COOLDOWN = 90                # s to leave a host alone after it says "too many requests"
KEY_TTL = 60                 # s between asks of the patch source

_lock = threading.Lock()
_state = {"dir": None, "seen": {}}         # seen: patch key -> when it was first seen
_source = [None]
_key = [None, 0.0]                          # last patch key, when it was worked out
_cool = {}                                  # host -> until when it's left alone


# ---------------------------------------------------------------- setup
def init(cache_dir):
    """Where the 'first seen' times of game versions are kept between runs."""
    d = Path(cache_dir)
    with _lock:
        _state["dir"] = d
        try:
            _state["seen"] = json.loads((d / "patch_seen.json").read_text(encoding="utf-8")) or {}
        except (OSError, ValueError):
            _state["seen"] = {}


def set_patch_source(fn):
    """fn() -> "log:12913470" / "uex:4.10.2" / None. Prefixed by where it came from, so two different
    sources are never compared with each other (that would look like a patch every time they alternate)."""
    _source[0] = fn
    _key[1] = 0.0


def _save_seen():
    d = _state["dir"]
    if not d:
        return
    try:
        d.mkdir(parents=True, exist_ok=True)
        tmp = d / "patch_seen.json.tmp"
        tmp.write_text(json.dumps(_state["seen"]), encoding="utf-8")
        tmp.replace(d / "patch_seen.json")
    except OSError:
        pass


# ---------------------------------------------------------------- the patch gate
def patch_key():
    """The current game version key, or None. Never raises."""
    now = time.time()
    if now - _key[1] < KEY_TTL:
        return _key[0]
    key = None
    try:
        key = _source[0]() if _source[0] else None
    except Exception:
        key = None
    with _lock:
        _key[0], _key[1] = key, now
        if key and key not in _state["seen"]:
            _state["seen"][key] = now
            # only the newest few are worth keeping
            _state["seen"] = dict(sorted(_state["seen"].items(), key=lambda kv: kv[1])[-20:])
            _save_seen()
    return key


def static_fresh(at, patch, now=None):
    """Is reference data fetched at `at` (under game version key `patch`) still good to use?"""
    now = now or time.time()
    age = now - (at or 0)
    if age >= MAX_AGE:
        return False
    cur = patch_key()
    if not cur or not patch or cur.split(":", 1)[0] != patch.split(":", 1)[0]:
        return age < UNKNOWN_TTL
    if cur != patch:
        return False                                        # a new patch since it was fetched
    first = _state["seen"].get(cur, 0)
    if now - first < SETTLE:
        return age < SETTLE_TTL                             # the patch is new: services are still catching up
    return True


# ---------------------------------------------------------------- backoff
def host_of(url):
    return urllib.parse.urlsplit(url).hostname or url


def cooling(url_or_host):
    """Seconds this host is still being left alone (0 when it can be asked)."""
    host = host_of(url_or_host) if "/" in url_or_host else url_or_host
    with _lock:
        left = _cool.get(host, 0) - time.time()
    return max(0, int(left + 0.999))


def cool(url_or_host, seconds=None):
    """The host said "too many requests": leave it alone for a while (Retry-After if it gave one)."""
    host = host_of(url_or_host) if "/" in url_or_host else url_or_host
    try:
        s = float(seconds) if seconds is not None else COOLDOWN
    except (TypeError, ValueError):
        s = COOLDOWN
    s = min(max(s, 10), 15 * 60)
    with _lock:
        _cool[host] = max(_cool.get(host, 0), time.time() + s)


class Cooling(OSError):
    """Not asked: the host recently said "too many requests". Callers treat it like a network error,
    which every fetcher in the app already handles by serving its cached copy."""


def guard(url):
    """Call before a request. Raises Cooling while the host is being left alone."""
    left = cooling(url)
    if left:
        raise Cooling(f"{host_of(url)} asked us to slow down; trying again in {left} s")


def note_error(url, err):
    """Call with an HTTPError from a request: a 429 (or 503 with Retry-After) starts the cooldown."""
    code = getattr(err, "code", None)
    if code == 429 or (code == 503 and getattr(err, "headers", None) and err.headers.get("Retry-After")):
        cool(url, err.headers.get("Retry-After") if getattr(err, "headers", None) else None)


def fetch(req_or_url, timeout=30, opener=None):
    """urllib.request.urlopen with the guard and the 429 bookkeeping around it. Returns the open
    response (use it in a with-block, as with urlopen)."""
    import urllib.error
    import urllib.request
    url = req_or_url.full_url if hasattr(req_or_url, "full_url") else req_or_url
    guard(url)
    try:
        return (opener or urllib.request.urlopen)(req_or_url, timeout=timeout)
    except urllib.error.HTTPError as e:
        note_error(url, e)
        raise
