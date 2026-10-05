"""UEX datarunner reports: send the prices you see at a commodity terminal to UEX
(https://uexcorp.space/api/documentation/id/post_data_submit/).

TEST MODE (the default, and the only mode until LIVE_SUBMISSIONS_ENABLED is flipped below):
nothing is sent anywhere. Each report is checked against every rule in the UEX docs, then written to
datarunner_test/<time>_<terminal>/ exactly as it would be sent:

  request.json    the exact POST body (screenshot included as base64)
  preview.json    the same, readable: URL, headers (secrets masked), screenshot left out
  screenshot.png  the screenshot that would be attached
  response.json   what UEX would most likely answer: "ok" or the error code its docs list

Screenshots: Windows only, pure ctypes. The Star Citizen window is grabbed from the desktop (works in
borderless/windowed; exclusive fullscreen may come out black). Several shots of a long list are stacked
into one picture, because UEX takes one screenshot per report.
"""
import base64
import json
import os
import re
import struct
import time
import urllib.error
import urllib.request
import zlib
from pathlib import Path

# Flip to True only when the test reports look right. While False, nothing can reach UEX.
LIVE_SUBMISSIONS_ENABLED = True

SUBMIT_URL = "https://api.uexcorp.uk/2.0/data_submit"
MAX_ROWS = 500
MAX_SHOT = 10 * 1024 * 1024                  # UEX: screenshot up to 10 MB
SHOT_BUDGET = 9 * 1024 * 1024                # stay under it with room to spare
MAX_SHOTS = 4
CONTAINER_SIZES = {1, 2, 4, 8, 16, 24, 32}
DUPLICATE_WINDOW = 300                       # UEX rejects the same item at the same terminal within 5 min
STATUS = {1: "Out of stock", 2: "Very low", 3: "Low", 4: "Medium", 5: "High", 6: "Very high", 7: "Full"}

# Plain-language versions of UEX's response codes, for the app to show.
MESSAGES = {
    "missing_secret_key": "Add your UEX datarunner secret key in Settings (from your UEX profile)",
    "invalid_secret_key": "UEX didn't accept the secret key. Copy it again from your UEX profile",
    "missing_id_terminal": "Pick a terminal",
    "terminal_not_found": "That terminal isn't in UEX's list",
    "missing_prices_array": "Tick at least one commodity to report",
    "max_rows_exceeded": "A report can hold at most 500 rows",
    "missing_id_commodity": "A row has no commodity",
    "invalid_id_commodity": "A row has a commodity UEX doesn't know",
    "has_no_prices_and_no_is_missing_set": "A ticked row has no price. Enter one or mark it as not sold here",
    "has_both_price_buy_and_price_sell": "A row has both a buy and a sell price",
    "has_both_scu_buy_and_scu_sell": "A row has both buy and sell stock",
    "cannot_have_both_status_buy_and_status_sell": "A row has both a buy and a sell inventory level",
    "cannot_have_both_price_buy_and_scu_sell": "A buy row has sell stock",
    "cannot_have_both_price_buy_and_status_sell": "A buy row has a sell inventory level",
    "cannot_have_both_price_sell_and_scu_buy": "A sell row has buy stock",
    "cannot_have_both_price_sell_and_status_buy": "A sell row has a buy inventory level",
    "invalid_status_buy": "Inventory level must be 1 to 7",
    "invalid_status_sell": "Inventory level must be 1 to 7",
    "invalid_quality": "Quality must be 0 to 1000",
    "faction_affinity_under_minimum_range": "Faction affinity can't be below -100",
    "faction_affinity_under_maximum_range": "Faction affinity can't be above 100",
    "screenshot_required": "Take a screenshot of the terminal first (UEX needs one from new datarunners)",
    "screenshot_length_exceeds_limit": "The screenshot is over 10 MB. Clear some shots and try again",
    "duplicated_report": "UEX already has a report of this item at this terminal from the last 5 minutes "
                         "(from you, on the UEX site or another app). It takes each item once every 5 minutes",
    "incomplete_row": "Every reported row needs its price, SCU and inventory level (UEX guide, step 3)",
    "game_not_running": "Star Citizen isn't running. Reports can only be sent while you're in game, at the kiosk",
    "game_version_unknown": "Couldn't read the game version from Game.log. Restart Star Citizen and try again",
    "invalid_date": "The report date must be in the past 30 days",
    "invalid_input": "The report couldn't be read as JSON",
    "ptu_reports_not_allowed": "UEX isn't taking PTU reports right now",
    "user_not_allowed": "UEX isn't taking reports from this account right now",
    "requests_limit_reached": "UEX request limit reached, try again in a minute",
}


def message(code):
    return MESSAGES.get(code, code.replace("_", " ").capitalize())


class DatarunnerError(Exception):
    pass


# ---------------------------------------------------------------- the report
def _num(v, cast=float):
    if v is None or (isinstance(v, str) and not v.strip()):
        return None
    try:
        return cast(str(v).replace(",", "").strip()) if isinstance(v, str) else cast(v)
    except (TypeError, ValueError):
        return "bad"


def build_payload(form, screenshot_b64=None, production=False):
    """The POST body from the app's form. Only rows the user ticked are included; a row is one side
    (buy or sell) of one commodity, which is how UEX wants them."""
    prices = []
    for r in form.get("rows") or []:
        if not r.get("include"):
            continue
        side = "buy" if r.get("side") == "buy" else "sell"
        row = {"id_commodity": _num(r.get("id_commodity"), int)}
        if r.get("missing"):
            row["is_missing"] = 1                     # UEX: leave prices empty when it's missing
        else:
            for key, cast in (("price", float), ("scu", int), ("status", int)):
                v = _num(r.get(key), cast)
                if isinstance(v, float) and v.is_integer():
                    v = int(v)                        # 2700, not 2700.0
                if v is not None:
                    row[f"{key}_{side}"] = v
            q = _num(r.get("quality"), int)
            if q is not None:
                row["quality"] = q
        prices.append(row)
    body = {"id_terminal": _num(form.get("id_terminal"), int), "type": "commodity",
            "is_production": 1 if production else 0, "prices": prices}
    fa = _num(form.get("faction_affinity"), int)
    if fa is not None:
        body["faction_affinity"] = fa
    sizes = [s for s in (_num(x, int) for x in form.get("container_sizes") or []) if s is not None]
    if sizes:
        body["container_sizes"] = ",".join(str(s) for s in sorted(set(sizes)))
    if (form.get("details") or "").strip():
        body["details"] = form["details"].strip()[:500]
    if (form.get("game_version") or "").strip():
        body["game_version"] = form["game_version"].strip()
    if screenshot_b64:
        body["screenshot"] = screenshot_b64
    return body


def validate(body, terminals=None, commodities=None, need_screenshot=True, history=None, now=None):
    """Every check UEX's docs list for a commodity report, in the order its error codes appear.
    -> list of error codes (empty = UEX should accept it)."""
    errs = []
    add = lambda c: errs.append(c) if c not in errs else None
    now = now or time.time()
    if body.get("type") != "commodity":
        add("invalid_type" if body.get("type") else "missing_type")
    tid = body.get("id_terminal")
    if not tid or tid == "bad":
        add("missing_id_terminal")
    elif terminals is not None and tid not in terminals:
        add("terminal_not_found")
    elif terminals is not None and terminals[tid].get("is_player_owned"):
        add("not_allowed_player_terminal")
    if "date_added" in body:
        d = body["date_added"]
        if not isinstance(d, int) or d > now or d < now - 30 * 86400:
            add("invalid_date")
    fa = body.get("faction_affinity")
    if fa is not None:
        if fa == "bad" or fa < -100:
            add("faction_affinity_under_minimum_range")
        elif fa > 100:
            add("faction_affinity_under_maximum_range")      # (sic) UEX's name for "above maximum"
    prices = body.get("prices")
    if not prices:
        add("missing_prices_array")
    elif not isinstance(prices, list):
        add("invalid_prices_array")
    elif len(prices) > MAX_ROWS:
        add("max_rows_exceeded")
    for p in prices or []:
        cid = p.get("id_commodity")
        if not cid or cid == "bad":
            add("missing_id_commodity")
            continue
        if commodities is not None and cid not in commodities:
            add("invalid_id_commodity")
        if any(v == "bad" for v in p.values()):
            add("invalid_prices_array_format")
        pb, ps = p.get("price_buy"), p.get("price_sell")
        if not pb and not ps and not p.get("is_missing"):
            add("has_no_prices_and_no_is_missing_set")
        if not p.get("is_missing") and not all(k in p for k in ("price_buy", "scu_buy", "status_buy")) \
                and not all(k in p for k in ("price_sell", "scu_sell", "status_sell")):
            add("incomplete_row")              # not a UEX code: the guide says no empty mandatory fields
        if pb and ps:
            add("has_both_price_buy_and_price_sell")
        if "scu_buy" in p and "scu_sell" in p:
            add("has_both_scu_buy_and_scu_sell")
        if "status_buy" in p and "status_sell" in p:
            add("cannot_have_both_status_buy_and_status_sell")
        if pb and "scu_sell" in p:
            add("cannot_have_both_price_buy_and_scu_sell")
        if pb and "status_sell" in p:
            add("cannot_have_both_price_buy_and_status_sell")
        if ps and "scu_buy" in p:
            add("cannot_have_both_price_sell_and_scu_buy")
        if ps and "status_buy" in p:
            add("cannot_have_both_price_sell_and_status_buy")
        for k in ("status_buy", "status_sell"):
            if k in p and p[k] not in STATUS:
                add("invalid_" + k)
        if "quality" in p and not (isinstance(p["quality"], int) and 0 <= p["quality"] <= 1000):
            add("invalid_quality")
        side = "buy" if pb or "scu_buy" in p else "sell"
        if history and now - history.get(f"{tid}:{cid}:{side}", 0) < DUPLICATE_WINDOW:
            add("duplicated_report")
    sizes = body.get("container_sizes")
    if sizes and not all(s.isdigit() and int(s) in CONTAINER_SIZES for s in sizes.split(",")):
        add("invalid_container_sizes")         # not a UEX code; UEX only lists the allowed values
    shot = body.get("screenshot")
    if shot and len(shot) > MAX_SHOT:
        add("screenshot_length_exceeds_limit")
    elif need_screenshot and not shot:
        add("screenshot_required")
    return errs


def price_warnings(body, current, variation):
    """Prices further from UEX's average than it tolerates: they may be held for review or refused.
    current: {(id_commodity, side): avg price}. variation: percent, e.g. 25."""
    out = []
    if not variation:
        return out
    for p in body.get("prices") or []:
        for side in ("buy", "sell"):
            v, avg = p.get(f"price_{side}"), current.get((p.get("id_commodity"), side))
            if v and avg and isinstance(v, (int, float)) and abs(v - avg) / avg * 100 > variation:
                out.append({"id_commodity": p["id_commodity"], "side": side, "price": v, "avg": avg,
                            "off_pct": round((v - avg) / avg * 100)})
    return out


# ---------------------------------------------------------------- sending (or not)
def _slug(text):
    return re.sub(r"[^A-Za-z0-9]+", "-", text or "terminal").strip("-")[:40] or "terminal"


def _mask(secret):
    return f"…{secret[-4:]}" if secret and len(secret) > 8 else ("(set)" if secret else "(missing)")


class Submitter:
    def __init__(self, test_dir):
        self.test_dir = Path(test_dir)
        self._test_hist = self.test_dir / "history.json"
        self._live_hist = self.test_dir.parent / "datarunner_history.json"

    @property
    def hist_file(self):
        """Test and live reports keep separate 5-minute histories: a test save must never block a real
        report (UEX never saw it)."""
        return self._live_hist if self.live else self._test_hist

    @property
    def live(self):
        return LIVE_SUBMISSIONS_ENABLED

    def history(self):
        try:
            return json.loads(self.hist_file.read_text(encoding="utf-8"))
        except Exception:
            return {}

    def _remember(self, body, now, sides=None):
        h = {k: t for k, t in self.history().items() if now - t < 3600}
        for i, p in enumerate(body.get("prices") or []):
            # a "gone" row carries no side in the report, so the app passes the sides along
            side = sides[i] if sides and i < len(sides) else "buy" if p.get("price_buy") or "scu_buy" in p else "sell"
            h[f"{body['id_terminal']}:{p['id_commodity']}:{side}"] = now
        self.hist_file.parent.mkdir(parents=True, exist_ok=True)
        self.hist_file.write_text(json.dumps(h), encoding="utf-8")

    def submit(self, body, token, secret, terminal_name="", errors=(), warnings=(), extra=None, sides=None):
        """Test mode: write the report to a folder. Live mode: POST it to UEX."""
        self._sides = sides
        if self.live:
            return self._send(body, token, secret)
        return self._write_test(body, token, secret, terminal_name, errors, warnings, extra)

    def _write_test(self, body, token, secret, terminal_name, errors, warnings, extra=None):
        now = time.time()
        folder = self.test_dir / f"{time.strftime('%Y%m%d-%H%M%S')}_{_slug(terminal_name)}"
        folder.mkdir(parents=True, exist_ok=True)
        (folder / "request.json").write_text(json.dumps(body, indent=1), encoding="utf-8")
        shot = body.get("screenshot")
        if shot:
            (folder / "screenshot.png").write_bytes(base64.b64decode(shot))
        preview = {"method": "POST", "url": SUBMIT_URL,
                   "headers": {"Authorization": f"Bearer {_mask(token)}", "secret-key": _mask(secret),
                               "Content-Type": "application/json", "User-Agent": "Quantum"},
                   "body": dict(body, screenshot=f"<{len(shot):,} chars of base64, see screenshot.png>")
                   if shot else body,
                   "terminal": terminal_name, "saved": time.strftime("%Y-%m-%d %H:%M:%S")}
        (folder / "preview.json").write_text(json.dumps(preview, indent=1, ensure_ascii=False), encoding="utf-8")
        if errors:
            resp = {"status": errors[0], "data": None, "all_problems": list(errors)}
        else:
            resp = {"status": "ok", "data": {"ids_reports": "TEST-" + str(int(now)), "date_added": int(now),
                                             "username": None}}
            self._remember(body, now, getattr(self, '_sides', None))
        resp["_note"] = ("Simulated by Quantum test mode. Nothing was sent to UEX. "
                         "A real reply would also need a valid token and secret key.")
        if not secret:
            resp["_would_also_fail"] = "missing_secret_key"
        if warnings:
            resp["_price_warnings"] = list(warnings)
        for k, v in (extra or {}).items():
            resp["_" + k] = v
        (folder / "response.json").write_text(json.dumps(resp, indent=1), encoding="utf-8")
        return {"ok": not errors, "test": True, "folder": str(folder), "status": resp["status"],
                "errors": [{"code": c, "text": message(c)} for c in errors]}

    def _send(self, body, token, secret):
        if not token or not secret:
            code = "missing_secret_key" if not secret else "no_api_found"
            return {"ok": False, "test": False, "status": code, "errors": [{"code": code, "text": message(code)}]}
        req = urllib.request.Request(SUBMIT_URL, data=json.dumps(body).encode("utf-8"), method="POST",
                                     headers={"Authorization": f"Bearer {token}", "secret-key": secret,
                                              "Content-Type": "application/json", "Accept": "application/json",
                                              "User-Agent": "Quantum"})
        try:
            with urllib.request.urlopen(req, timeout=60) as r:
                resp = json.loads(r.read().decode("utf-8"))
        except urllib.error.HTTPError as e:
            try:
                resp = json.loads(e.read().decode("utf-8"))
            except Exception:
                resp = {"status": f"http_{e.code}"}
        except Exception:
            resp = {"status": "service_unavailable"}
        st = resp.get("status") or "error"
        if st == "ok":
            self._remember(body, time.time(), getattr(self, '_sides', None))
            return {"ok": True, "test": False, "status": st, "data": resp.get("data")}
        return {"ok": False, "test": False, "status": st, "errors": [{"code": st, "text": message(st)}]}


# ---------------------------------------------------------------- screenshots
class Shot:
    def __init__(self, w, h, bgra):
        self.w, self.h, self.bgra, self.at = w, h, bgra, time.time()


def shrink(w, h, bgra, n):
    """Every n-th pixel of every n-th row (fast enough in pure Python: whole-row slicing)."""
    if n <= 1:
        return w, h, bgra
    nw, out, stride = (w + n - 1) // n, bytearray(), w * 4
    for y in range(0, h, n):
        row, small = bgra[y * stride:(y + 1) * stride], bytearray(nw * 4)
        for c in range(4):
            small[c::4] = row[c::4 * n]
        out += small
    return nw, (h + n - 1) // n, bytes(out)


def stack(shots):
    """One tall picture from several shots (a long inventory list scrolled in parts)."""
    shots = [s for s in shots if s.w == shots[0].w]
    return shots[0].w, sum(s.h for s in shots), b"".join(s.bgra for s in shots)


def png(w, h, bgra, level=6):
    rgb = bytearray(w * h * 3)
    rgb[0::3], rgb[1::3], rgb[2::3] = bgra[2::4], bgra[1::4], bgra[0::4]
    stride = w * 3
    raw = b"".join(b"\x00" + rgb[y * stride:(y + 1) * stride] for y in range(h))

    def chunk(tag, data):
        return struct.pack(">I", len(data)) + tag + data + struct.pack(">I", zlib.crc32(tag + data) & 0xFFFFFFFF)
    return (b"\x89PNG\r\n\x1a\n" + chunk(b"IHDR", struct.pack(">IIBBBBB", w, h, 8, 2, 0, 0, 0))
            + chunk(b"IDAT", zlib.compress(bytes(raw), level)) + chunk(b"IEND", b""))


def screenshot_b64(shots):
    """The shots as one base64 PNG under UEX's 10 MB, halving the size until it fits."""
    if not shots:
        return None
    w, h, data = stack(shots)
    for n in (1, 2, 3, 4):
        enc = base64.b64encode(png(*shrink(w, h, data, n))).decode("ascii")
        if len(enc) <= SHOT_BUDGET:
            return enc
    return enc


def thumbnail(shot, width=220):
    n = max(1, -(-shot.w // width))           # round up: never wider than asked
    return "data:image/png;base64," + base64.b64encode(png(*shrink(shot.w, shot.h, shot.bgra, n), level=3)).decode()


if os.name == "nt":
    import ctypes
    from ctypes import wintypes

    _u32, _gdi = ctypes.WinDLL("user32"), ctypes.WinDLL("gdi32")
    _u32.FindWindowW.restype = wintypes.HWND
    _u32.GetDC.restype = wintypes.HDC
    _gdi.CreateCompatibleDC.restype = wintypes.HDC
    _gdi.CreateCompatibleBitmap.restype = wintypes.HBITMAP
    _gdi.SelectObject.restype = wintypes.HGDIOBJ
    for f, args in ((_gdi.CreateCompatibleDC, (wintypes.HDC,)),
                    (_gdi.CreateCompatibleBitmap, (wintypes.HDC, ctypes.c_int, ctypes.c_int)),
                    (_gdi.SelectObject, (wintypes.HDC, wintypes.HGDIOBJ)),
                    (_gdi.DeleteObject, (wintypes.HGDIOBJ,)), (_gdi.DeleteDC, (wintypes.HDC,)),
                    (_u32.ReleaseDC, (wintypes.HWND, wintypes.HDC)),
                    (_gdi.BitBlt, (wintypes.HDC, ctypes.c_int, ctypes.c_int, ctypes.c_int, ctypes.c_int,
                                   wintypes.HDC, ctypes.c_int, ctypes.c_int, wintypes.DWORD)),
                    (_gdi.GetDIBits, (wintypes.HDC, wintypes.HBITMAP, wintypes.UINT, wintypes.UINT,
                                      ctypes.c_void_p, ctypes.c_void_p, wintypes.UINT)),
                    (_u32.GetClientRect, (wintypes.HWND, ctypes.POINTER(wintypes.RECT))),
                    (_u32.ClientToScreen, (wintypes.HWND, ctypes.POINTER(wintypes.POINT))),
                    (_u32.GetDC, (wintypes.HWND,)),
                    (_u32.FindWindowW, (wintypes.LPCWSTR, wintypes.LPCWSTR)),
                    (_u32.GetSystemMetrics, (ctypes.c_int,))):
        f.argtypes = args
    _gdi.BitBlt.restype = wintypes.BOOL
    _gdi.GetDIBits.restype = ctypes.c_int

    class _BMIH(ctypes.Structure):
        _fields_ = [("biSize", wintypes.DWORD), ("biWidth", wintypes.LONG), ("biHeight", wintypes.LONG),
                    ("biPlanes", wintypes.WORD), ("biBitCount", wintypes.WORD), ("biCompression", wintypes.DWORD),
                    ("biSizeImage", wintypes.DWORD), ("biXPelsPerMeter", wintypes.LONG),
                    ("biYPelsPerMeter", wintypes.LONG), ("biClrUsed", wintypes.DWORD),
                    ("biClrImportant", wintypes.DWORD)]

    try:
        _u32.SetThreadDpiAwarenessContext.argtypes = (ctypes.c_void_p,)
        _u32.SetThreadDpiAwarenessContext.restype = ctypes.c_void_p
        _HAS_DPI_CTX = True
    except AttributeError:                                 # older than Windows 10 1607
        _HAS_DPI_CTX = False

    class _MONITORINFO(ctypes.Structure):
        _fields_ = [("cbSize", wintypes.DWORD), ("rcMonitor", wintypes.RECT), ("rcWork", wintypes.RECT),
                    ("dwFlags", wintypes.DWORD)]

    _EnumProc = ctypes.WINFUNCTYPE(wintypes.BOOL, wintypes.HWND, wintypes.LPARAM)
    _u32.EnumWindows.argtypes = (_EnumProc, wintypes.LPARAM)
    _u32.GetWindowTextW.argtypes = (wintypes.HWND, wintypes.LPWSTR, ctypes.c_int)
    _u32.IsWindowVisible.argtypes = (wintypes.HWND,)
    _u32.IsIconic.argtypes = (wintypes.HWND,)
    _u32.MonitorFromWindow.argtypes = (wintypes.HWND, wintypes.DWORD)
    _u32.MonitorFromWindow.restype = wintypes.HMONITOR
    _u32.GetMonitorInfoW.argtypes = (wintypes.HMONITOR, ctypes.POINTER(_MONITORINFO))

    def _dpi(fn):
        """Run fn in real screen pixels (per-monitor DPI aware), whatever Quantum's own setting."""
        old = _u32.SetThreadDpiAwarenessContext(ctypes.c_void_p(-4)) if _HAS_DPI_CTX else None
        try:
            return fn()
        finally:
            if old:
                _u32.SetThreadDpiAwarenessContext(ctypes.c_void_p(old))

    def _client(hwnd):
        rc, pt = wintypes.RECT(), wintypes.POINT(0, 0)
        _u32.GetClientRect(hwnd, ctypes.byref(rc))
        _u32.ClientToScreen(hwnd, ctypes.byref(pt))
        return pt.x, pt.y, rc.right - rc.left, rc.bottom - rc.top

    def _monitor(hwnd):
        mi = _MONITORINFO()
        mi.cbSize = ctypes.sizeof(_MONITORINFO)
        _u32.GetMonitorInfoW(_u32.MonitorFromWindow(hwnd, 2), ctypes.byref(mi))   # MONITOR_DEFAULTTONEAREST
        r = mi.rcMonitor
        return r.left, r.top, r.right - r.left, r.bottom - r.top

    def game_windows():
        """Every visible top-level window titled exactly "Star Citizen", biggest first. The game has
        more than one (small helper windows too), so the first one found isn't necessarily the game."""
        def scan():
            found = []

            def cb(hwnd, _):
                buf = ctypes.create_unicode_buffer(64)
                _u32.GetWindowTextW(hwnd, buf, 64)
                if buf.value.strip() == "Star Citizen" and _u32.IsWindowVisible(hwnd):
                    x, y, w, h = _client(hwnd)
                    found.append((w * h, hwnd, (x, y, w, h)))
                return True
            _u32.EnumWindows(_EnumProc(cb), 0)
            return [(hwnd, rect) for _, hwnd, rect in sorted(found, key=lambda f: -f[0])]
        return _dpi(scan)

    def find_game():
        wins = game_windows()
        return wins[0][0] if wins else None

    def capture(hwnd=None):
        """A picture of the whole game. Borderless or fullscreen (the usual case): the whole monitor
        the game is on. Windowed: just the game's window. Measured in real screen pixels, so display
        scaling above 100% doesn't shrink or shift it."""
        hwnd = hwnd or find_game()
        if not hwnd:
            raise DatarunnerError("Star Citizen isn't open. Open the terminal in game first")
        if _u32.IsIconic(hwnd):
            raise DatarunnerError("Star Citizen is minimised")

        def grab():
            win, mon = _client(hwnd), _monitor(hwnd)
            covers = win[2] * win[3] >= 0.85 * mon[2] * mon[3]
            tiny = win[2] < 0.5 * mon[2] or win[3] < 0.5 * mon[3]
            rect, how = (mon, "monitor") if covers or tiny else (win, "window")
            shot = _grab(*rect)
            shot.rect, shot.how, shot.window = rect, how, win
            return shot
        return _dpi(grab)

    def _grab(x, y, w, h):
        if w <= 0 or h <= 0:
            raise DatarunnerError("Star Citizen's window has no size (minimised?)")
        screen = _u32.GetDC(None)
        mem = _gdi.CreateCompatibleDC(screen)
        bmp = _gdi.CreateCompatibleBitmap(screen, w, h)
        old = _gdi.SelectObject(mem, bmp)
        try:
            _gdi.BitBlt(mem, 0, 0, w, h, screen, x, y, 0x00CC0020 | 0x40000000)   # SRCCOPY | CAPTUREBLT
            hdr = _BMIH(ctypes.sizeof(_BMIH), w, -h, 1, 32, 0, 0, 0, 0, 0, 0)       # top-down rows
            buf = ctypes.create_string_buffer(w * h * 4)
            if not _gdi.GetDIBits(mem, bmp, 0, h, buf, ctypes.byref(hdr), 0):
                raise DatarunnerError("Couldn't read the screen")
            shot = Shot(w, h, buf.raw)
            shot.rect = (x, y, w, h)
            return shot
        finally:
            _gdi.SelectObject(mem, old)
            _gdi.DeleteObject(bmp)
            _gdi.DeleteDC(mem)
            _u32.ReleaseDC(None, screen)
else:
    def capture(hwnd=None):
        raise DatarunnerError("Screenshots only work on Windows")

    def find_game():
        return None
