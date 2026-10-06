"""Star Citizen Wiki data for the UEX tabs and My Fleet (api.star-citizen.wiki and starcitizen.tools,
community-maintained; please credit them).

- pictures(): each page's main image, many at once (one request per 50 titles), cached on disk.
- loadout(): a ship's swappable slots (power plants, coolers, shields, quantum drive, radar, guns,
  missiles, mining lasers) with the stock component in each, plus its headline stats. From the wiki's
  vehicle API, cached for a week (it only changes with patches).
"""
import json
import re
import time
import urllib.parse
import urllib.request
from pathlib import Path

UA = {"User-Agent": "Quantum (Star Citizen route planner; github.com/Sammmy1036/Quantum)"}
PAGES_API = "https://starcitizen.tools/api.php"
VEHICLE_API = "https://api.star-citizen.wiki/api/v3/vehicles/"

# Slot types a player can swap, how they're labelled, and the UEX item category that fills them.
SLOT_TYPES = {
    "PowerPlant": ("Power plant", ("power plant",)),
    "Cooler": ("Cooler", ("cooler",)),
    "Shield": ("Shield", ("shield generator", "shield")),
    "QuantumDrive": ("Quantum drive", ("quantum drive",)),
    "Radar": ("Radar", ("radar",)),
    "WeaponGun": ("Gun", ("gun", "weapon")),
    "Missile": ("Missile", ("missile",)),
    "WeaponMining": ("Mining laser", ("mining laser",)),
}
ORDER = list(SLOT_TYPES)
# Parts that aren't swapped but use power: Erkul's "thrusters" bar is the flight controller.
FIXED_TYPES = {"FlightController": "Flight controller", "LifeSupportGenerator": "Life support"}
# The number that ranks components of each kind ("best" first)
KEY_STAT = {"WeaponGun": "dps", "Missile": "missile", "Shield": "shield_hp", "QuantumDrive": "qt_speed",
            "Cooler": "cooling", "PowerPlant": "power"}


def _get(url, timeout=20):
    with urllib.request.urlopen(urllib.request.Request(url, headers=UA), timeout=timeout) as r:
        return json.loads(r.read().decode("utf-8"))


def title_of(ref):
    """A wiki URL or a plain name -> page title."""
    return urllib.parse.unquote(str(ref or "").rstrip("/").rsplit("/", 1)[-1]).replace("_", " ").strip()


class Wiki:
    def __init__(self, cache_dir):
        self.dir = Path(cache_dir)
        self._pics = None

    # ------------------------------------------------------------ pictures
    def _pic_cache(self):
        if self._pics is None:
            try:
                self._pics = json.loads((self.dir / "wiki_images.json").read_text(encoding="utf-8"))
            except Exception:
                self._pics = {}
        return self._pics

    def pictures(self, refs):
        """{ref: image url or None} for many pages, fetching only the ones not cached yet."""
        cache = self._pic_cache()
        titles = {ref: title_of(ref) for ref in refs if ref}
        todo = sorted({t for t in titles.values() if t and t not in cache})
        for i in range(0, len(todo), 50):
            batch = todo[i:i + 50]
            q = urllib.parse.urlencode({"action": "query", "format": "json", "prop": "pageimages",
                                        "piprop": "thumbnail", "pithumbsize": 480, "redirects": 1,
                                        "titles": "|".join(batch)})
            try:
                data = _get(f"{PAGES_API}?{q}").get("query", {})
            except Exception:
                break                                       # offline: try again next time
            alias = {}
            for key in ("normalized", "redirects"):
                for m in data.get(key, []):
                    alias[m["from"]] = m["to"]
            found = {p.get("title"): p.get("thumbnail", {}).get("source", "")
                     for p in data.get("pages", {}).values()}
            for t in batch:
                final = t
                for _ in range(3):
                    final = alias.get(final, final)
                cache[t] = found.get(final, "")
        if todo:
            self.dir.mkdir(exist_ok=True)
            (self.dir / "wiki_images.json").write_text(json.dumps(cache), encoding="utf-8")
        return {ref: (cache.get(t) or None) for ref, t in titles.items()}

    # ------------------------------------------------------------ descriptions
    def summary(self, ref):
        """The opening paragraph(s) of a Star Citizen Wiki page, as plain text (cached a week).
        Uses the TextExtracts API; if the wiki doesn't offer it, the page's first section with
        the markup stripped."""
        title = title_of(ref)
        if not title:
            return None
        f = self.dir / "wiki_text.json"
        try:
            cache = json.loads(f.read_text(encoding="utf-8"))
        except Exception:
            cache = {}
        hit = cache.get(title)
        if hit and time.time() - hit.get("at", 0) < 7 * 86400:
            return hit.get("text") or None
        text = None
        try:
            q = urllib.parse.urlencode({"action": "query", "format": "json", "prop": "extracts", "exintro": 1,
                                        "explaintext": 1, "redirects": 1, "titles": title})
            pages = _get(f"{PAGES_API}?{q}").get("query", {}).get("pages", {})
            text = next((p.get("extract") for p in pages.values() if p.get("extract")), None)
            if not text:
                q = urllib.parse.urlencode({"action": "parse", "format": "json", "prop": "text", "section": 0,
                                            "redirects": 1, "disabletoc": 1, "page": title})
                html = _get(f"{PAGES_API}?{q}").get("parse", {}).get("text", {}).get("*", "")
                paras = re.findall(r"<p>(.*?)</p>", html, re.S)
                text = "\n\n".join(t for t in (re.sub(r"\s+", " ", re.sub(r"<[^>]+>|\[\d+\]", "", p)).strip()
                                                 for p in paras) if len(t) > 40)
        except Exception:
            return hit.get("text") if hit else None             # offline: whatever we had
        import html as _h
        text = _h.unescape(text or "").strip()
        text = re.sub(r"\n{3,}", "\n\n", text)[:1500] or None
        cache[title] = {"text": text, "at": int(time.time())}
        self.dir.mkdir(exist_ok=True)
        f.write_text(json.dumps(cache), encoding="utf-8")
        return text

    # ------------------------------------------------------------ items
    def item(self, uuid=None, name=None):
        """One component's full record (stats), by Star Citizen uuid, else by name. Cached for a week."""
        for key, url in ((uuid, f"https://api.star-citizen.wiki/api/items/{uuid}"),
                         (name, "https://api.star-citizen.wiki/api/items?" + urllib.parse.urlencode({"filter[name]": name or ""}))):
            if not key:
                continue
            f = self.dir / f"wiki_item2_{re.sub(r'[^A-Za-z0-9_-]+', '_', str(key))[:80]}.json"
            if f.exists() and time.time() - f.stat().st_mtime < 7 * 86400:
                try:
                    return json.loads(f.read_text(encoding="utf-8"))
                except Exception:
                    pass
            try:
                data = _get(url).get("data")
            except Exception:
                continue
            if isinstance(data, list):
                # Only an exact name match: taking the first result gave some components another
                # item's numbers.
                data = next((d for d in data if (d.get("name") or "").lower() == (name or "").lower()), None)
            if data:
                self.dir.mkdir(exist_ok=True)
                f.write_text(json.dumps(data), encoding="utf-8")
                return data
        return None

    # ------------------------------------------------------------ ship loadouts
    def vehicle_summary(self, wait=False):
        """{key: {medical_beds, medical_tier, cargo}} for every ship on the wiki, keyed by uuid, name and slug
        (lowercase), from the wiki's vehicle list. Cached a week; when it's missing or old it's fetched in the
        background, and the cached copy is returned meanwhile (wait=True: fetched right away the first time,
        when there's no copy at all)."""
        f = self.dir / "wiki_vehicle_summary.json"
        try:
            cached = json.loads(f.read_text(encoding="utf-8"))
        except Exception:
            cached = None
        stale = cached is None or time.time() - f.stat().st_mtime > 7 * 86400

        def fetch():
            out, page = {}, 1
            while page <= 30:
                try:
                    # both paging styles: the API's own (page, limit) and JSON:API's (page[number], page[size])
                    rows = _get(VEHICLE_API.rstrip("/") + f"?page={page}&limit=100&page%5Bsize%5D=100&page%5Bnumber%5D={page}",
                                timeout=60).get("data") or []
                except Exception:
                    return                                   # offline: keep what's cached
                before = len(out)
                for d in rows:
                    beds = (d.get("seating") or {}).get("medical_beds")
                    n = sum(v for v in beds.values() if isinstance(v, (int, float))) if isinstance(beds, dict) \
                        else beds if isinstance(beds, (int, float)) else 0
                    rec = {"medical_beds": n, "medical_tier": d.get("max_medical_tier"), "cargo": d.get("cargo_capacity") or 0}
                    for k in (d.get("uuid"), d.get("name"), d.get("slug"), d.get("shipmatrix_name")):
                        if k:
                            out[str(k).lower()] = rec
                if not rows or len(out) == before:          # paging ignored (same page again) or done
                    break
                page += 1
            if out:
                self.dir.mkdir(exist_ok=True)
                f.write_text(json.dumps(out), encoding="utf-8")
                self._summary = out
        if stale and not getattr(self, "_summary_busy", False):
            if wait and cached is None:                       # nothing at all yet: worth the one-time wait
                fetch()
            else:
                self._summary_busy = True
                import threading

                def bg():
                    try:
                        fetch()
                    finally:
                        self._summary_busy = False
                threading.Thread(target=bg, daemon=True).start()
        return getattr(self, "_summary", None) or cached or {}

    def vehicle(self, keys):
        """The wiki's record for a ship, trying each identifier (uuid, name, slug) in turn."""
        for key in [k for k in keys if k]:
            f = self.dir / f"wiki_vehicle_{re.sub(r'[^A-Za-z0-9_-]+', '_', str(key))[:80]}.json"
            if f.exists() and time.time() - f.stat().st_mtime < 7 * 86400:
                try:
                    return json.loads(f.read_text(encoding="utf-8"))
                except Exception:
                    pass
            try:
                data = _get(VEHICLE_API + urllib.parse.quote(str(key)) + "?include=ports", timeout=30).get("data")
            except Exception:
                continue
            if data:
                self.dir.mkdir(exist_ok=True)
                f.write_text(json.dumps(data), encoding="utf-8")
                return data
        return None

    @staticmethod
    def loadout(v):
        """Swappable slots with their stock items, and headline stats, from a wiki vehicle record."""
        slots = []

        def item_info(it):
            it = it or {}
            name = it.get("name") or ""
            return None if not name or "PLACEHOLDER" in name else {
                "name": name, "grade": it.get("grade"), "class": it.get("class"), "size": it.get("size"),
                "maker": (it.get("manufacturer") or {}).get("name"), "uuid": it.get("uuid"),
                "stats": item_stats(it)}

        def walk(ports, path, under=""):
            for p in ports or []:
                typ = p.get("type") or ""
                here = f"{path}/{p.get('name')}" if path else p.get("name")
                kids = p.get("ports") or []
                eq = p.get("equipped_item") or {}
                kind = typ or (eq.get("type") or "")
                if kind in FIXED_TYPES or re.search(r"lifesupport|controller_flight", f"{p.get('name')} {eq.get('class_name') or ''}", re.I):
                    kind = kind if kind in FIXED_TYPES else ("LifeSupportGenerator" if "life" in (p.get("name") or "").lower()
                                                            else "FlightController")
                    fixed.append({"port": here, "type": kind, "label": FIXED_TYPES[kind], "size": eq.get("size"),
                                  "where": "", "fixed": True, "stock": item_info(eq) or {"name": FIXED_TYPES[kind]}})
                    continue
                if typ in SLOT_TYPES and (p.get("editable") or typ in ("Missile", "WeaponGun")):
                    size = (p.get("sizes") or {}).get("max") or (p.get("equipped_item") or {}).get("size")
                    slots.append({"port": here, "type": typ, "label": SLOT_TYPES[typ][0], "size": size,
                                  "where": under, "stock": item_info(p.get("equipped_item"))})
                    continue                                # a gun's barrel etc. aren't separate slots
                if kids:
                    walk(kids, here, under or (p.get("category_label") or ""))

        fixed = []
        walk(v.get("ports"), "")
        slots.sort(key=lambda s: (ORDER.index(s["type"]), -(s["size"] or 0), s["port"]))
        sp, q, sh, w = v.get("speed") or {}, v.get("quantum") or {}, v.get("shield") or {}, v.get("weaponry") or {}
        sig = v.get("signature") or {}
        stats = {"scm": sp.get("scm"), "max": sp.get("max"), "dps": w.get("pilot_dps"),
                 "shield_regen": sh.get("regeneration"),
                 "missile_dmg": w.get("total_missile_damage"), "shield": sh.get("hp") or v.get("shield_hp"),
                 "hull": v.get("health"), "qt_speed": q.get("quantum_speed"), "qt_range": q.get("quantum_range"),
                 "ir": sig.get("ir_shields") or (v.get("emission") or {}).get("ir"),
                 "em": sig.get("em_shields") or (v.get("emission") or {}).get("em_idle"),
                 "cs": v.get("cross_section_max"), "cargo": v.get("cargo_capacity"),
                 "crew": (v.get("crew") or {}).get("min")}
        return {"name": v.get("game_name") or v.get("name"), "slots": slots, "fixed": fixed, "stats": stats,
                "armor": armor_signal(v)}


def armor_signal(v):
    """The hull armor's signature multipliers from a wiki vehicle record: {"em": x, "ir": y}, 1.0 where
    missing. Stealth hulls are below 1 (less EM/IR), heavy armor above. The game multiplies the ship's
    EM and IR by these after adding up its parts, the same as ScDataDumper's EmissionAggregator."""
    a = (v or {}).get("armor") or {}
    sm = a.get("signal_multiplier") or a.get("signal_multipliers") or {}

    def pick(new, old):
        x = sm.get(new) if isinstance(sm, dict) else None
        x = a.get(old) if x is None else x
        return float(x) if isinstance(x, (int, float)) and x > 0 else 1.0
    return {"em": pick("electromagnetic", "signal_electromagnetic"), "ir": pick("infrared", "signal_infrared")}


# Apply the hull armor's EM/IR multipliers to the estimate. Erkul applies them too; if a ship you
# calibrated against Erkul drifts after this, set it to False and compare.
APPLY_ARMOR_SIGNAL = True


def _dig(d, *path):
    for k in path:
        if not isinstance(d, dict):
            return None
        d = d.get(k)
    return d


def item_stats(it):
    """The numbers that matter for a component, from a wiki item record (field names from the wiki API)."""
    it = it or {}
    vw = it.get("vehicle_weapon") or {}
    dmg = vw.get("damage") or {}
    modes = vw.get("modes") or [{}]
    out = {
        "dps": dmg.get("burst") or (modes[0] or {}).get("damage_per_second"),
        "sustained": dmg.get("sustained_60s"),
        "alpha": dmg.get("alpha_total"),
        "range": vw.get("range"),
        "missile": _dig(it, "missile", "damage_total"),
        "shield_hp": _dig(it, "shield", "max_health"),
        "shield_regen": _dig(it, "shield", "regen_rate"),
        "qt_speed": _dig(it, "quantum_drive", "standard_jump", "drive_speed") or _dig(it, "quantum_drive", "drive_speed"),
        "qt_spool": _dig(it, "quantum_drive", "standard_jump", "spool_up_time"),
        "cooling": _dig(it, "cooler", "coolant_segment_generation"),
        "power": _dig(it, "resource_network", "generation", "power"),
        "em": _dig(it, "emission", "em_max"),
        "ir": _dig(it, "emission", "ir"),
    }
    return {k: v for k, v in out.items() if isinstance(v, (int, float)) and v}


# Ship stats that follow from components: (ship stat, item stat, how it combines)
SHIP_FROM_ITEMS = [("dps", "dps", "sum"), ("missile_dmg", "missile", "sum"), ("shield", "shield_hp", "sum"),
                   ("shield_regen", "shield_regen", "sum"), ("qt_speed", "qt_speed", "max")]
# EM/IR are handled separately in apply_swaps (scaled from the ship's own stock signature).


def apply_swaps(stats, slots):
    """Ship stats with your swaps: for each swapped slot, the stock component's number is taken out and
    the fitted one's put in. A number either side doesn't have is left alone rather than counted as zero
    (that turned a missing EM reading into "EM 0"). Quantum speed is the drive's own.
    Returns (new stats, {stat: change})."""
    new, delta = dict(stats), {}
    for ship_k, item_k, how in SHIP_FROM_ITEMS:
        d, best_now, any_change = 0, None, False
        for sl in slots:
            stock_v = ((sl.get("stock") or {}).get("stats") or {}).get(item_k)
            if sl.get("fitted"):
                now_v = (sl.get("fitted_stats") or {}).get(item_k)
                if stock_v is not None and now_v is not None:
                    d += now_v - stock_v
                    any_change = True
                elif stock_v is None and now_v is not None and how == "sum":
                    d += now_v                       # slot was empty in stock
                    any_change = True
            else:
                now_v = stock_v
            if now_v is not None:
                best_now = now_v if best_now is None else max(best_now, now_v)
        if not any_change or not d:
            continue
        if how == "max":
            d = (best_now or 0) - (new.get(ship_k) or 0)
            new[ship_k] = best_now
        else:
            new[ship_k] = max(0, (new.get(ship_k) or 0) + d)
        if d:
            delta[ship_k] = d
    return new, delta


class GameData:
    """Component numbers from the game files (component_stats.json, made by build_component_stats.py),
    by game UUID, with a name+size fallback. Preferred over the wiki for anything it has."""
    def __init__(self, *paths):
        self.items, self.generated = {}, None
        for path in paths:
            try:
                raw = json.loads(Path(path).read_text(encoding="utf-8"))
            except Exception:
                continue
            self.items, self.generated = raw.get("items", {}), raw.get("generated")
            break
        self.by_name = {}
        for uid, it in self.items.items():
            self.by_name.setdefault(((it.get("name") or "").lower().strip(), it.get("size")), uid)
            self.by_name.setdefault(((it.get("name") or "").lower().strip(), None), uid)

    def find(self, uuid=None, name=None, size=None):
        if uuid and uuid in self.items:
            return dict(self.items[uuid], uuid=uuid)
        key = (str(name or "").lower().strip(), size)
        uid = self.by_name.get(key) or self.by_name.get((key[0], None))
        return dict(self.items[uid], uuid=uid) if uid else None

    def stats(self, uuid=None, name=None, size=None):
        """A part's numbers, with its power data (power_use, power_min, priority, coolant_make) when known."""
        it = self.find(uuid, name, size)
        if not it:
            return None
        out = dict(it["stats"])
        for k, v in (it.get("power") or {}).items():
            if k in ("power_use", "power_min", "priority", "coolant_make", "power_make"):
                out[k] = v
        return out

    def of_kind(self, slot_type, size, ground=False):
        """Every component of a slot's kind and size. Ground-vehicle missiles only for ground vehicles,
        and only those for them."""
        return [dict(it, uuid=uid) for uid, it in self.items.items()
                if it.get("type") == slot_type and (not size or it.get("size") == size)
                and (slot_type != "Missile" or bool(it.get("ground")) == bool(ground))]


# Cooling demand per pip in use. Not in the game files (parts' coolant use is 0 there); fitted to
# Erkul readings of an Intrepid and a Cutlass Red: at full power both need ~1.46 cooling/s per pip.
COOLANT_PER_PIP = 1.46
COOLANT_BASE = 0.0
WEAPONS = "weapons"                                   # the ship's weapon power pool (one bar, like Erkul)
# Order Erkul's Auto tops parts up in, after everyone has their minimum. Coolers are switched on only
# as many as the cooling needs. Matches Erkul on the Intrepid and the Cutlass Red.
FILL_ORDER = ["weapons", "Shield", "Radar", "QuantumDrive", "FlightController", "LifeSupportGenerator"]


def _pstats(sl, fitted=True):
    return (sl.get("fitted_stats") if fitted and sl.get("fitted") else (sl.get("stock") or {}).get("stats")) or {}


def part_max_pips(sl, fitted=True):
    """Most pips a part takes: its power use from the game files (radar 5, quantum drive 2…), at least 1."""
    st = _pstats(sl, fitted)
    return max(1, int(round(st.get("power_use") or st.get("power_draw") or 1)))


def part_min_pips(sl, fitted=True):
    """Fewest pips it runs on: power use x its minimum fraction (Aspis 4 x 0.75 = 3), at least 1."""
    st = _pstats(sl, fitted)
    mx = part_max_pips(sl, fitted)
    frac = st.get("power_min")
    return mx if frac is None else max(1, min(mx, int(-(-round(mx * frac, 6) // 1))))


def weapon_pool(slots, fitted=True):
    """The guns share one power pool: its size is their power use added up and rounded up (four guns
    on a Cutlass Red, 0.1+0.1+1+1 = 3 pips; the Intrepid's one Deadbolt, 1 pip)."""
    guns = [sl for sl in slots if sl.get("type") == "WeaponGun"]
    if not guns:
        return 0
    total = sum((_pstats(sl, fitted).get("power_use") or _pstats(sl, fitted).get("power_draw") or 0) for sl in guns)
    return max(1, int(-(-round(total, 6) // 1)))


def _wanted(t, mode):
    if t in ("Missile", "PowerPlant", "WeaponGun"):
        return False
    return not ((mode == "nav" and t in (WEAPONS, "Shield")) or (mode != "nav" and t == "QuantumDrive"))


def allocate(parts, gen, mode, overrides, fitted=True, pool=0):
    """Erkul-style Auto. Every part the mode uses gets its minimum; coolers are switched on one at a
    time until they cover the cooling needed; then what's left tops parts up in FILL_ORDER. Pips you've
    set on a part are kept. parts: slots + fixed parts (+ the weapon pool as port "weapons")."""
    info = {}
    for sl in parts:
        t = sl.get("type")
        if sl.get("port") == WEAPONS:
            info[WEAPONS] = {"t": WEAPONS, "max": pool, "min": 1, "sl": sl}
        elif t not in ("Missile", "PowerPlant", "WeaponGun"):
            info[sl["port"]] = {"t": t, "max": part_max_pips(sl, fitted), "min": part_min_pips(sl, fitted), "sl": sl}
    alloc, free = {}, gen
    # Pips you set are kept, except on systems the flight mode switches off, as in the game: in SCM the
    # quantum drive takes no power; in NAV the weapons and shields take none.
    off = {p for p, i in info.items() if i["t"] != "Cooler" and not _wanted(i["t"], mode)}
    for port, i in info.items():
        if port in overrides and port not in off:
            alloc[port] = max(0, min(i["max"], int(overrides[port])))
            free -= alloc[port]
    for port in off:
        alloc[port] = 0
    auto = {p: i for p, i in info.items() if p not in overrides and p not in off}
    users = [p for p, i in auto.items() if i["t"] != "Cooler" and _wanted(i["t"], mode)]
    for p in users:                                             # minimums
        alloc[p] = min(auto[p]["min"], max(0, free))
        free -= alloc[p]
    coolers = [p for p, i in auto.items() if i["t"] == "Cooler"]
    for p in coolers:
        alloc[p] = 0
    made_by_hand = sum(_pstats(info[p]["sl"], fitted).get("coolant_make") or 0
                       for p in info if p in overrides and info[p]["t"] == "Cooler" and alloc.get(p))
    for p in sorted(coolers, key=lambda p: -(_pstats(auto[p]["sl"], fitted).get("coolant_make") or 0)):
        in_use = sum(alloc.values())
        made = made_by_hand + sum(_pstats(auto[c]["sl"], fitted).get("coolant_make") or 0 for c in coolers if alloc[c])
        # cooling needed once this pass is done: everything at full, roughly the pips the plant makes
        need = COOLANT_BASE + COOLANT_PER_PIP * min(gen, max(in_use, gen))
        if made >= need and made > 0:
            break
        alloc[p] = min(auto[p]["max"], max(0, free))
        free -= alloc[p]
    for typ in FILL_ORDER:                                      # top up
        for p in users:
            if auto[p]["t"] == typ:
                extra = min(auto[p]["max"] - alloc[p], max(0, free))
                alloc[p] += extra
                free -= extra
    for p in info:
        alloc.setdefault(p, 0)
    return alloc, info


def signatures(slots, fitted=True, pips=None, mode="scm", cooling=None, parts=None, fixed=None, armor=None):
    """Ship EM and IR, estimated the way Erkul's Power Management works them out:
      pips: Erkul-style Auto (allocate) or your own, from the power plants' output
      EM = power plant EM x (pips in use / pips made) + each part's EM x (its pips / its most pips);
           the guns share one weapon pool (their EM x pool pips / pool size)
      IR = IR of the coolers switched on x cooling in use
      cooling in use = pips in use x COOLANT_PER_PIP / output of the coolers switched on (unless typed)
    Life support takes its pips; its EM isn't added (Erkul's readings fit better without it).
    Both totals are then multiplied by the hull armor's signal multipliers (armor_signal), if given.
    Returns totals and each part's pips."""
    overrides = parts or {}
    every = list(slots) + list(fixed or [])
    gen = sum(_pstats(sl, fitted).get("power") or _pstats(sl, fitted).get("power_make") or 0
              for sl in slots if sl.get("type") == "PowerPlant")
    pool = weapon_pool(slots, fitted)
    consumers = [sl for sl in every if sl.get("type") not in ("Missile", "PowerPlant", "WeaponGun")]
    if pool:
        consumers.append({"port": WEAPONS, "type": WEAPONS})
    alloc, info = allocate(consumers, gen, mode, overrides, fitted, pool)
    used = min(gen, sum(alloc.values()))
    share = (used / gen) if gen else 1
    on_coolers = [sl for sl in slots if sl.get("type") == "Cooler" and alloc.get(sl.get("port"))]
    cool_make = sum(_pstats(sl, fitted).get("coolant_make") or 0 for sl in on_coolers)
    auto_cool = cooling is None
    if auto_cool:
        cooling = min(100, round((COOLANT_BASE + used * COOLANT_PER_PIP) / cool_make * 100)) if cool_make else 100
    em = ir = 0.0
    per = {p: {"pips": alloc.get(p, 0), "max": i["max"], "min": i["min"], "auto": p not in overrides}
           for p, i in info.items()}
    for sl in every:
        st, t = _pstats(sl, fitted), sl.get("type")
        if t == "Missile":
            continue
        if t == "PowerPlant":
            em += (st.get("em") or 0) * share
        elif t == "WeaponGun":
            em += (st.get("em") or 0) * (alloc.get(WEAPONS, 0) / pool if pool else 0)
        elif t != "LifeSupportGenerator":
            p = sl.get("port")
            em += (st.get("em") or 0) * alloc.get(p, 0) / max(1, info.get(p, {}).get("max", 1))
            if t == "Cooler" and alloc.get(p):
                ir += (st.get("ir") or 0) * max(0, min(100, cooling)) / 100
    if APPLY_ARMOR_SIGNAL and armor:
        em *= armor.get("em", 1.0)
        ir *= armor.get("ir", 1.0)
    return {"em": em, "ir": ir, "pips_gen": gen, "pips_used": used, "parts": per,
            "cooling": cooling, "cooling_auto": auto_cool, "cool_make": cool_make, "pool": pool}
