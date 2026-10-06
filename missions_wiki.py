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
import urllib.parse
import urllib.request
from pathlib import Path

API = "https://api.star-citizen.wiki/api/missions"
UA = {"User-Agent": "Quantum (Star Citizen route planner; github.com/Sammmy1036/Quantum)"}
HIT_TTL, MISS_TTL = 7 * 86400, 86400
MAX_PLACES = 12                                   # per group; some missions list dozens


def _get(url, timeout=20):
    with urllib.request.urlopen(urllib.request.Request(url, headers=UA), timeout=timeout) as r:
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
    def lookup(self, code, name, system=None):
        """Summary of the wiki's mission for a contract, or None if the wiki doesn't have it.
        Raises OSError-like errors only when the wiki can't be reached (nothing is cached then)."""
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
