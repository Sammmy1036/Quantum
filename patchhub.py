"""Patch Hub: what's new in Star Citizen, in one place.

  versions     the LIVE build and, while one is running, the PTU build      RSI Spectrum + the wiki's game versions
  patch notes  LIVE and PTU notes, split into sections                      RSI Spectrum (Patch Notes forum),
                                                                              LIVE also from the Comm-Link copy
  new ships    ships and vehicles new in the LIVE build                     Star Citizen Wiki (game files, per version)
  on the PTU   ships in the PTU build that LIVE doesn't have yet            the same, PTU build against LIVE
  events       running now and coming up, with dates                        This Week in Star Citizen's schedule, event
                                                                              Comm-Links, and your own events.json
  store        new ships and special editions in the RSI store              RSI's upgrade tool (as ccu.py)
  in concept   ships announced but not in the game yet                      the Ship Matrix via the Star Citizen Wiki

Ships are compared by the game's own id (uuid), not their names, so a ship that was renamed (the Constellations
becoming "Mk IV" in 4.10) isn't mistaken for a new one.

Standard library only (plus ccu.py, or the server's sccu.py, for the store), so the same file runs in the app and on
the Quantum server: the server builds it every so often and serves it at /v1/patchhub; the app asks the server first
and builds it itself only when the server doesn't have it.

Every source is tried on its own: one that fails keeps its last good copy and says so in "sources", so a change on
RSI's side never empties the whole page. RSI's Spectrum and store calls aren't public APIs (the same calls RSI's own
pages make): they are the ones most likely to need a fix one day.
  python patchhub.py            tries every source and prints what came back
  python patchhub.py --debug    also prints the raw things the decisions were made from (send this when it's wrong)

Data from the Star Citizen Wiki API (api.star-citizen.wiki): credit it where the page is shown.
"""
import datetime as _dt
import http.cookiejar
import json
import re
import sys
import threading
import time
import urllib.error
import urllib.parse
import urllib.request
from pathlib import Path

WIKI = "https://api.star-citizen.wiki/api"
RSI = "https://robertsspaceindustries.com"
PATCH_NOTES_CHANNEL = "190048"            # Spectrum: Star Citizen > Patch Notes
UA = {"User-Agent": "Quantum (Star Citizen route planner; github.com/Sammmy1036/Quantum)"}
TTL = 30 * 60                             # a fresh build after 30 minutes
VERSION = 9                               # the data's shape: bump it whenever that changes, so an app never shows
                                          # a server copy built by older code (or the other way round)

LINKS = {"notes": f"{RSI}/spectrum/community/SC/forum/{PATCH_NOTES_CHANNEL}",
         "ships": "https://starcitizen.tools/Ships",
         "events": f"{RSI}/en/comm-link",
         "store": f"{RSI}/en/pledge/ship-upgrades",
         "pipeline": f"{RSI}/en/ship-matrix"}

ALPHA = re.compile(r"alpha\s*(?:patch\s*)?(\d+\.\d+(?:\.\d+)?)([a-z])?", re.I)
VERNUM = re.compile(r"(?<![\d.])(\d{1,2}\.\d{1,2}(?:\.\d{1,2})?)([a-z])?(?![\d.])")
BUILD = re.compile(r"\b(LIVE|PTU|EPTU|HOTFIX)[\s.\-]*(\d{6,9})\b", re.I)
BUILDNUM = re.compile(r"(?<![\d.])(\d{7,9})(?![\d.])")          # "... PTU RC1 Patch Notes 13160301"
TAG = re.compile(r"^\s*\[([^\]]{1,40})\]")                        # "[All Waves]", "[Now Closed]"
WAVE = re.compile(r"(?:audience|wave)\s*:?\s*(wave\s*\d+|all backers|all waves|evocati|everyone|\d+)", re.I)
JUNK = re.compile(r"(?i)\b(test|template|placeholder|dummy|unmanned|ai only|npc)\b|_ai_|_npc|\[PH\]")
EVENT_RE = re.compile(r"(?i)free[\s-]*fly|\bevent\b|invictus|\biae\b|aerospace expo|festival|luminalia|coramor|"
                      r"stella fortuna|day of the vara|showdown|citizencon|anniversary|launch week|xenothreat|"
                      r"jumptown|siege of orison|blockade|alien week|referral bonus|discovery month|\bmonth\b|"
                      r"\bexpo\b|best in show|celebration|rally|tournament|championship|drops campaign|twitch drops|"
                      r"\bsale\b|double (?:xp|rep)|bonus week")
NOT_EVENT = re.compile(r"(?i)this week in star citizen|monthly report|roadmap|patch notes|^star citizen alpha|"
                       r"newsletter|subscriber|community mvp|bar citizen|q&a|inside star citizen|star citizen live|"
                       r"^galactapedia|loremaker|portfolio|showdown voting results")
QUIET = {"bug fixes", "technical", "known issues", "known issue", "fixes", "bug fixes and technical updates",
         "technical updates"}
HEADERS = {"features & gameplay", "features and gameplay", "locations", "gameplay", "ships and vehicles",
           "ships & vehicles", "new ships and vehicles", "weapons and items", "weapons & items", "core tech",
           "technical", "bug fixes", "known issues", "ai", "economy", "missions", "mission content", "ui", "audio",
           "testing/feedback focus", "testing focus", "testing / feedback focus", "player", "art", "general",
           "new additions", "updates", "characters", "arena commander", "star marine", "server", "networking",
           "features", "fixes", "highlights", "graphics", "physics", "persistence", "bug fixes and technical updates"}
INFO_KEYS = {"database reset", "long term persistence", "starting auec", "pledge copy", "audience",
             "server info", "character reset", "region", "regions"}
PREAMBLE = re.compile(r"(?i)^(important build info|this spectrum post is an abridged|patch should now show|"
                      r"alpha patch .* has (now )?been released|launcher should now show|full .*release notes|"
                      r"please monitor|for the full in-depth details)")

MON = (r"(jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?|apr(?:il)?|may|june?|july?|aug(?:ust)?|sep(?:t(?:ember)?)?|"
       r"oct(?:ober)?|nov(?:ember)?|dec(?:ember)?)")
SEP = r"\s*(?:-|–|—|to|through|thru|until|till|and runs? (?:until|through))\s*"
TIME = r"(?:,?\s*(?:at|from)?\s*(\d{1,2}:\d{2})\s*(?:utc|gmt))?"
RANGE1 = re.compile(MON + r"\.?\s+(\d{1,2})(?:st|nd|rd|th)?(?:,?\s*(\d{4}))?" + TIME + SEP + r"(?:" + MON +
                    r"\.?\s+)?(\d{1,2})(?:st|nd|rd|th)?(?:,?\s*(\d{4}))?" + TIME, re.I)
RANGE2 = re.compile(r"(\d{1,2})(?:st|nd|rd|th)?" + SEP + r"(\d{1,2})(?:st|nd|rd|th)?\s+" + MON + r"(?:,?\s*(\d{4}))?", re.I)
RANGE3 = re.compile(r"(?:from|starting|starts|begins?|opens?)\s+(?:on\s+)?" + MON + r"\.?\s+(\d{1,2})(?:st|nd|rd|th)?" + TIME +
                    r".{0,90}?(?:until|through|to|ends?(?:\s+on)?|closes?(?:\s+on)?)\s+" + MON + r"\.?\s+(\d{1,2})(?:st|nd|rd|th)?" + TIME,
                    re.I | re.S)
DAYHDR = re.compile(r"^(?:mon|tues|wednes|thurs|fri|satur|sun)day,?\s+" + MON + r"\.?\s+(\d{1,2}),?\s*(\d{4})?\s*$", re.I)


# ------------------------------------------------------------------ helpers
def _json(url, body=None, headers=None, timeout=30, opener=None, method=None):
    data = json.dumps(body).encode("utf-8") if body is not None else None
    h = {**UA, "Accept": "application/json", **({"Content-Type": "application/json"} if data else {}), **(headers or {})}
    req = urllib.request.Request(url, data=data, headers=h, method=method or ("POST" if data else "GET"))
    with (opener or urllib.request.build_opener()).open(req, timeout=timeout) as r:
        return json.loads(r.read().decode("utf-8") or "null")


def _en(x):
    """A translated field ({"en_EN": ...}), a list of those, or a plain string, as plain text."""
    if isinstance(x, list):
        x = x[0] if x else ""
    if isinstance(x, dict):
        x = x.get("en_EN") or x.get("en") or x.get("name") or next((v for v in x.values() if isinstance(v, str)), "")
    return str(x or "").strip()


def vkey(v):
    """"4.10.2" -> (4, 10, 2) for comparing versions (always three numbers)."""
    n = [int(x) for x in re.findall(r"\d+", str(v or "").split("-")[0])[:3]]
    return tuple((n + [0, 0, 0])[:3])


def find_version(title):
    """The game version in a title ("Star Citizen Alpha 4.10.3 LIVE", "Star Citizen 4.11 PTU.123", "4.10.3-PTU")."""
    m = ALPHA.search(title or "") or VERNUM.search(BUILD.sub(" ", title or ""))
    return (m.group(1), m.group(2) or "") if m else (None, "")


def adjacent(old, new):
    """True when `old` is the patch right before `new` (4.10.2 -> 4.10.3, or 4.9.x -> 4.10.0)."""
    a, b = vkey(old), vkey(new)
    if a[:2] == b[:2]:
        return b[2] - a[2] == 1
    return b[2] == 0 and ((a[0] == b[0] and b[1] - a[1] == 1) or (b[0] - a[0] == 1 and b[1] == 0))


def _ts(v):
    """An ISO date, epoch seconds or epoch ms as epoch seconds, or None."""
    if v is None or v == "":
        return None
    if isinstance(v, (int, float)):
        return v / 1000 if v > 1e11 else float(v)
    s = str(v).strip()
    if s.isdigit():
        return _ts(int(s))
    for fmt in ("%Y-%m-%dT%H:%M:%S%z", "%Y-%m-%dT%H:%M:%S.%f%z", "%Y-%m-%d %H:%M:%S", "%Y-%m-%d"):
        try:
            d = _dt.datetime.strptime(s.replace("Z", "+0000"), fmt)
            if d.tzinfo is None:
                d = d.replace(tzinfo=_dt.timezone.utc)
            return d.timestamp()
        except ValueError:
            continue
    return None


def _paged(url, params, pages=10, size=200):
    """Every row of a wiki list, page by page (JSON:API paging, as ccu.py)."""
    out, seen = [], set()
    for page in range(1, pages + 1):
        q = urllib.parse.urlencode({**params, "page[size]": size, "page[number]": page})
        r = _json(f"{url}?{q}", timeout=60)
        rows = (r or {}).get("data") or []
        key = lambda x: json.dumps(x.get("uuid") or x.get("id") or x.get("name"), default=str)
        fresh = [x for x in rows if key(x) not in seen]
        seen.update(key(x) for x in fresh)
        out += fresh
        last = ((r or {}).get("meta") or {}).get("last_page")
        if not rows or not fresh or (last and page >= int(last)):
            break
    return out


def _words(name):
    return [w for w in re.findall(r"[a-z0-9]+", name.lower()) if w not in ("the", "of", "and", "mk", "edition")]


def mentioned(name, text):
    """Is this ship named in the text? Whole words, "Mk" spacing forgiven."""
    if not name or len(name) < 4:
        return False
    n = r"\s+".join(re.escape(w) for w in name.lower().split())
    n = n.replace(r"mk\s+", r"mk\.?\s*")
    return re.search(r"(?<![a-z0-9])" + n + r"(?![a-z0-9])", text) is not None


# ------------------------------------------------------------------ dates in event posts
_MONTHS = {m: i for i, m in enumerate(["jan", "feb", "mar", "apr", "may", "jun", "jul", "aug", "sep", "oct", "nov", "dec"], 1)}


def _day(mon, day, year, ref, hhmm=None, end=False):
    m = _MONTHS.get(str(mon or "")[:3].lower())
    if not m:
        return None
    y = int(year) if year else _dt.datetime.fromtimestamp(ref, _dt.timezone.utc).year
    if y > 2800:
        y -= 930                                          # an in-game year (2956 is 2026)
    try:
        h, mi = (int(x) for x in hhmm.split(":")) if hhmm else ((23, 59) if end else (0, 0))
        t = _dt.datetime(y, m, int(day), h, mi, tzinfo=_dt.timezone.utc).timestamp()
    except ValueError:
        return None
    if not year and t < ref - 200 * 86400:            # "January 5" read in December means next January
        t = _day(mon, day, y + 1, ref, hhmm, end)
    return t


def date_range(text, ref):
    """(starts, ends) as epoch seconds from the first date range in the text ("November 13 to 27",
    "13–27 November", "from Nov 13 at 16:00 UTC until Nov 27"), or (None, None)."""
    text = re.sub(r"\s+", " ", text or "")
    for rx, kind in ((RANGE3, 3), (RANGE1, 1), (RANGE2, 2)):
        for m in rx.finditer(text):
            g = m.groups()
            if kind == 1:
                s = _day(g[0], g[1], g[2], ref, g[3])
                e = _day(g[4] or g[0], g[5], g[6] or g[2], ref, g[7], end=True)
            elif kind == 2:
                s, e = _day(g[2], g[0], g[3], ref), _day(g[2], g[1], g[3], ref, end=True)
            else:
                s, e = _day(g[0], g[1], None, ref, g[2]), _day(g[3], g[4], None, ref, g[5], end=True)
            if s and e and e < s:
                e = _day(g[4] if kind == 1 else g[3], g[5] if kind == 1 else g[4], None, s + 200 * 86400, end=True)
            if s and e and s <= e <= s + 75 * 86400 and abs(s - ref) < 150 * 86400:
                return s, e
    return None, None


def schedule_items(text, ref):
    """This Week in Star Citizen's "Weekly Community Content Schedule": [(day as epoch seconds, item), ...]."""
    out, day = [], None
    for raw in (text or "").splitlines():
        line = _clean(raw)
        if not line:
            continue
        m = DAYHDR.match(line)
        if m:
            day = _day(m.group(1), m.group(2), m.group(3), ref)
            continue
        if day and len(line) <= 140 and not line.endswith((".", "!", "?")):
            out.append((day, line))
        elif day and len(line) > 140:
            day = None                                    # the schedule is over: prose again
    return out


# ------------------------------------------------------------------ RSI Spectrum (patch notes)
class Spectrum:
    """RSI's Spectrum forum, read as a guest the way its own pages do. Not a public API."""

    def __init__(self, timeout=30):
        self.timeout = timeout
        self.jar = http.cookiejar.CookieJar()
        self.op = urllib.request.build_opener(urllib.request.HTTPCookieProcessor(self.jar))
        self.started = False

    def _post(self, path, body):
        if not self.started:
            self.started = True
            try:
                self._post("/api/account/v2/setAuthToken", {})       # a guest Rsi-Token cookie
            except Exception:
                pass
        h = {"Origin": RSI, "Referer": f"{RSI}/spectrum/community/SC/forum/{PATCH_NOTES_CHANNEL}"}
        tok = next((c.value for c in self.jar if c.name == "Rsi-Token"), None)
        if tok:
            h["X-Rsi-Token"] = urllib.parse.unquote(tok)
        r = _json(RSI + path, body, headers=h, timeout=self.timeout, opener=self.op)
        if isinstance(r, dict) and r.get("success") in (0, False) and path != "/api/account/v2/setAuthToken":
            raise RuntimeError(f"Spectrum {path}: {r.get('msg') or r.get('code') or 'refused'}")
        return r

    def threads(self, channel=PATCH_NOTES_CHANNEL, pages=3):
        out = []
        for page in range(1, pages + 1):
            r = self._post("/api/spectrum/forum/channel/threads",
                           {"channel_id": str(channel), "page": page, "sort": "newest", "label_id": None})
            d = (r or {}).get("data") or {}
            rows = d.get("threads") if isinstance(d, dict) else d
            if not rows:
                break
            out += rows
        if not out:
            raise RuntimeError("Spectrum sent no patch-notes threads")
        return out

    def thread_blocks(self, slug):
        r = self._post("/api/spectrum/forum/thread/nested", {"slug": slug, "sort": "oldest", "target_reply_id": None})
        d = (r or {}).get("data") or {}
        blocks = []
        for cb in d.get("content_blocks") or []:
            blocks += ((cb or {}).get("data") or {}).get("blocks") or []
        if not blocks and isinstance(d.get("content"), str):                  # older or plain-text posts
            blocks = [{"type": "unstyled", "text": t} for t in d["content"].splitlines()]
        return blocks, d


def thread_info(t):
    """A Spectrum thread -> {version, letter, channel, build, title, slug, date, url}."""
    title = str(t.get("subject") or t.get("title") or "")
    ver, letter = find_version(title)
    b = BUILD.search(title)
    build = b.group(2) if b else (BUILDNUM.findall(title) or [None])[-1]
    tag = TAG.match(title)
    tag = tag.group(1).strip() if tag else ""
    closed = bool(re.search(r"(?i)\bclosed\b", tag or title))
    up = title.upper()
    channel = ("EPTU" if "EPTU" in up else "PTU" if re.search(r"\bPTU\b", up) else "LIVE" if "LIVE" in up else
               "EVOCATI" if "EVOCATI" in up else "TECH-PREVIEW" if "PREVIEW" in up else
               "HOTFIX" if "HOTFIX" in up else "")
    slug = t.get("slug") or ""
    return {"version": ver, "letter": letter, "channel": channel, "build": build, "tag": tag, "closed": closed,
            "title": re.sub(r"^\s*\[[^\]]*\]\s*", "", title), "slug": slug, "date": _ts(t.get("time_created") or t.get("time_modified")),
            "url": f"{RSI}/spectrum/community/SC/forum/{PATCH_NOTES_CHANNEL}/thread/{slug}" if slug else None}


# ------------------------------------------------------------------ patch notes -> sections
def _clean(s):
    return re.sub(r"\s+", " ", str(s or "")).strip(" \t-•*·►▸▶➤→")


def _is_title(t):
    """The notes' own title line ("Star Citizen Alpha Patch 4.10.3 LIVE"), not a section."""
    return bool(VERNUM.search(t)) and re.search(r"(?i)star citizen|alpha|patch|ptu|live|release", t) is not None


def _is_header(text, nxt_is_item):
    t = _clean(text)
    if not t or len(t) > 70 or t.endswith((".", ",", ";", "!", "?")) or ":" in t[:-1]:
        return False
    return t.lower().rstrip(":") in HEADERS or (nxt_is_item and len(t.split()) <= 6)


def parse_blocks(blocks):
    """Spectrum (Draft.js) blocks -> {"info": {key: value}, "sections": [{"name", "items"}]}."""
    lines = []
    for b in blocks:
        txt, typ = str(b.get("text") or ""), str(b.get("type") or "unstyled")
        if txt.strip():
            lines.append((typ, txt, int(b.get("depth") or 0)))
    return _sections(lines)


def parse_text(text):
    """Plain-text notes (the Comm-Link copy) -> the same shape as parse_blocks."""
    lines = []
    for raw in str(text or "").splitlines():
        if not raw.strip():
            continue
        bullet = re.match(r"^(\s*)([-•*·]|\d+\.)\s+", raw)
        depth = len(bullet.group(1)) // 2 if bullet else 0
        lines.append(("unordered-list-item" if bullet else "unstyled", raw, depth))
    return _sections(lines)


def _sections(lines):
    info, sections, cur = {}, [], None
    for i, (typ, txt, depth) in enumerate(lines):
        t = _clean(txt)
        if not t:
            continue
        kv = re.match(r"^([A-Za-z][A-Za-z \-/]{2,30}):\s*(.+)$", t)
        if kv and kv.group(1).strip().lower() in INFO_KEYS and not any(s["items"] for s in sections):
            info[kv.group(1).strip()] = kv.group(2).strip()
            continue
        if PREAMBLE.match(t) or (_is_title(t) and len(t) < 90 and not any(s["items"] for s in sections)):
            cur = None                                    # the title and the "released / build info" lines on top
            continue
        nxt = lines[i + 1][0] if i + 1 < len(lines) else ""
        is_item = typ.endswith("list-item")
        if typ.startswith("header") or (not is_item and _is_header(t, nxt.endswith("list-item"))):
            cur = {"name": t.rstrip(":"), "items": []}
            sections.append(cur)
            continue
        if cur is None:
            continue
        if depth > 0 and cur["items"]:
            cur["items"][-1] += " · " + t                 # a sub-point belongs to the point above
        else:
            cur["items"].append(t)
    sections = [s for s in sections if s["items"]]       # a heading straight over another isn't a section of its own
    return {"info": info, "sections": sections}


def highlights(sections, n=8):
    """The points worth a glance: the feature sections first, fixes and known issues last."""
    loud = [s for s in sections if s["name"].lower() not in QUIET]
    out, i = [], 0
    while len(out) < n and any(i < len(s["items"]) for s in loud):
        for s in loud:
            if i < len(s["items"]) and len(out) < n:
                out.append({"cat": s["name"], "text": s["items"][i][:260]})
        i += 1
    for s in sections:
        if len(out) >= n:
            break
        if s not in loud and s["items"]:
            out.append({"cat": s["name"], "text": s["items"][0][:260]})
    return out


def notes_out(meta, parsed, active=True):
    secs = parsed["sections"]
    return {**meta, "active": active, "info": parsed["info"],
            "cats": [{"name": s["name"], "n": len(s["items"])} for s in secs],
            "sections": [{"name": s["name"], "items": s["items"][:300]} for s in secs],
            "highlights": highlights(secs)}


def notes_text(n):
    return " ".join(" ".join(s["items"]) + " " + s["name"] for s in (n or {}).get("sections") or []).lower()


# ------------------------------------------------------------------ the Star Citizen Wiki
def comm_links(n=100):
    """The newest Comm-Links, newest first: {id, title, url, channel, category, series, date}."""
    r = None
    for params in ({"page[size]": n, "sort": "-id"}, {"page[size]": n}):
        try:
            r = _json(f"{WIKI}/comm-links?" + urllib.parse.urlencode(params))
            break
        except urllib.error.HTTPError as e:
            if e.code not in (400, 422):
                raise
    rows = (r or {}).get("data") or []
    ids = [x.get("id") or 0 for x in rows]
    last = ((r or {}).get("meta") or {}).get("last_page")
    if rows and ids == sorted(ids) and max(ids) < 19000 and last and int(last) > 1:   # oldest first: read the end
        q = lambda p: _json(f"{WIKI}/comm-links?" + urllib.parse.urlencode({"page[size]": n, "page[number]": p}))
        rows = (q(int(last)).get("data") or []) + (q(int(last) - 1).get("data") or [])
    out = []
    for x in rows:
        out.append({"id": x.get("id"), "title": _en(x.get("title")), "url": x.get("rsi_url"),
                    "channel": _en(x.get("channel")), "category": _en(x.get("category")), "series": _en(x.get("series")),
                    "date": _ts(x.get("created_at") or x.get("published_at") or x.get("publication_date")
                                or x.get("date") or x.get("created"))})
    out.sort(key=lambda c: c["id"] or 0, reverse=True)
    if not out:
        raise RuntimeError("the wiki sent no Comm-Links")
    return out


def comm_link_text(cid):
    r = _json(f"{WIKI}/comm-links/{cid}", timeout=40)
    d = (r or {}).get("data") or {}
    return _en(d.get("translations")) or _en(d.get("content")) or ""


def game_versions():
    """{"live": [codes newest first], "ptu": [...], "all": [...], "default": code}. Codes look like
    "4.10.3-LIVE.12650677"."""
    default = None
    try:
        d = (_json(f"{WIKI}/game-versions/default") or {}).get("data") or {}
        default = (d.get("code") or d.get("name") or d.get("version")) if isinstance(d, dict) else str(d)
    except Exception:
        pass
    codes = []
    try:
        r = _json(f"{WIKI}/game-versions?page%5Bsize%5D=100")
        for x in (r or {}).get("data") or []:
            c = (x.get("code") or x.get("name") or x.get("version")) if isinstance(x, dict) else x
            if c:
                codes.append(str(c))
    except Exception:
        pass
    if default and default not in codes:
        codes.append(str(default))
    order = lambda c: (vkey(c), int((re.findall(r"(\d{6,9})", c) or ["0"])[-1]))
    codes = sorted(set(codes), key=order, reverse=True)
    live = [c for c in codes if "LIVE" in c.upper()]
    ptu = [c for c in codes if re.search(r"PTU|EPTU|TECH|PREVIEW", c.upper())]
    return {"live": live or [c for c in codes if c not in ptu], "ptu": ptu, "all": codes, "default": default}


def _f(*xs):
    """The first of these that's a number (a dict's "value"/"total" too), or None."""
    for x in xs:
        if isinstance(x, dict):
            x = x.get("value", x.get("total", x.get("max")))
        try:
            if x is not None and x != "" and float(x) != 0:
                return float(x)
        except (TypeError, ValueError):
            continue
    return None


def ship_specs(d):
    """What a ship page shows, from a wiki vehicle or Ship Matrix record (their field names differ)."""
    dim = d.get("sizes") or d.get("dimension") or d.get("dimensions") or {}
    crew = d.get("crew") if isinstance(d.get("crew"), dict) else {}
    lo = _f(crew.get("min"), d.get("min_crew"), d.get("crew") if not isinstance(d.get("crew"), dict) else None)
    hi = _f(crew.get("max"), d.get("max_crew"))
    out = {"desc": _clean(_en(d.get("description")))[:1200] or None,
           "length": _f(dim.get("length"), d.get("length")), "beam": _f(dim.get("beam"), dim.get("width"), d.get("beam")),
           "height": _f(dim.get("height"), d.get("height")), "mass": _f(d.get("mass"), d.get("mass_total")),
           "cargo": _f(d.get("cargo_capacity"), d.get("cargocapacity"), d.get("cargo")),
           "crew": (f"{int(lo)}–{int(hi)}" if lo and hi and hi > lo else str(int(lo or hi))) if (lo or hi) else None,
           "msrp": _f(d.get("msrp"), (d.get("pledge") or {}).get("msrp") if isinstance(d.get("pledge"), dict) else None),
           "store": d.get("pledge_url") or None}
    return {k: v for k, v in out.items() if v not in (None, "")}


def _vehicle(d):
    m = d.get("manufacturer")
    name = _en(d.get("name"))
    return {**ship_specs(d), "key": str(d.get("uuid") or d.get("class_name") or name).lower(), "name": name,
            "maker": _en(m.get("name") if isinstance(m, dict) else m),
            "role": _en(d.get("role")) or _en(d.get("career")) or _en(d.get("focus")),
            "size": _en(d.get("size")) or _en(d.get("size_class")),
            "vehicle": not bool(d.get("is_spaceship", True)) or "ground" in _en(d.get("type")).lower(),
            "url": d.get("web_url") or None}


MAKERS = {"aegis": "Aegis Dynamics", "anvil": "Anvil Aerospace", "aopoa": "Aopoa", "argo": "Argo Astronautics",
          "banu": "Banu", "consolidated": "Consolidated Outland", "crusader": "Crusader Industries", "drake": "Drake Interplanetary",
          "esperia": "Esperia", "gatac": "Gatac", "greycat": "Greycat Industrial", "kruger": "Kruger Intergalactic",
          "misc": "MISC", "mirai": "Mirai", "origin": "Origin Jumpworks", "rsi": "Roberts Space Industries",
          "tumbril": "Tumbril", "mole": "Argo Astronautics"}


def vehicles(version=None):
    """{game id: ship} for one game version (the wiki's default when None)."""
    rows = _paged(f"{WIKI}/vehicles", {"version": version} if version else {}, pages=8)
    out = {}
    for d in rows:
        v = _vehicle(d)
        if v["name"] and not JUNK.search(v["name"]):
            out[v["key"]] = v
    if not out:
        raise RuntimeError(f"the wiki sent no vehicles{f' for {version}' if version else ''}")
    return out


def ship_matrix():
    """{"concept": [...], "production": [...], "flight": [...]}: the official Ship Matrix, newest first."""
    rows = _paged(f"{WIKI}/shipmatrix/vehicles", {}, pages=10)
    out = {"concept": [], "production": [], "flight": []}
    for d in sorted(rows, key=lambda x: x.get("id") or 0, reverse=True):
        st = _en(d.get("production_status")).lower()
        m = d.get("manufacturer")
        rec = {**ship_specs(d), "name": _en(d.get("name")), "maker": _en(m.get("name") if isinstance(m, dict) else m),
               "role": _en(d.get("focus")) or _en(d.get("type")), "url": d.get("pledge_url"), "status": st}
        if not rec["name"]:
            continue
        b = "concept" if "concept" in st else "production" if "production" in st else "flight" if ("flight" in st or "ready" in st) else None
        if b:
            out[b].append(rec)
    if not any(out.values()):
        raise RuntimeError("the Ship Matrix sent no ships")
    return out


# ------------------------------------------------------------------ events: the wiki's event pages, RSI's news
SCT = "https://starcitizen.tools"
EVENT_CATS = ["Category:Narrative events", "Category:Events", "Category:In-game events", "Category:Free fly events",
              "Category:Intergalactic Aerospace Expo", "Category:Invictus Launch Week", "Category:Community events",
              "Category:Dynamic events", "Category:Seasonal events"]
ALIASES = [(re.compile(r"(?i)intergalactic aerospace expo"), "iae"), (re.compile(r"(?i)invictus launch week"), "ilw")]
STOP = {"star", "citizen", "free", "fly", "event", "the", "and", "try", "for", "of", "to", "schedule", "manufacturer",
        "countdown", "returns", "ultimate", "ship", "show", "about", "faq", "2954", "2955", "2956", "2957", "2958"}


def ev_words(name):
    n = name
    for rx, a in ALIASES:
        n = rx.sub(a, n)
    return {w for w in re.findall(r"[a-z0-9]+", n.lower()) if w not in STOP and len(w) > 1}


def _text(url, timeout=30):
    req = urllib.request.Request(url, headers={**UA, "Accept": "text/html,application/xhtml+xml"})
    with urllib.request.urlopen(req, timeout=timeout) as r:
        return r.read().decode("utf-8", "replace")


def _strip(html):
    html = re.sub(r"(?is)<(script|style|noscript)\b.*?</\1>", " ", html or "")
    html = re.sub(r"(?i)<br\s*/?>|</(p|div|h\d|li|tr|section|article)>", "\n", html)
    t = re.sub(r"<[^>]+>", " ", html)
    import html as _h
    t = _h.unescape(t)
    return "\n".join(re.sub(r"[ \t\xa0]+", " ", l).strip() for l in t.splitlines() if l.strip())


def _meta(html, prop):
    m = re.search(r'<meta[^>]+(?:property|name)=["\']%s["\'][^>]*>' % re.escape(prop), html or "", re.I)
    v = m and re.search(r'content=["\']([^"\']*)["\']', m.group(0))
    import html as _h
    return _h.unescape(v.group(1)) if v else None


def game_date(v):
    """An in-game date ("2956-10-09": the game runs 930 years ahead) or a real one, as epoch seconds. Also a date
    written through a template: {{Date|2956|11|13}}, {{start date|2956|11|13}}."""
    raw = str(v or "")
    m = re.search(r"\{\{[^{}|]*\|\s*(\d{4})\s*\|\s*(\d{1,2})\s*\|\s*(\d{1,2})", raw)
    if m:
        raw = f"{m.group(1)}-{m.group(2)}-{m.group(3)}"
    s = _clean(re.sub(r"<[^>]+>|\[\[|\]\]", " ", raw))
    s = re.sub(r"\{\{[^{}]*\|([^{}|]*)\}\}", r"\1", s)          # a template's last argument ({{x|November 13, 2956}})
    s = re.sub(r"\{\{[^{}]*\}\}", " ", s)
    m = re.search(r"(\d{4})-(\d{1,2})-(\d{1,2})", s)
    if m:
        y = int(m.group(1))
        y = y - 930 if y > 2800 else y
        try:
            return _dt.datetime(y, int(m.group(2)), int(m.group(3)), tzinfo=_dt.timezone.utc).timestamp()
        except ValueError:
            return None
    m = re.search(MON + r"\.?\s+(\d{1,2})(?:st|nd|rd|th)?,?\s+(\d{4})", s, re.I)
    if m:
        y = int(m.group(3))
        return _day(m.group(1), m.group(2), y - 930 if y > 2800 else y, time.time())
    m = re.search(r"(\d{1,2})\s+" + MON + r"\.?,?\s+(\d{4})", s, re.I)
    if m:
        y = int(m.group(3))
        return _day(m.group(2), m.group(1), y - 930 if y > 2800 else y, time.time())
    return None


def infobox(text):
    """The first template's |key = value pairs from a wiki page's source."""
    out = {}
    for m in re.finditer(r"^\s*\|\s*([A-Za-z][\w ]{0,30}?)\s*=\s*(.*?)\s*$", text or "", re.M):
        k = m.group(1).strip().lower().replace(" ", "_")
        out.setdefault(k, m.group(2).strip())
    return out


RECURRING = ["Intergalactic Aerospace Expo", "Invictus Launch Week", "Luminalia", "Red Festival", "Coramor",
             "Stella Fortuna", "Day of the Vara", "Foundation Festival", "Alien Week", "Xenothreat"]


def recurring_titles(now=None):
    """This year's and next year's pages of the yearly events ("Intergalactic Aerospace Expo 2956"): the wiki
    often makes them before it files them in a category."""
    y = _dt.datetime.fromtimestamp(now or time.time(), _dt.timezone.utc).year + 930
    return [f"{e} {yy}" for yy in (y, y + 1) for e in RECURRING]


def _wt_plain(t):
    """Wikitext to plain text: links' words, templates' last argument (often the name), no refs or markup."""
    t = re.sub(r"(?is)<ref[^>]*/>|<ref[^>]*>.*?</ref>|<!--.*?-->", "", t or "")
    t = re.sub(r"(?i)<br\s*/?>", ", ", t)
    t = re.sub(r"\[\[(?:File|Image):[^\]]*\]\]", "", t, flags=re.I)
    for _ in range(3):
        t = re.sub(r"\{\{([^{}]*)\}\}", lambda m: m.group(1).split("|")[-1] if "|" in m.group(1) else "", t)
    t = re.sub(r"\[\[(?:[^|\]]*\|)?([^\]]*)\]\]", r"\1", t)
    t = re.sub(r"\[https?://\S+\s([^\]]*)\]", r"\1", t)
    t = re.sub(r"<[^>]+>|'{2,}", "", t)
    return re.sub(r"\s*,\s*(,\s*)+", ", ", re.sub(r"[ \t]+", " ", t)).strip(" ,")


def wiki_tables(text):
    """Every wikitable in a page's source: [{"section", "head": [...], "rows": [[cell, ...], ...]}]."""
    out, section = [], ""
    for m in re.finditer(r"(?ms)^(={2,4})\s*(.+?)\s*\1\s*$|^\{\|(.*?)^\|\}", text or ""):
        if m.group(2):
            section = _wt_plain(m.group(2))
            continue
        body, head, rows, cur = m.group(3), [], [], None
        for line in body.splitlines()[1:]:
            l = line.strip()
            if l.startswith("|-"):
                cur = None
                continue
            if l.startswith("|+"):
                continue
            if l.startswith("!"):
                for c in re.split(r"!!|\|\|", l[1:]):
                    head.append(_wt_plain(c.split("|")[-1] if "|" in c and "[[" not in c.split("|")[0] else c))
                continue
            if l.startswith("|"):
                if cur is None:
                    cur = []
                    rows.append(cur)
                for c in l[1:].split("||"):
                    # "rowspan=2 | text": the attributes before a single bar go
                    if re.match(r"^\s*[a-z\-]+\s*=", c) and "|" in c and "[[" not in c.split("|")[0]:
                        c = c.split("|", 1)[1]
                    cur.append(_wt_plain(c))
            elif cur:
                cur[-1] = (cur[-1] + ", " + _wt_plain(l)).strip(" ,")      # a cell going on over more lines
        out.append({"section": section, "head": head, "rows": [r for r in rows if any(r)]})
    return out


def _span(text, year, end_of_event=None):
    """"Nov 13–14", "November 22", "Nov 23–27" in an event's year -> (start, end): from 16:00 UTC on the first
    day (when RSI's event days turn over) to 16:00 UTC the day after the last."""
    m = re.search(MON + r"\.?\s*(\d{1,2})(?:\s*[-–]\s*(?:" + MON + r"\.?\s*)?(\d{1,2}))?", text or "", re.I)
    if not m:
        return None, None
    s = _day(m.group(1), m.group(2), year, time.time(), "16:00")
    e = _day(m.group(3) or m.group(1), m.group(4) or m.group(2), year, time.time(), "16:00")
    e = e + 86400 if e else None
    if end_of_event and e and e > end_of_event:
        e = end_of_event
    return s, e


# Twitch drops: what each campaign gives and after how many hours of watching. RSI's Twitch Drops post and the
# wiki are read for these too; the ones listed here are already known (RSI's post doesn't always give the hours).
# Times are Twitch's own campaign window, UTC.
TWITCH_DROPS = [
    {"campaign": "IAE 2956", "starts": "2026-11-13T15:30:00Z", "ends": "2026-11-27T19:59:00Z",
     "rewards": [{"name": "Venture Undersuit Black", "hours": 2}, {"name": "Venture Armor Black", "hours": 4},
                 {"name": "MacFlex Backpack Orange", "hours": 6}]},
]
TWITCH_LINKS = {"inventory": "https://www.twitch.tv/drops/inventory",
                "streams": "https://www.twitch.tv/directory/category/star-citizen?filter=drops"}
TWITCH_RE = re.compile(r"(?i)twitch\s*drops?")


def _hours(x):
    try:
        return float(str(x).strip().split()[0])
    except (ValueError, IndexError):
        return None


def clean_rewards(rows):
    """[{"name", "hours", "image"?}], one per item, in the order they unlock."""
    out, seen = [], set()
    for r in rows or []:
        if not isinstance(r, dict) or not r.get("name"):
            continue
        name = re.sub(r"\s+", " ", str(r["name"])).strip(" .:-–—\"'")
        if not name or name.lower() in seen:
            continue
        seen.add(name.lower())
        h = _hours(r.get("hours"))
        out.append({"name": name, "hours": int(h) if h is not None and h == int(h) else h,
                    **({"image": r["image"]} if r.get("image") else {})})
    return sorted(out, key=lambda r: r["hours"] if r["hours"] is not None else 1e9)


def drop_rewards(text):
    """A Twitch Drops post's rewards, from lines like "Watch for 2 hours and claim the reward Venture Undersuit
    Black", "2 hours: Venture Undersuit Black" or "Venture Undersuit Black - 2 hours"."""
    H = r"(\d+(?:\.\d+)?)\s*(?:hours?|hrs?)\b"
    rows = []
    for m in re.finditer(r"(?i)watch(?:\s+for)?\s+" + H + r"[^\n]{0,40}?\b(?:claim|earn|receive|unlock|get)\s+(?:the\s+)?(?:reward\s+)?([^\n.,;]{3,60})", text or ""):
        rows.append({"hours": m.group(1), "name": m.group(2)})
    if not rows:
        for m in re.finditer(r"(?im)^\s*" + H + r"\s*(?:of watching\s*)?[:\-–—]\s*([^\n]{3,60})$", text or ""):
            rows.append({"hours": m.group(1), "name": m.group(2)})
        for m in re.finditer(r"(?im)^\s*([A-Z][^\n:]{2,60}?)\s*[:\-–—(]\s*" + H, text or ""):
            rows.append({"hours": m.group(2), "name": m.group(1)})
    return clean_rewards(rows)


def table_rewards(tables):
    """Rewards from a wiki table with a reward (or item) column and an hours (or watch time) column."""
    col = lambda head, *names: next((i for i, h in enumerate(head) if any(n in h.lower() for n in names)), None)
    for t in tables or []:
        h = t["head"]
        ir, ih = col(h, "reward", "item"), col(h, "hour", "watch", "time")
        if ir is None or ih is None:
            continue
        rows = [{"name": r[ir], "hours": r[ih]} for r in t["rows"] if max(ir, ih) < len(r)]
        if rows:
            return clean_rewards(rows)
    return []


def wiki_page_html(title):
    """A wiki page as the browser shows it (templates already turned into dates and tables): (html, image files)."""
    r = _json(f"{SCT}/api.php?" + urllib.parse.urlencode({"action": "parse", "page": title, "prop": "text|images",
              "redirects": 1, "format": "json", "formatversion": "2"}), timeout=30)
    p = (r or {}).get("parse") or {}
    return p.get("text") or "", p.get("images") or []


def html_tables(html):
    """Every table in rendered HTML, with the heading it's under: [{"section", "head", "rows"}] (rowspans
    carried down, so a manufacturer spanning two rows is in both)."""
    out, section = [], ""
    for m in re.finditer(r"(?is)<h([2-4])[^>]*>(.*?)</h\1>|<table[^>]*>(.*?)</table>", html or ""):
        if m.group(2) is not None:
            section = _strip(re.sub(r"(?is)<span class=\"mw-editsection.*?</span>\s*</span>|\[edit\]", "", m.group(2))).replace("\n", " ")
            continue
        head, rows, carry = [], [], {}
        for tr in re.findall(r"(?is)<tr[^>]*>(.*?)</tr>", m.group(3)):
            cells = re.findall(r"(?is)<t([hd])([^>]*)>(.*?)</t[hd]>", tr)
            if cells and all(c[0].lower() == "h" for c in cells) and not head:
                head = [_strip(c[2]).replace("\n", " ") for c in cells]
                continue
            row, i, ci = [], 0, 0
            while ci < len(cells) or i in carry:
                if i in carry:
                    txt, left = carry[i]
                    row.append(txt)
                    carry[i] = (txt, left - 1)
                    if carry[i][1] <= 0:
                        del carry[i]
                else:
                    kind, attrs, body = cells[ci]
                    ci += 1
                    txt = ", ".join(l for l in _strip(body).split("\n") if l)
                    rs = re.search(r'rowspan="?(\d+)', attrs)
                    if rs and int(rs.group(1)) > 1:
                        carry[i] = (txt, int(rs.group(1)) - 1)
                    row.append(txt)
                i += 1
            if any(row):
                rows.append(row)
        out.append({"section": section, "head": head, "rows": rows})
    return out


def html_facts(html):
    """The infobox's "label value" pairs from rendered HTML: {"date start": "November 13, 2956", ...}."""
    lines = [l.strip() for l in _strip(html).split("\n") if l.strip()]
    out = {}
    keys = ("date start", "start date", "date end", "end date", "status", "location", "planet", "system", "activities", "start", "end")
    for i, l in enumerate(lines[:400]):
        k = l.lower().rstrip(":")
        if k in keys and i + 1 < len(lines) and k not in out:          # label and value on lines of their own
            out[k] = lines[i + 1]
            continue
        m = re.match(r"(?i)^(" + "|".join(keys) + r")\s*:?\s+(.+)$", l)     # "Date start November 13, 2956"
        if m and m.group(1).lower() not in out:
            out[m.group(1).lower()] = m.group(2).strip()
    return out


def event_schedule(text, year, ends=None, tables=None):
    """An event page's schedule tables (IAE: free rentals by manufacturer, stock-limited sales, concept
    reveals), by their column names, so a reworded table still reads. tables: from html_tables (the rendered
    page) instead of the page's source."""
    out = {}
    col = lambda head, *names: next((i for i, h in enumerate(head) if any(n in h.lower() for n in names)), None)
    for t in (tables if tables is not None else wiki_tables(text)):
        h, sec = t["head"], t["section"].lower()
        iday, idate = col(h, "day"), col(h, "date")
        get = lambda r, i: r[i] if i is not None and i < len(r) else ""
        if col(h, "manufacturer") is not None or "rent" in sec:
            im, iv = col(h, "manufacturer"), col(h, "vehicle", "ship")
            for r in t["rows"]:
                s_, e_ = _span(get(r, idate) or " ".join(r), year, ends)
                out.setdefault("rentals", []).append({"day": get(r, iday), "date": get(r, idate), "makers": get(r, im),
                                                      "vehicles": get(r, iv)[:400], "starts": s_, "ends": e_})
        elif "limited" in sec or col(h, "wave") is not None:
            iv = col(h, "ship", "vehicle", "name")
            for r in t["rows"]:
                s_, _ = _span(get(r, idate) or " ".join(r), year)
                out.setdefault("limited", []).append({"day": get(r, iday), "date": get(r, idate), "ships": get(r, iv),
                                                      "starts": s_})
        elif "concept" in sec or ("name" in " ".join(h).lower() and "description" in " ".join(h).lower()):
            iname, idesc = col(h, "name"), col(h, "description")
            for r in t["rows"]:
                out.setdefault("concepts", []).append({"day": get(r, iday), "name": get(r, iname), "desc": get(r, idesc)[:240]})
    return out


def wiki_events(log=None, extra=()):
    """Events from the Star Citizen Wiki's event pages: [{name, status, starts, ends, where, image, url, kind}].
    extra: page titles to read as well (an event RSI just announced, before the wiki files it in a category).
    The events that matter (this year's yearly ones, anything active, upcoming or dated) are then read again as
    rendered pages, which is where dates and schedules written through templates come out right."""
    out = _wiki_events(log, extra)
    want = set(extra) | set(recurring_titles())
    now = time.time()
    pick = [e for e in out if e["name"] in want or re.search(r"active|ongoing|upcoming|announced", e["status"] or "")
            or (e["starts"] and now - 60 * 86400 < e["starts"] < now + 90 * 86400)][:10]
    from concurrent.futures import ThreadPoolExecutor

    def rendered(e):
        try:
            html, files = wiki_page_html(e["name"])
        except Exception as ex:
            if log:
                log("wiki page:", e["name"], ex)
            return
        f = html_facts(html)
        ty = re.search(r"\b(29[4-9]\d)\b", e["name"])
        year = int(ty.group(1)) - 930 if ty else _dt.datetime.now(_dt.timezone.utc).year
        if not e["starts"]:
            e["starts"] = game_date(f.get("date start") or f.get("start date") or f.get("start"))
            e["ends"] = e["ends"] or game_date(f.get("date end") or f.get("end date") or f.get("end"))
        if not e["status"] and f.get("status"):
            e["status"] = f["status"].lower()
        if not e["where"]:
            e["where"] = ", ".join(x for x in (f.get("location"), f.get("planet"), f.get("system")) if x) or None
        if not e.get("free_fly") and re.search(r"(?i)free[\s-]*fly", f.get("activities") or html[:20000]):
            e["free_fly"] = True
        tables = html_tables(html)
        sch = event_schedule("", year, e["ends"] + 20 * 3600 if e["ends"] and e["ends"] % 86400 == 0 else e["ends"],
                             tables=tables)
        if TWITCH_RE.search(e["name"]) and not e.get("rewards"):
            e["rewards"] = table_rewards(tables) or None
        if sch and (not e.get("schedule") or sum(map(len, sch.values())) > sum(map(len, (e["schedule"] or {}).values()))):
            e["schedule"] = sch
        if not e.get("schedule_image"):
            fn = next((x for x in files if "schedule" in x.lower()), None)
            if fn:
                e["_sched_file"] = "File:" + fn
        if not e["starts"] and (e.get("schedule") or {}).get("rentals"):     # the schedule's own first and last day
            R = [r for r in e["schedule"]["rentals"] if r.get("starts")]
            if R:
                e["starts"], e["ends"] = R[0]["starts"], max(r["ends"] or r["starts"] for r in R)
    with ThreadPoolExecutor(max_workers=5) as ex:
        list(ex.map(rendered, pick))
    files = {e["_sched_file"]: e for e in out if e.get("_sched_file")}
    if files:
        try:
            r = _json(f"{SCT}/api.php?" + urllib.parse.urlencode({"action": "query", "prop": "imageinfo", "iiprop": "url",
                      "iiurlwidth": 1600, "titles": "|".join(files), "format": "json", "formatversion": "2"}), timeout=20)
            for f in ((r or {}).get("query") or {}).get("pages") or []:
                ii = (f.get("imageinfo") or [{}])[0]
                e = next((e for k, e in files.items() if k.replace("_", " ").lower() == f.get("title", "").replace("_", " ").lower()), None)
                if e and ii.get("url"):
                    e["schedule_image"] = {"thumb": ii.get("thumburl") or ii["url"], "full": ii["url"], "page": ii.get("descriptionurl")}
        except Exception as ex:
            if log:
                log("schedule image:", ex)
    for e in out:
        e.pop("_sched_file", None)
    return out


def _wiki_events(log=None, extra=()):
    """The event pages' sources, read in batches (see wiki_events)."""
    titles = [t for t in list(extra) + recurring_titles() if t]
    titles = list(dict.fromkeys(titles))
    for cat in EVENT_CATS:
        try:
            r = _json(f"{SCT}/api.php?" + urllib.parse.urlencode({"action": "query", "list": "categorymembers",
                      "cmtitle": cat, "cmlimit": 25, "cmsort": "timestamp", "cmdir": "desc", "cmtype": "page", "cmnamespace": 0,
                      "format": "json"}), timeout=20)
        except Exception as e:
            if log:
                log("wiki events:", cat, e)
            continue
        for m in ((r or {}).get("query") or {}).get("categorymembers") or []:
            # articles only: a user's draft ("User:…/sandbox/…") or a template isn't an event
            if m.get("title") and ":" not in m["title"] and m["title"] not in titles:
                titles.append(m["title"])
    out = []
    for i in range(0, min(len(titles), 80), 20):
        chunk = titles[i:i + 20]
        r = _json(f"{SCT}/api.php?" + urllib.parse.urlencode({"action": "query", "prop": "revisions|pageimages|info",
                  "rvprop": "content", "rvslots": "main", "piprop": "original|thumbnail", "pithumbsize": 1280,
                  "inprop": "url", "titles": "|".join(chunk), "format": "json", "formatversion": "2"}), timeout=30)
        sched_files = {}
        for p in ((r or {}).get("query") or {}).get("pages") or []:
            if p.get("missing") or p.get("ns", 0) != 0 or ":" in (p.get("title") or ""):
                continue
            # a page for a past year ("… 2953") is history, whatever dates its text has
            ty = re.search(r"\b(29[4-9]\d)\b", p.get("title") or "")
            now_y = _dt.datetime.now(_dt.timezone.utc).year
            if ty and int(ty.group(1)) - 930 < now_y:
                continue
            ev_year = int(ty.group(1)) - 930 if ty else now_y
            rev = (p.get("revisions") or [{}])[0]
            text = ((rev.get("slots") or {}).get("main") or {}).get("content") or rev.get("content") or ""
            box = infobox(text)
            pick = lambda *ks: next((box[k] for k in ks if box.get(k)), None)
            status = _clean(re.sub(r"<[^>]+>|\[\[|\]\]", "", pick("status", "state") or "")).lower()
            img = (p.get("thumbnail") or {}).get("source") or (p.get("original") or {}).get("source")
            where = ", ".join(dict.fromkeys(x for x in (_wt_plain(pick("location", "locations", "venue") or ""), _wt_plain(pick("planet") or ""),
                                                           _wt_plain(pick("system", "systems") or "")) if x))
            st_, en_ = game_date(pick("start_date", "start", "startdate", "date_start", "begins")), game_date(pick("end_date", "end", "enddate", "date_end", "ends"))
            if not st_:                                   # no dates in the infobox: the article's own words
                body = re.sub(r"\{\{[^{}]*\}\}|\[\[(?:[^|\]]*\|)?([^\]]*)\]\]|<[^>]+>|'{2,}", lambda m: m.group(1) or " ", text)
                st_, en_ = date_range(body[:6000], _dt.datetime(ev_year, 7, 1, tzinfo=_dt.timezone.utc).timestamp())
            try:
                sched = event_schedule(text, ev_year, en_ + 20 * 3600 if en_ and en_ % 86400 == 0 else en_)
            except Exception:
                sched = {}
            fm = re.search(r"([\w\-. ]*schedule[\w\-. ]*\.(?:jpe?g|png|webp))", text, re.I)    # the official schedule picture
            if fm:
                sched_files[p.get("title")] = "File:" + fm.group(1).strip()
            out.append({"name": p.get("title"), "status": status, "starts": st_,
                        "ends": en_, "where": where[:80] or None,
                        "kind": _clean(pick("type", "event_type", "subtype") or "")[:40] or None,
                        "image": img, "url": p.get("fullurl") or f"{SCT}/{urllib.parse.quote(p.get('title', '').replace(' ', '_'))}",
                        "wiki": True, "schedule": sched or None,
                        "free_fly": bool(re.search(r"(?i)free[\s-]*fly", (pick("activities") or "") + text[:3000]))})
        if sched_files:                                   # the schedule pictures' addresses
            try:
                r2 = _json(f"{SCT}/api.php?" + urllib.parse.urlencode({"action": "query", "prop": "imageinfo", "iiprop": "url",
                           "iiurlwidth": 1600, "titles": "|".join(set(sched_files.values())), "format": "json", "formatversion": "2"}), timeout=20)
                urls = {}
                for f in ((r2 or {}).get("query") or {}).get("pages") or []:
                    ii = (f.get("imageinfo") or [{}])[0]
                    urls[f.get("title", "").replace("_", " ").lower()] = {"thumb": ii.get("thumburl") or ii.get("url"), "full": ii.get("url"),
                                                                           "page": ii.get("descriptionurl")}
                for e in out:
                    fn = sched_files.get(e["name"])
                    u = fn and urls.get(fn.replace("_", " ").lower())
                    if u:
                        e["schedule_image"] = u
            except Exception as ex:
                if log:
                    log("schedule image:", ex)
    return out


def rsi_news(pages=2):
    """RSI's own Comm-Link list (the wiki's copy can be weeks behind): [{id, title, url, date}] newest first."""
    out, seen = [], set()
    for page in range(1, pages + 1):
        html = _text(f"{RSI}/en/comm-link" + (f"?page={page}" if page > 1 else ""))
        hits = list(re.finditer(r'href=["\'](?:https?://robertsspaceindustries\.com)?(/(?:en/)?comm-link/[A-Za-z\-]+/(\d+)-([^"\'?#<>]+))["\']', html))
        for i, m in enumerate(hits):
            cid = int(m.group(2))
            if cid in seen:
                continue
            seen.add(cid)
            seg = _strip(re.sub(r"^[^<]*?>", "", html[m.end(): hits[i + 1].start() if i + 1 < len(hits) else m.end() + 3000], count=1))
            lines = [l for l in seg.splitlines() if l and not re.fullmatch(r"(?i)post|video|\d+", l)]
            title = next((l for l in lines if len(l) > 6 and not re.search(r"(?i)\bago$|^posted", l)), None) or m.group(3).replace("-", " ")
            ago = re.search(r"(\d+|an?|one)\s+(minute|hour|day|week|month|year)s?\s+ago", seg, re.I)
            date = None
            if ago:
                n = 1 if not ago.group(1).isdigit() else int(ago.group(1))
                date = time.time() - n * {"minute": 60, "hour": 3600, "day": 86400, "week": 7 * 86400,
                                          "month": 30 * 86400, "year": 365 * 86400}[ago.group(2).lower()]
            out.append({"id": cid, "title": re.sub(r"^[>\s\"']+", "", title).strip()[:160], "url": RSI + m.group(1), "date": date})
    if not out:
        raise RuntimeError("RSI's Comm-Link page had no posts in it")
    out.sort(key=lambda c: c["id"], reverse=True)
    return out


def comm_link_notes(url, cid=None):
    """The full patch notes of a Comm-Link post: the page's own embedded data (RSI's site fills the text in with
    JavaScript, from data that's often already in the page), else the wiki API's copy of the post. Plain text
    with "- " bullets, or ""."""
    best = ""
    try:
        html = _text(url)
        for m in re.finditer(r'(?is)<script[^>]*>(.*?)</script>', html):
            body = m.group(1).strip()
            if not body or body[0] not in "{[":
                continue
            try:
                data = json.loads(body)
            except Exception:
                continue
            stack = [data]
            while stack:
                x = stack.pop()
                if isinstance(x, dict):
                    stack.extend(x.values())
                elif isinstance(x, list):
                    stack.extend(x)
                elif isinstance(x, str) and len(x) > len(best) and len(x) > 1500 and ("<li" in x or "\n- " in x or "\n* " in x):
                    best = x
    except Exception:
        pass
    if best and "<" in best:                                  # HTML: bullets and headings onto lines of their own
        t = re.sub(r"(?is)<li[^>]*>", "\n- ", best)
        t = re.sub(r"(?is)<h[1-6][^>]*>(.*?)</h[1-6]>", r"\n\1\n", t)
        t = re.sub(r"(?is)<(strong|b)>([^<]{2,60})</\1>\s*(?=<(?:ul|br))", r"\n\2\n", t)
        best = _strip(t)
    if not best and cid:
        try:
            best = comm_link_text(cid)
        except Exception:
            best = ""
    return best or ""


def rsi_post(url):
    """One RSI post: {text, image, summary} from its page (meta tags, JSON-LD and whatever text is in the HTML)."""
    html = _text(url)
    text = _strip(html)
    for m in re.finditer(r'(?is)<script[^>]+application/ld\+json[^>]*>(.*?)</script>', html):
        try:
            d = json.loads(m.group(1))
            for x in (d if isinstance(d, list) else [d]):
                if isinstance(x, dict):
                    text += "\n" + str(x.get("articleBody") or x.get("description") or "")
        except Exception:
            pass
    desc = _meta(html, "og:description") or _meta(html, "description")
    return {"text": (desc or "") + "\n" + text, "image": _meta(html, "og:image"), "summary": desc}


# ------------------------------------------------------------------ the hub
class Hub:
    """Builds the Patch Hub and keeps it in cache_dir/patchhub.json. get() answers at once with what's saved and
    builds a fresh copy in the background when it's older than ttl. events_file: your own list of events (see
    load_events); on the server it's the file you edit by hand."""

    def __init__(self, cache_dir, ttl=TTL, events_file=None, log=None):
        self.dir = Path(cache_dir)
        self.file = self.dir / "patchhub.json"
        self.state_file = self.dir / "patchhub_state.json"
        self.events_file = Path(events_file) if events_file else self.dir / "patchhub_events.json"
        self.ttl = ttl
        self.log = log or (lambda *a: print("patchhub:", *a, file=sys.stderr, flush=True))
        self._lock = threading.Lock()
        self._busy = False
        self._data = None
        self.debug = {}                  # what the last build decided from (python patchhub.py --debug)
        self.progress = {}               # step -> "waiting" / "running" / "done" / "failed", while a build runs
        self.building = False
        self._out = None                 # the build in progress, filled step by step (snapshot())
        self._olock = threading.Lock()

    # --------------------------------------------------- cache
    def _load(self, f, default):
        try:
            return json.loads(f.read_text(encoding="utf-8"))
        except Exception:
            return default

    def _save(self, f, data):
        self.dir.mkdir(parents=True, exist_ok=True)
        tmp = f.with_suffix(".tmp")
        tmp.write_text(json.dumps(data, ensure_ascii=False), encoding="utf-8")
        tmp.replace(f)

    def cached(self):
        if self._data is None:
            d = self._load(self.file, None)
            self._data = d if isinstance(d, dict) and d.get("v") == VERSION else None
        return self._data

    def get(self, wait=False, force=False):
        """The hub, as saved. wait: build it now when there's none (or force). A stale copy is refreshed in the
        background and returned meanwhile."""
        d = self.cached()
        if (d is None and wait) or (force and wait):
            with self._lock:
                return self.refresh()
        if force or d is None or time.time() - (d.get("at") or 0) > self.ttl:
            self.refresh_bg()
        return d

    def snapshot(self):
        """What the build in progress has so far (a copy), or None."""
        with self._olock:
            return json.loads(json.dumps(self._out, default=str)) if self._out else None

    def status(self):
        """{building, progress, partial}: for showing a build as it comes in."""
        return {"building": self.building, "progress": dict(self.progress), "partial": self.snapshot() if self.building else None}

    def refresh_bg(self):
        if self._busy:
            return
        self._busy = True
        self.building = True

        def run():
            try:
                with self._lock:
                    self.refresh()
            except Exception as e:
                self.log("refresh failed:", e)
            finally:
                self._busy = False
        threading.Thread(target=run, daemon=True).start()

    # --------------------------------------------------- build
    def refresh(self):
        """Build the hub. Steps that don't need each other run side by side, and each one's results land in the
        build as soon as it's done, so snapshot() can show the page filling in."""
        from concurrent.futures import ThreadPoolExecutor
        old = self._load(self.file, None) or {}
        if old.get("v") != VERSION:
            old = {}
        st = self._load(self.state_file, {})
        out = {"v": VERSION, "at": time.time(), "sources": {}, "links": dict(LINKS)}
        ctx = {}
        self.debug = {}
        self.building = True
        self.progress = {k: "waiting" for k in SECTION_KEYS}
        with self._olock:
            self._out = out

        def step(name, fn):
            t0 = time.time()
            self.progress[name] = "running"
            o = _View(out)                                   # this step writes here; merged in when it's done
            try:
                fn(o, ctx, st)
                src = {"ok": True, "at": time.time(), "ms": int((time.time() - t0) * 1000)}
                self.progress[name] = "done"
            except Exception as e:
                self.log(f"{name}: {e}")
                prev = (old.get("sources") or {}).get(name) or {}
                src = {"ok": False, "error": str(e)[:300], "at": time.time(),
                       "last_ok": prev.get("at") if prev.get("ok") else prev.get("last_ok")}
                for k in SECTION_KEYS[name]:                     # keep the last good copy of what it fills
                    if k not in o and k in old:
                        o[k] = old[k]
                self.progress[name] = "failed"
            with self._olock:
                for k, v in o.items():
                    if k == "links":
                        out["links"].update(v)
                    elif k == "warnings":
                        out.setdefault("warnings", []).extend(v)
                    else:
                        out[k] = v
                out["sources"][name] = src

        try:
            with ThreadPoolExecutor(max_workers=4) as ex:
                first = [ex.submit(step, "versions", self._versions), ex.submit(step, "comm_links", self._comm_links)]
                store = ex.submit(step, "store", self._store)            # needs nothing: runs all along
                for f in first:
                    f.result()
                events = ex.submit(step, "events", self._events)
                step("notes", self._notes)
                step("ships", self._ships)
                step("pipeline", self._pipeline)
                events.result()
                store.result()
            try:
                self._details(out, ctx)
            except Exception as e:
                self.log("ship details:", e)
            out.setdefault("live", old.get("live") or {})
            out.setdefault("ptu", old.get("ptu"))
            out["at"] = time.time()
            self._save(self.state_file, st)
            self._save(self.file, out)
            self._data = out
            return out
        finally:
            self.building = False
            with self._olock:
                self._out = None

    def _details(self, out, ctx):
        """Each listed ship's RSI store page (its link and price from the store list), and from that page the
        picture and RSI's description when the wiki has none: so a ship UEX doesn't list (the ATLS IKTI Akuma)
        still gets a full page in the Patch Hub."""
        store = ctx.get("store_ships") or []
        sq = lambda t: re.sub(r"[^a-z0-9]+", "", str(t or "").lower())
        idx = sorted(((sq(x["name"]), x) for x in store), key=lambda kv: -len(kv[0]))
        lists = [(out.get("ships") or {}).get("list") or []]
        for k in ("concept", "ptu", "new"):
            lists.append(((out.get("pipeline") or {}).get(k) or {}).get("ships") or [])
        todo = []
        for L in lists:
            for s in L:
                k = sq(s.get("name"))
                hit = next((x for kk, x in idx if kk == k), None) or next((x for kk, x in idx if len(kk) >= 5 and k.endswith(kk)), None)
                if hit:
                    s["store"] = hit.get("link") or s.get("store")
                    s["msrp"] = hit.get("msrp") or s.get("msrp")
                if s.get("store") and (not s.get("desc") or not s.get("image")) and len(todo) < 24:
                    todo.append(s)
        from concurrent.futures import ThreadPoolExecutor

        cache = getattr(self, "_pages", None)
        if cache is None:
            cache = self._pages = {}                  # a store page read in the last 12 hours isn't read again

        def page(s):
            try:
                hit = cache.get(s["store"])
                if hit and time.time() - hit[0] < 12 * 3600:
                    info = hit[1]
                else:
                    info = rsi_post(s["store"])
                    info = {"image": info.get("image"), "summary": info.get("summary")}
                    cache[s["store"]] = (time.time(), info)
                s.setdefault("image", info.get("image"))
                if not s.get("desc") and info.get("summary"):
                    s["desc"] = info["summary"][:1200]
            except Exception:
                pass
        with ThreadPoolExecutor(max_workers=6) as ex:
            list(ex.map(page, todo))

    def _veh(self, code):
        """vehicles(code), kept on disk: a numbered build never changes, so it's fetched once; the wiki's default
        (no code) is fetched again after 6 hours."""
        name = re.sub(r"[^A-Za-z0-9.]+", "_", code or "default")
        f = self.dir / f"patchhub_veh2_{name}.json"         # veh2: with descriptions and specs
        try:
            if f.exists() and (code or time.time() - f.stat().st_mtime < 6 * 3600):
                d = json.loads(f.read_text(encoding="utf-8"))
                if d:
                    return d
        except Exception:
            pass
        d = vehicles(code)
        self._save(f, d)
        for p in self.dir.glob("patchhub_vehicles_*.json"):    # the old format
            try:
                p.unlink()
            except OSError:
                pass
        olds = sorted(self.dir.glob("patchhub_veh2_*.json"), key=lambda p: p.stat().st_mtime)
        for p in olds[:-8]:                                     # keep the last few versions only
            try:
                p.unlink()
            except OSError:
                pass
        return d

    # each step fills `out` (and keeps what later steps need in ctx; st is saved between builds)
    def _versions(self, out, ctx, st):
        gv = game_versions()
        ctx["gv"] = gv
        self.debug["game_versions"] = gv
        if not (gv["all"] or gv["live"] or gv["ptu"]):
            raise RuntimeError("the wiki listed no game versions")

    def _comm_links(self, out, ctx, st):
        try:                                       # RSI's own news list (the wiki API's copy can be weeks behind)
            ctx["news"] = rsi_news()
        except Exception as ex:
            self.debug["rsi_news_error"] = str(ex)
        try:
            ctx["cl"] = comm_links()
        except Exception:
            if not ctx.get("news"):
                raise
            ctx["cl"] = []
        self.debug["comm_links"] = [(c["id"], c["title"], c["date"]) for c in ctx["cl"][:25]]
        self.debug["news"] = [(c["id"], c["title"], c.get("url")) for c in (ctx.get("news") or [])[:25]]

    def _notes(self, out, ctx, st):
        live = ptu = None
        spec_err = None
        try:
            sp = Spectrum()
            threads = [thread_info(t) for t in sp.threads()]
            self.debug["threads"] = [(t["title"], t["channel"], t["version"], t["date"]) for t in threads[:30]]
            threads = [t for t in threads if t["version"]]
            threads.sort(key=lambda t: (t["date"] or 0), reverse=True)
            lv = next((t for t in threads if t["channel"] == "LIVE"), None)
            pts = [t for t in threads if t["channel"] in ("PTU", "EPTU", "TECH-PREVIEW")]
            if lv:
                blocks, _ = sp.thread_blocks(lv["slug"])
                live = notes_out({k: lv[k] for k in ("version", "letter", "build", "title", "date", "url")},
                                 parse_blocks(blocks))
            # the PTU: the newest PTU notes, running while they're for a newer version than LIVE, or the same
            # version but posted after LIVE's (a hotfix on test)
            # the PTU running now: the newest PTU notes RSI hasn't marked "[Now Closed]", from the last few weeks,
            # for this LIVE version or a newer one (a release candidate of the same version still counts: the PTU
            # stays up with it until RSI closes it)
            pt = next((t for t in pts if not t["closed"]), None)
            self.debug["ptu_pick"] = [(t["title"], t["tag"], t["closed"], t["version"], t["build"], t["date"]) for t in pts[:8]]
            if pt:
                blocks, _ = sp.thread_blocks(pt["slug"])
                parsed = parse_blocks(blocks)
                wave = pt["tag"] or next((v for k, v in parsed["info"].items() if k.lower() == "audience"), None)
                if not wave:
                    w = WAVE.search(pt["title"])
                    wave = w.group(1) if w else None
                recent = not pt["date"] or time.time() - pt["date"] < 30 * 86400
                active = recent and (not live or vkey(pt["version"]) >= vkey(live["version"]))
                ptu = notes_out({k: pt[k] for k in ("version", "letter", "build", "title", "date", "url")}
                                | {"channel": pt["channel"], "wave": wave}, parsed, active)
        except Exception as e:
            spec_err = e
        if live is None:                                   # LIVE from the Comm-Link copy of the notes
            c = next((c for c in ctx.get("cl") or [] if re.match(r"(?i)^star citizen (alpha )?\d", c["title"])
                      and "ptu" not in c["title"].lower()), None)
            if c:
                ver, letter = find_version(c["title"])
                live = notes_out({"version": ver, "letter": letter, "build": None, "title": c["title"],
                                  "date": c["date"], "url": c["url"], "from": "comm-link"}, parse_text(comm_link_text(c["id"])))
        # the wiki's game data: a LIVE version newer than the notes we found, and a PTU build newer than LIVE
        gv = ctx.get("gv") or {}
        wl = gv.get("live") or []
        wiki_live = find_version(wl[0])[0] if wl else None
        if live is None and wiki_live:
            live = notes_out({"version": wiki_live, "letter": "", "build": None, "title": f"Star Citizen {wiki_live}",
                              "date": None, "url": LINKS["notes"]}, {"info": {}, "sections": []})
        if live is None:
            raise spec_err or RuntimeError("no LIVE patch notes found")
        def newer(code, ver, build):
            """A wiki game-version code for a build newer than (ver, build)."""
            if vkey(code) != vkey(ver):
                return vkey(code) > vkey(ver)
            b = re.findall(r"(\d{6,9})", code)
            return bool(b and build and int(b[-1]) > int(build))
        wp = next((c for c in gv.get("ptu") or [] if newer(c, live["version"], live.get("build"))), None)
        if wp and (not ptu or vkey(wp) > vkey(ptu["version"])):
            ver = find_version(wp)[0]
            b = re.findall(r"(\d{6,9})", wp)
            if not ptu or not ptu["active"] or vkey(ver) > vkey(ptu["version"]):
                ptu = notes_out({"version": ver, "letter": "", "build": b[-1] if b else None, "title": f"Star Citizen {ver} PTU",
                                 "date": None, "url": LINKS["notes"], "channel": "PTU", "wave": None, "from": "wiki"},
                                {"info": {}, "sections": []}, True)
        ctx["wiki_ptu"] = wp
        out["notes"] = {"live": live, "ptu": ptu}
        out["live"] = {"version": live["version"], "letter": live.get("letter"), "build": live.get("build"),
                       "date": live.get("date"), "url": live.get("url")}
        out["ptu"] = ({"version": ptu["version"], "letter": ptu.get("letter"), "build": ptu.get("build"),
                       "wave": ptu.get("wave"), "channel": ptu.get("channel"), "date": ptu.get("date"),
                       "url": ptu.get("url")} if ptu and ptu["active"] else None)
        # the LIVE notes' Comm-Link post ("Star Citizen Alpha 4.10.3"): the full notes, where Spectrum's post is
        # the abridged copy. It's the link, and its text is used when Quantum can read more of it than Spectrum's.
        pool = (ctx.get("news") or []) + (ctx.get("cl") or [])
        rx = re.compile(r"(?i)^star citizen (?:alpha )?(?:patch )?" + re.escape(live["version"] or "x") + r"(?![\d.])")
        cpost = next((c for c in pool if rx.match(c.get("title") or "") and not re.search(r"(?i)\bptu\b|evocati", c["title"])), None)
        if cpost:
            live["spectrum_url"] = live.get("url") if live.get("from") != "comm-link" else None
            live["url"] = cpost.get("url") or live.get("url")
            full = comm_link_notes(cpost["url"], cpost.get("id")) if cpost.get("url") else ""
            parsed = parse_text(full) if full else {"sections": []}
            n_full = sum(len(x["items"]) for x in parsed["sections"])
            n_now = sum(len(x["items"]) for x in live.get("sections") or [])
            self.debug["comm_link_notes"] = {"post": cpost.get("url"), "items_full": n_full, "items_spectrum": n_now}
            if n_full > n_now:
                keep = {k: live.get(k) for k in ("version", "letter", "build", "title", "date", "url", "spectrum_url")}
                live = notes_out({**keep, "from": "comm-link"}, parsed)
                out["notes"]["live"] = live
        out["live"]["url"] = live.get("url")
        out["links"]["notes"] = live.get("url") or LINKS["notes"]
        out["links"]["notes_spectrum"] = live.get("spectrum_url")
        out["links"]["notes_ptu"] = (ptu or {}).get("url")
        ctx["live_text"] = notes_text(live)
        ctx["ptu_text"] = notes_text(ptu) if ptu and ptu["active"] else ""
        self.debug["ptu_decision"] = {"spectrum_ptu": (ptu or {}).get("title"), "active": bool(ptu and ptu["active"]),
                                      "wiki_ptu_code": wp, "live": live["version"]}
        if spec_err:
            out.setdefault("warnings", []).append(f"Spectrum: {spec_err}")

    def _ships(self, out, ctx, st):
        live_ver = (out.get("live") or {}).get("version")
        gv = ctx.get("gv") or game_versions()
        codes = gv.get("live") or []
        cur_code = next((c for c in codes if live_ver and vkey(c) == vkey(live_ver)), None) or gv.get("default") or (codes[0] if codes else None)
        # "this release": 4.10.0 to 4.10.3 are one release, so it's compared with the last build of the release
        # before (4.9.x). Point releases come and go every few weeks; a ship that came with 4.10.2 is still new.
        rel = vkey(live_ver)[:2] if live_ver else None
        prev_code = next((c for c in codes if rel and vkey(c)[:2] < rel), None)
        wp = ctx.get("wiki_ptu") if out.get("ptu") else None
        from concurrent.futures import ThreadPoolExecutor
        with ThreadPoolExecutor(max_workers=3) as ex:            # the three versions' lists side by side
            fut = {k: ex.submit(self._veh, c) for k, c in (("cur", cur_code), ("prev", prev_code), ("ptu", wp)) if c or k == "cur"}
        cur = fut["cur"].result()
        for v in cur.values():                       # a maker the wiki's data is missing: from the name ("Argo …")
            if not v.get("maker") or v["maker"].lower() in ("unknown", "n/a", "none", "<= placeholder =>"):
                v["maker"] = MAKERS.get(v["name"].split(" ")[0].lower(), "")
        names = {v["name"].lower(): v for v in cur.values()}
        # remember this version's ships: next patch, the comparison is with exactly the version before
        hist = st.setdefault("veh_by_version", {})
        if live_ver:
            hist[live_ver] = sorted(cur)
        for k in sorted(hist, key=vkey)[:-6]:
            hist.pop(k, None)
        tracked = next((v for v in sorted(hist, key=vkey, reverse=True) if live_ver and vkey(v) < vkey(live_ver)), None)
        new, how, base = [], "none", None
        norm = lambda n: re.sub(r"[^a-z0-9]+", "", re.sub(r"\bmk\s*[ivx]+\b", "", n.lower()))
        if prev_code:
            prev = fut["prev"].result()
            was = {norm(v["name"]) for v in prev.values()}
            cand = [cur[k] for k in cur if k not in prev]
            # a ship that only got a new name (the Constellations became "Mk IV" in 4.10) isn't new
            new = [v for v in cand if norm(v["name"]) not in was]
            how, base = "release", find_version(prev_code)[0]
            self.debug["ships_candidates"] = [v["name"] for v in cand]
            self.debug["ships_renamed"] = [v["name"] for v in cand if norm(v["name"]) in was]
        # the game files can hold the same ship more than once (separate ids for the same name): one card each
        uniq = {}
        for v in new:
            uniq.setdefault(re.sub(r"[^a-z0-9]+", "", v["name"].lower()), v)
        new = list(uniq.values())
        out["ships"] = {"version": live_ver, "release": f"{rel[0]}.{rel[1]}" if rel else None, "compared_with": base, "how": how,
                        "list": sorted(new, key=lambda v: (v["vehicle"], v["maker"], v["name"]))[:24]}
        # on the PTU: in the PTU build but not on LIVE, and ships the PTU notes name that LIVE doesn't have
        on_ptu = {}
        if "ptu" in fut:
            try:
                pv = fut["ptu"].result()
                for k, v in pv.items():
                    if k not in cur:
                        on_ptu[v["name"].lower()] = v
                names.update({v["name"].lower(): v for v in pv.values()})
            except Exception as e:
                self.log("ptu vehicles:", e)
        ctx["known"] = names
        ctx["on_ptu"] = on_ptu
        ctx["live_keys"] = set(cur)
        self.debug["ships"] = {"live_code": cur_code, "prev_code": prev_code, "tracked": tracked, "how": how,
                               "new": [v["name"] for v in new], "on_ptu_build": list(on_ptu)}

    def _pipeline(self, out, ctx, st):
        sm = ship_matrix()
        on_ptu = dict(ctx.get("on_ptu") or {})
        txt = ctx.get("ptu_text") or ""
        if txt:
            live_names = {v["name"].lower() for k, v in (ctx.get("known") or {}).items() if v.get("key") in (ctx.get("live_keys") or set())}
            pool = list((ctx.get("known") or {}).values()) + sm["concept"] + sm["production"] + sm["flight"]
            for s in pool:
                n = s["name"].lower()
                if n in on_ptu or len(_words(s["name"])) < 1 or len(s["name"]) < 5:
                    continue
                if mentioned(s["name"], txt) and (n not in live_names or s.get("status", "").find("concept") >= 0):
                    on_ptu[n] = s
        new_list = (out.get("ships") or {}).get("list", [])
        live_names_new = {s["name"].lower() for s in new_list}
        concept = [s for s in sm["concept"] if s["name"].lower() not in on_ptu and s["name"].lower() not in live_names_new]
        out["pipeline"] = {
            "concept": {"n": len(concept), "ships": concept[:10]},
            "ptu": {"n": len(on_ptu), "ships": sorted(on_ptu.values(), key=lambda s: s["name"])[:10]},
            "new": {"n": len(new_list), "ships": new_list[:10]}}
        self.debug["on_ptu"] = sorted(on_ptu)

    def _events(self, out, ctx, st):
        """Events from four places, merged: your own events file (wins), the wiki's event pages (in-game events and
        their status: "Active"), RSI's news read straight from RSI (announcements, dates, banner images) and the
        weekly schedule in This Week in Star Citizen."""
        now = time.time()
        events, dbg = [], {}

        def add(e):
            k = ev_words(e["name"])
            for o in events:
                ok = ev_words(o["name"])
                if k and ok and (k <= ok or ok <= k or len(k & ok) >= 2):
                    for kk, vv in e.items():                  # fill in what the first one lacked (dates, a picture)
                        if vv and not o.get(kk):
                            o[kk] = vv
                    if e.get("from") == "rsi" and o.get("from") != "rsi":
                        o["rsi"] = o.get("rsi") or e.get("url")      # the wiki page stays the link; RSI's post too
                        if e.get("image"):
                            o["image"] = e["image"]                  # RSI's banner over the wiki's picture
                    exact = e.get("starts") and int(e["starts"]) % 86400 not in (0, 86340)
                    if e.get("starts") and e.get("ends") and (not (o.get("starts") and o.get("ends")) or (o.get("approx") and exact)):
                        o["starts"], o["ends"], o["approx"] = e["starts"], e["ends"], False
                    return
            events.append(dict(e))

        for e in load_events(self.events_file):
            add({**e, "starts": _ts(e.get("starts")), "ends": _ts(e.get("ends")), "from": "quantum"})
        # RSI's news, straight from RSI; the wiki API's copy when RSI's page can't be read
        news = ctx.get("news") or ctx.get("cl") or []
        dbg["news"] = [(c["id"], c["title"], c.get("date")) for c in news[:20]]
        # the wiki's event pages
        try:
            extra = []                                       # the wiki page of an event RSI is announcing
            for c in news[:30]:
                for rx, base in ((r"(?i)(?:intergalactic aerospace expo|\biae)\s*(\d{4})", "Intergalactic Aerospace Expo"),
                                 (r"(?i)invictus(?: launch week)?\s*(\d{4})", "Invictus Launch Week")):
                    m = re.search(rx, c["title"])
                    if m and f"{base} {m.group(1)}" not in extra:
                        extra.append(f"{base} {m.group(1)}")
            we = wiki_events(self.log, extra)
            dbg["wiki"] = [(e["name"], e["status"], e["starts"], e["ends"]) for e in we]
            for e in we:
                stt = e["status"]
                if re.search(r"ended|concluded|inactive|cancel|finished|past|over", stt):
                    continue
                if "unannounced" in stt and not e["starts"]:
                    continue                                  # a page made ahead of time, nothing known yet
                live = bool(re.search(r"\b(active|ongoing|running|live|current)\b", stt))
                soon = bool(re.search(r"\b(upcoming|announced|scheduled|soon)\b", stt)) and "unannounced" not in stt
                if soon and not live and not e["starts"]:
                    continue                                  # "upcoming" with no date yet: nothing to count down to
                dated = (e["ends"] and e["ends"] > now - 86400) or (e["starts"] and now - 45 * 86400 < e["starts"] < now + 60 * 86400)
                if live or soon or dated:
                    # the wiki has dates without a time: RSI's events open at 16:00 UTC and close at 20:00 UTC
                    # (IAE, Invictus, free flies), so that's used, marked as approximate, until RSI's own post
                    # gives the exact time
                    x = {**e, "status_live": live, "from": "wiki"}
                    if x.get("starts") and x["starts"] % 86400 == 0:
                        x["starts"] += 16 * 3600
                        x["approx"] = True
                    if x.get("ends") and x["ends"] % 86400 == 0:
                        x["ends"] += 20 * 3600
                        x["approx"] = True
                    add(x)
        except Exception as ex:
            dbg["wiki_error"] = str(ex)
        posts = [c for c in news if EVENT_RE.search(c["title"]) and not NOT_EVENT.search(c["title"])][:8]
        announced = []
        for c in posts:
            name = re.sub(r"\s*[|–-]\s*(star citizen|roberts space industries|try star citizen for free)\s*$", "", c["title"], flags=re.I).strip()
            info = {"text": "", "image": None, "summary": None}
            try:
                info = rsi_post(c["url"]) if c.get("url") else info
            except Exception:
                try:
                    info["text"] = comm_link_text(c["id"])
                except Exception:
                    pass
            text = info["text"] or ""
            s, e = date_range(name + " . " + text, c.get("date") or now)
            rec = {"name": name, "starts": s, "ends": e, "url": c.get("url"), "image": info.get("image"), "from": "rsi",
                   "note": info.get("summary") or _summary(text, name),
                   "free_fly": bool(re.search(r"(?i)free[\s-]*fly|play (star citizen )?for free|free to play", name + " " + text[:4000]))}
            if TWITCH_RE.search(name):
                rec["rewards"] = drop_rewards(text) or None
            if s or any(ev_words(name) & ev_words(o["name"]) for o in events):
                add(rec)
            else:
                announced.append({"name": name, "url": c.get("url"), "date": c.get("date"), "image": info.get("image"), "state": "announced", "from": "rsi"})
        # This Week in Star Citizen's dated schedule
        tw = next((c for c in news if re.search(r"(?i)^this week in star citizen", c["title"])), None)
        sched = []
        if tw:
            try:
                txt = rsi_post(tw["url"])["text"] if tw.get("url") and "comm-link" in tw["url"] else comm_link_text(tw["id"])
                sched = schedule_items(txt, tw.get("date") or now)
                if not sched:
                    sched = schedule_items(comm_link_text(tw["id"]), tw.get("date") or now)
            except Exception as ex:
                dbg["schedule_error"] = str(ex)
            out["links"]["events"] = tw.get("url") or LINKS["events"]
        for day, item in sched:
            if EVENT_RE.search(item) and not NOT_EVENT.search(item):
                nm = re.sub(r"(?i)\s+(begins|starts|kicks off|opens|launches)$", "", item)
                add({"name": nm, "starts": day, "ends": None, "url": (tw or {}).get("url"), "from": "schedule"})
        dbg["schedule"] = sched
        # Twitch drops: the campaign's rewards and Twitch's exact window on the wiki's "Twitch drops" event (or a
        # card of its own when nothing else lists it)
        for c in TWITCH_DROPS:
            cs, cf = _ts(c["starts"]), _ts(c["ends"])
            if cf < now - 86400 or cs > now + 60 * 86400:
                continue
            ev = next((e for e in events if TWITCH_RE.search(e["name"]) and
                       (not e.get("starts") or e["starts"] <= cf + 86400) and (not e.get("ends") or e["ends"] >= cs - 86400)), None)
            if ev is None:
                ev = {"name": f"Twitch drops: {c['campaign']}", "from": "quantum", "url": TWITCH_LINKS["streams"]}
                events.append(ev)
            if not ev.get("rewards"):
                ev["rewards"] = c["rewards"]
            ev["campaign"] = ev.get("campaign") or c["campaign"]
            if not ev.get("starts") or ev.get("approx") or ev.get("from") != "quantum":
                ev["starts"], ev["ends"], ev["approx"] = cs, cf, False
        for e in events:
            if TWITCH_RE.search(e["name"]):
                e["rewards"] = clean_rewards(e.get("rewards")) or None
                e["twitch"] = TWITCH_LINKS
        # an event's free rental & pledge schedule (IAE) is a card of its own: who's featured now and next,
        # with its own countdown; the event's card keeps the sales and concept reveals
        for e in list(events):
            R = [r for r in ((e.get("schedule") or {}).get("rentals") or []) if r.get("starts")]
            if not R:
                continue
            short = re.sub(r"(?i)intergalactic aerospace expo", "IAE", e["name"])
            events.append({"name": f"{short} Pledge & Free Rental Schedule", "starts": R[0]["starts"],
                           "ends": max(r.get("ends") or r["starts"] for r in R), "url": e.get("url"), "rsi": e.get("rsi"),
                           "image": (e.get("schedule_image") or {}).get("thumb") or e.get("image"), "from": e.get("from"),
                           "kind": "Free rentals", "where": e.get("where"), "free_fly": e.get("free_fly"), "rentals": True,
                           "schedule": {"rentals": e["schedule"]["rentals"]}, "schedule_image": e.get("schedule_image"),
                           "note": "Each manufacturer's ships are free to rent at the expo on their days, and on sale on "
                                   "the RSI store. In the finale, every ship from the expo can be rented."})
            e["schedule"] = {k: v for k, v in e["schedule"].items() if k != "rentals"} or None
        out_list = []
        for e in events:
            s, f = e.get("starts"), e.get("ends")
            if f and f < now - 86400:
                continue                                          # over
            if e.get("status_live"):
                state = "live" if not s or s <= now else "soon"
            elif e.get("from") == "wiki" and s and s > now:
                state = "soon"
            elif not f and s and s < now - 3 * 86400 and e.get("from") != "wiki":
                continue                                          # a one-day item from last week
            else:
                state = "live" if (not s or s <= now) and (not f or f >= now) else "soon" if s and s > now else "ended"
            if state == "soon" and s and s - now > 60 * 86400:
                continue
            if state == "live" and not s and not f and e.get("from") not in ("wiki", "quantum"):
                continue                                          # no dates and nothing saying it's on: not shown as on
            pct = round(100 * (now - s) / (f - s)) if s and f and f > s and state == "live" else 0
            out_list.append({**e, "state": state, "pct": max(0, min(100, pct)),
                             "day": int((now - s) // 86400) + 1 if state == "live" and s else None})
        out_list.sort(key=lambda e: ({"live": 0, "soon": 1, "ended": 2}[e["state"]],
                                     (e.get("ends") or 9e12) if e["state"] == "live" else (e.get("starts") or 9e12)))
        nxt = next((e for e in out_list if e["state"] == "soon" and e.get("starts")), None)
        out["events"] = {"list": out_list[:10], "announced": announced[:6],
                         "next": {"name": nxt["name"], "starts": nxt["starts"]} if nxt else None}
        dbg["result"] = [(e["name"], e["state"], e.get("starts"), e.get("ends"), e.get("from")) for e in out_list]
        self.debug["events"] = dbg

    def _store(self, out, ctx, st):
        try:
            import ccu                              # the RSI upgrade tool, as the Upgrades tab uses it (the app)
        except ImportError:
            from . import sccu as ccu               # the server's copy of ccu.py (the quantum package)
        ships = ccu.Rsi().ships()
        ctx["store_ships"] = ships
        now = time.time()
        seen = st.get("store") or {}
        first = not seen
        new = []
        for s in ships:
            sid = str(s["id"])
            rec = seen.get(sid)
            if rec is None:
                seen[sid] = rec = {"at": now, "skus": {}}
                if not first:
                    new.append({"name": s["name"], "kind": "New ship", "price": s["msrp"], "url": s.get("link"), "added": now})
            for k in s["skus"]:
                if not k.get("id") or not k.get("available"):
                    continue
                kid = str(k["id"])
                if kid not in rec["skus"]:
                    rec["skus"][kid] = now
                    if not first and rec["at"] != now:
                        new.append({"name": s["name"], "kind": k["title"], "price": k["price"], "url": s.get("link"), "added": now})
        st["store"] = seen
        recent = [x for x in (st.get("store_new") or []) if x["added"] > now - 30 * 86400]
        recent = (new + recent)[:40]
        st["store_new"] = recent
        special = []
        for s in ships:
            for k in s["skus"]:
                t = k["title"].lower()
                if k.get("available") and (k.get("warbond") or any(w in t for w in ("limited", "best in show", "iae", "invictus", "anniversary"))):
                    special.append({"name": s["name"], "kind": k["title"], "price": k["price"], "url": s.get("link"),
                                    "added": (seen.get(str(s["id"])) or {}).get("skus", {}).get(str(k["id"]))})
        special.sort(key=lambda x: -(x["added"] or 0))
        # the store's newest ships: RSI numbers its ships in the order they were added
        latest = [{"name": s["name"], "kind": "Ship", "price": s["msrp"], "url": s.get("link"), "id": s["id"],
                   "added": (seen.get(str(s["id"])) or {}).get("at") if not first else None}
                  for s in sorted(ships, key=lambda s: -s["id"])[:8]]
        out["store"] = {"new": recent[:12], "special": special[:12], "latest": latest, "since": min((r.get("at") or now) for r in seen.values()) if seen else now}


def _summary(text, name):
    """The post's first real sentence, for the event card."""
    for line in (text or "").splitlines():
        t = _clean(line)
        if len(t) > 40 and t.lower() != name.lower() and not DAYHDR.match(t):
            return t[:220] + ("…" if len(t) > 220 else "")
    return None


class _View(dict):
    """One step's results: what it writes stays here (merged in when the step is done); what it reads comes from
    here, then from the build so far."""
    def __init__(self, base):
        super().__init__(links={})
        self._base = base

    def __missing__(self, k):
        return self._base[k]

    def get(self, k, default=None):
        return super().get(k) if k in self.keys() else self._base.get(k, default)

    def __contains__(self, k):
        return super().__contains__(k) or k in self._base


SECTION_KEYS = {"versions": (), "comm_links": (), "notes": ("notes", "live", "ptu"), "ships": ("ships",),
                "pipeline": ("pipeline",), "events": ("events",), "store": ("store",)}


def load_events(path):
    """Your own events, a JSON list (or {"events": [...]}) like
         [{"name": "Invictus Launch Week", "where": "Stanton · New Babbage", "starts": "2026-05-15",
           "ends": "2026-05-28", "url": "https://robertsspaceindustries.com/...", "note": "Free fly, ship expo"}]
    Dates are ISO dates or times (UTC). Missing or broken file: no events. These win over the automatic ones."""
    try:
        d = json.loads(Path(path).read_text(encoding="utf-8"))
    except Exception:
        return []
    rows = d.get("events") if isinstance(d, dict) else d
    return [e for e in rows or [] if isinstance(e, dict) and e.get("name")]


if __name__ == "__main__":     # python patchhub.py [--debug] [cache dir]: try every source, show what came back
    import tempfile
    args = [a for a in sys.argv[1:] if not a.startswith("--")]
    d = Path(args[0]) if args else Path(tempfile.mkdtemp())
    hub = Hub(d, log=lambda *a: print("  !", *a))
    print("Building the Patch Hub in", d, "...")
    r = hub.refresh()
    for k, v in r["sources"].items():
        print(f"{k:11} {'ok  ' if v['ok'] else 'FAIL'} {v.get('ms', '')}{'ms' if v.get('ms') is not None else ''} {v.get('error', '')}")
    print("LIVE:", r.get("live"))
    print("PTU: ", r.get("ptu"))
    n = r.get("notes") or {}
    for side in ("live", "ptu"):
        x = n.get(side)
        if x:
            print(f"{side} notes: {x['title']!r}, sections:", ", ".join(f"{c['name']} ({c['n']})" for c in x["cats"]))
    sh = r.get("ships") or {}
    print(f"New ships ({sh.get('how')}, vs {sh.get('compared_with')}):", [s["name"] for s in sh.get("list", [])])
    print("Events:", [(e["name"], e["state"]) for e in (r.get("events") or {}).get("list", [])], "+ announced:",
          [e["name"] for e in (r.get("events") or {}).get("announced", [])])
    print("Store new:", len((r.get("store") or {}).get("new", [])), "special:", len((r.get("store") or {}).get("special", [])))
    print("Pipeline:", {k: [s["name"] for s in v["ships"]] for k, v in (r.get("pipeline") or {}).items()})
    if "--debug" in sys.argv:
        print("\n---- debug ----")
        for k, v in hub.debug.items():
            print(f"\n[{k}]")
            print(json.dumps(v, indent=1, default=str, ensure_ascii=False)[:6000])
