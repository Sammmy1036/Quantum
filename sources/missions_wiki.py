"""Contract details from the Star Citizen Wiki API (api.star-citizen.wiki, built from the game files;
please credit it). For a contract Quantum read from Game.log, it finds the wiki's mission record and
boils it down to what's useful on the Contracts tab: payout, reputation, cargo, where it can send you.

Matching: the log gives the contract's code ("TheCollector_FoodOrder"), which is the mission's
debug_name on the wiki, and its title. /api/missions?filter[query]=... searches both, then
/api/missions/{uuid} has the full record.

These are the mission's template numbers: a payout range, cargo ranges and the places it *can* use.
Your own contract's pickup and drop-off still come from Game.log.

Cached on disk for a week (the data only changes with patches); misses are remembered for a day.
"""
import json
import re
import threading
import time
import urllib.error
import urllib.parse
import urllib.request
from pathlib import Path

import netcache
import gamefiles

API = "https://api.star-citizen.wiki/api/missions"
UA = {"User-Agent": "Quantum (Star Citizen route planner; github.com/Sammmy1036/Quantum)"}
HIT_TTL, MISS_TTL = 7 * 86400, 86400
MAX_PLACES = 12                                   # per group; some missions list dozens


def _get(url, timeout=20):
    with netcache.fetch(urllib.request.Request(url, headers=UA), timeout=timeout) as r:
        return json.loads(r.read().decode("utf-8"))


def _norm(s):
    return re.sub(r"[^a-z0-9]", "", (s or "").lower())


def _title_guesses(name):
    """'DEAD SAINTS -- Rookie Rank, Small Scale Cargo Run' -> that, and 'Rookie Rank, Small Scale Cargo Run'."""
    name = (name or "").strip()
    out = [name] if name else []
    if " -- " in name:
        out.append(name.split(" -- ", 1)[1].strip())
    if ": " in name:
        out.append(name.split(": ", 1)[1].strip())
    return [x for x in dict.fromkeys(out) if len(x) >= 3]


class MissionWiki:
    def __init__(self, cache_dir):
        self.path = Path(cache_dir) / "wiki_missions.json"
        self._lock = threading.Lock()
        self._cache = None

    # ------------------------------------------------------------ cache
    def _load(self):
        if self._cache is None:
            try:
                self._cache = json.loads(self.path.read_text(encoding="utf-8"))
            except Exception:
                self._cache = {}
        return self._cache

    def _save(self):
        try:
            self.path.parent.mkdir(exist_ok=True)
            self.path.write_text(json.dumps(self._cache), encoding="utf-8")
        except OSError:
            pass

    def cached(self, code, name):
        """What's cached for this contract (summary, None for a known miss), or ... if not looked up yet."""
        with self._lock:
            e = self._load().get(f"{code}|{name}")
        if not e or time.time() - e.get("at", 0) > (HIT_TTL if e.get("data") else MISS_TTL):
            return ...
        return e.get("data")

    # ------------------------------------------------------------ lookup
    def local(self, code, name):
        """The contract from Quantum's own game data (gamefiles.Contracts), as a summary, or None."""
        files = getattr(self, "files", None)
        if not files:
            return None
        _, c = files.find(code, name, _title_guesses(name) if name else ())
        return files.summary(c) if c else None

    def lookup(self, code, name, system=None):
        """Summary of a contract: Quantum's own game data (this patch's title, reward, cargo, reputation)
        with the wiki's mission record filling in the rest (the places it can send you, blueprints, time
        limits). None if neither has it. Raises OSError-like errors only when the game data doesn't have it
        and the wiki can't be reached."""
        mine = self.local(code, name)
        try:
            wiki = self._wiki_lookup(code, name, system)
        except Exception:
            if mine:
                return mine                         # the wiki is down or rate limited: ours still answers
            raise
        return gamefiles.merge_contract(mine, wiki)

    def _wiki_lookup(self, code, name, system=None):
        hit = self.cached(code, name)
        if hit is not ...:
            return hit
        rec = self._find(code, name, system)
        data = summarize(rec) if rec else None
        with self._lock:
            self._load()[f"{code}|{name}"] = {"at": time.time(), "data": data}
            self._save()
        return data

    def _search(self, text):
        q = urllib.parse.urlencode({"filter[query]": text, "page[size]": 50})
        return _get(f"{API}?{q}").get("data") or []

    def _find(self, code, name, system):
        def pick(rows, ok):
            rows = [r for r in rows if ok(r)]
            if system:                                   # the same mission often exists per system
                here = [r for r in rows if system in (r.get("star_systems") or [])]
                rows = here or rows
            return rows[0] if rows else None

        best = None
        if code:
            rows = self._search(code)
            best = pick(rows, lambda r: _norm(r.get("debug_name")) == _norm(code))
        if not best:
            for t in _title_guesses(name):
                rows = self._search(t)
                best = pick(rows, lambda r: _norm(r.get("title")) == _norm(t))
                if best:
                    break
        if not best or not best.get("uuid"):
            return None
        return _get(f"{API}/{urllib.parse.quote(best['uuid'])}", timeout=25).get("data")

    # ------------------------------------------------------------ a mission on its own page
    def page(self, ref=None, code=None, title=None):
        """The full in-app page for one mission (Blueprints → How you get it): the contract summary plus
        its briefing, what has to be done first and what it can lead to. ref is the mission's uuid or
        slug (the last part of its wiki address); without one it's found by its code or title.
        None if the wiki doesn't have it; raises when the wiki can't be reached."""
        key = f"page|{ref or ''}|{code or ''}|{title or ''}"
        with self._lock:
            e = self._load().get(key)
        if e and time.time() - e.get("at", 0) < (HIT_TTL if e.get("data") else MISS_TTL):
            return e.get("data")
        rec = None
        if ref:
            try:
                rec = _get(f"{API}/{urllib.parse.quote(str(ref))}", timeout=25).get("data")
            except urllib.error.HTTPError as err:
                if err.code != 404:
                    raise
        if not rec and (code or title):
            rec = self._find(code, title, None)
        data = page_summary(rec) if rec else None
        with self._lock:
            self._load()[key] = {"at": time.time(), "data": data}
            self._save()
        return data


    # ------------------------------------------------------------ employers and factions (the Missions tab)
    def faction(self, name):
        """What the wiki knows about a faction: its overview (type, headquarters, area, focus, founded,
        leadership...), description and reputation ranks. The wiki keeps that on each of the faction's missions,
        so one of them is fetched. None when it has none; raises when the wiki can't be reached."""
        key = f"faction|{_norm(name)}"
        with self._lock:
            e = self._load().get(key)
        if e and time.time() - e.get("at", 0) < (HIT_TTL if e.get("data") else MISS_TTL):
            return e.get("data")
        rows = _get(f"{API}?" + urllib.parse.urlencode({"filter[faction]": name, "page[size]": 5})).get("data") or []
        fac = None
        for r in rows[:3]:
            f = r.get("faction") if isinstance(r.get("faction"), dict) else None
            if (not f or len(f) < 4) and r.get("uuid"):
                f = (_get(f"{API}/{urllib.parse.quote(r['uuid'])}", timeout=25).get("data") or {}).get("faction")
            if isinstance(f, dict) and _norm(f.get("name")) == _norm(name):
                fac = f
                break
        data = faction_summary(fac) if fac else None
        with self._lock:
            self._load()[key] = {"at": time.time(), "data": data}
            self._save()
        return data

    def wiki_index(self, pages=25):
        """Every mission the wiki lists, boiled down for the Missions tab (used when Quantum's own game data
        isn't on this PC yet). Cached for a week."""
        key = "index"
        with self._lock:
            e = self._load().get(key)
        if e and e.get("data") and time.time() - e.get("at", 0) < HIT_TTL:
            return e["data"]
        out = []
        for page in range(1, pages + 1):
            q = urllib.parse.urlencode({"page[size]": 200, "page[number]": page})
            got = _get(f"{API}?{q}", timeout=30)
            rows = got.get("data") or []
            for m in rows:
                fac = m.get("faction")
                out.append({"title": m.get("title"), "giver": m.get("mission_giver"),
                            "faction": fac.get("name") if isinstance(fac, dict) else fac,
                            "type": m.get("mission_type"), "reward": m.get("reward_min"), "reward_max": m.get("reward_max"),
                            "currency": m.get("reward_currency"), "lawful": not m.get("illegal"), "rank": m.get("rank_index"),
                            "ref": m.get("uuid"), "code": m.get("debug_name"), "systems": m.get("star_systems") or []})
            last = ((got.get("meta") or {}).get("last_page")) or 0
            if not rows or (last and page >= last):
                break
        with self._lock:
            self._load()[key] = {"at": time.time(), "data": out}
            self._save()
        return out


# ------------------------------------------------------------ factions
_FAC_SKIP = {"uuid", "id", "name", "slug", "description", "web_url", "link", "image", "logo", "version", "updated_at",
             "created_at", "class_name", "debug_name"}


def faction_summary(f):
    """A wiki faction record -> {name, overview: [[label, value]], description, ranks: [[name, xp]]}.
    Read loosely: the wiki's field names change now and then, so any plain field is shown under its own name."""
    over, ranks = [], []
    for k, v in f.items():
        if k in _FAC_SKIP or v in (None, "", [], {}):
            continue
        if isinstance(v, (str, int, float)) and not isinstance(v, bool):
            over.append([k.replace("_", " ").strip().capitalize(), str(v)])
        elif isinstance(v, list) and v and all(isinstance(x, dict) for x in v):
            for x in v:                             # reputation ranks: [{name, xp / min_reputation / ...}]
                nm = x.get("name") or x.get("label") or x.get("title")
                num = next((x[n] for n in ("xp", "xp_required", "min_reputation", "reputation", "threshold", "value", "amount")
                            if isinstance(x.get(n), (int, float))), None)
                if nm:
                    ranks.append([str(nm), num])
        elif isinstance(v, dict):                   # {"reputation": {"ranks": [...]}}
            for x in v.values():
                if isinstance(x, list):
                    ranks += faction_summary({"_r": x})["ranks"]
    return {"name": f.get("name"), "overview": over[:12], "description": _clean_text(f.get("description"))[:1500] or None,
            "ranks": ranks[:20], "url": f.get("web_url")}


# ------------------------------------------------------------ summary
def _places(group):
    names, seen = [], set()
    for L in group or []:
        n = (L or {}).get("name")
        if n and n not in seen:
            seen.add(n)
            names.append(n)
    return {"names": names[:MAX_PLACES], "more": max(0, len(names) - MAX_PLACES)}


def _orders(orders):
    """hauling_orders -> [{what, scu: [min, max], box, amount: [min, max]}], 'or' options flattened."""
    out = []
    for o in orders or []:
        if not isinstance(o, dict):
            continue
        if o.get("or_options"):
            for group in o["or_options"]:
                out += _orders(group if isinstance(group, list) else [group])
            continue
        items = [i.get("name") for i in o.get("items") or [] if i.get("name")]
        what = o.get("name") or ", ".join(items[:3]) + (f" +{len(items) - 3} more" if len(items) > 3 else "")
        if not what:
            continue
        out.append({"what": what,
                    "scu": [o.get("min_scu"), o.get("max_scu")] if o.get("max_scu") else None,
                    "box": o.get("max_container_size"),
                    "amount": [o.get("min_amount"), o.get("max_amount")] if o.get("max_amount") else None})
    return out


def summarize(m):
    """The parts of a wiki mission record the Contracts tab shows."""
    m = m or {}
    merged = m.get("merged_locations") or {}
    fac = m.get("faction") or {}
    rep = [{"faction": r.get("faction") or r.get("name") or fac.get("name"), "amount": r.get("amount")}
           for r in (m.get("reputation_gained") or []) if isinstance(r, dict) and r.get("amount")]
    rewards = [r.get("name") for r in (m.get("reward_items") or []) if isinstance(r, dict) and r.get("name")]
    bps = []                                      # blueprints come in drop pools: [{drop_chance, items: [...]}]
    for pool in m.get("blueprints") or []:
        if isinstance(pool, dict):
            bps += [i.get("name") for i in pool.get("items") or [] if isinstance(i, dict)] or [pool.get("name")]
    bps = list(dict.fromkeys(bps))
    return {
        "title": m.get("title"), "debug_name": m.get("debug_name"), "type": m.get("mission_type"),
        "giver": m.get("mission_giver"), "faction": fac.get("name"),
        "reward": [m.get("reward_min"), m.get("reward_max")] if m.get("reward_min") or m.get("reward_max") else None,
        "currency": m.get("reward_currency") or "aUEC",
        "rep": rep or ([{"faction": fac.get("name"), "amount": m.get("reputation_amount")}]
                       if m.get("reputation_amount") else []),
        "rank": m.get("rank_index"), "illegal": bool(m.get("illegal")),
        "minutes": m.get("time_to_complete_minutes"),
        "combat": bool(m.get("has_combat")),
        "enemies": [m.get("enemy_count_min"), m.get("enemy_count_max")] if m.get("enemy_count_max") else None,
        "max_players": m.get("max_players_per_instance"), "shareable": m.get("shareable"),
        "cargo": _orders(m.get("hauling_orders")),
        "pickups": _places(merged.get("Locations")),
        "destinations": _places(merged.get("Destinations")),
        "offered_at": _places(merged.get("Availability")),
        "reward_items": rewards[:12], "blueprints": [b for b in bps if b][:12],
        "url": m.get("web_url"), "version": m.get("version"),
    }


def _chain(groups):
    """prerequisite_groups / unlock_groups -> [{title, uuid}] (each mission once)."""
    out, seen = [], set()
    for g in groups or []:
        for m in (g or {}).get("missions") or []:
            t = (m or {}).get("title")
            if t and t not in seen:
                seen.add(t)
                out.append({"title": t, "uuid": m.get("uuid")})
    return out[:20]


def _clean_text(t):
    t = re.sub(r"<[^>]+>", "", str(t or ""))
    t = re.sub(r"~mission\(([^)|]*)[^)]*\)", lambda x: f"[{x.group(1).strip() or '…'}]", t)   # filled in per contract
    return re.sub(r"[ \t]+", " ", t.replace("\\n", "\n")).strip()


def page_summary(m):
    """summarize() plus what the mission's own page in Quantum shows."""
    m = m or {}
    out = summarize(m)
    bp_items = []
    for pool in m.get("blueprints") or []:
        if not isinstance(pool, dict):
            continue
        for i in pool.get("items") or []:
            if isinstance(i, dict) and i.get("name"):
                bp_items.append({"name": i["name"], "uuid": i.get("uuid"), "chance": pool.get("drop_chance")})
    cd = m.get("cooldown") or {}
    out.update({
        "uuid": m.get("uuid"), "description": _clean_text(m.get("description"))[:2500] or None,
        "systems": m.get("star_systems") or [], "once_only": bool(m.get("once_only")),
        "cooldown": cd.get("label") if isinstance(cd, dict) else None,
        "prison": bool(m.get("available_in_prison")),
        "blueprint_items": bp_items[:30],
        "needs_first": _chain(m.get("prerequisite_groups")),
        "leads_to": _chain(m.get("unlock_groups")),
        "pickups": _places(((m.get("merged_locations") or {}).get("Locations"))),
    })
    return out
