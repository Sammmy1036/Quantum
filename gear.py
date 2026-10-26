"""Personal gear and crafting from the Star Citizen Wiki API (api.star-citizen.wiki, community-maintained;
please credit it): personal (FPS) weapons, armor, gadgets, clothing, consumables, utility items and
blueprints, for the tabs of the same names.

Each kind is fetched page by page, trimmed to what the tabs show and cached on disk for a day (an older
copy is used when the wiki can't be reached). A blueprint's unlocking missions only come with its own
record, which is fetched when you open it and cached for a week.
"""
import json
import re
import time
import urllib.parse
import urllib.request
from pathlib import Path

UA = {"User-Agent": "Quantum (Star Citizen route planner; github.com/Sammmy1036/Quantum)", "Accept": "application/json"}
API = "https://api.star-citizen.wiki/api"
DAY = 86400

# What each tab lists: (API path, filter). Armor is every wearable piece; sets are put together from names.
ARMOR_TYPES = ("Char_Armor_Helmet", "Char_Armor_Torso", "Char_Armor_Arms", "Char_Armor_Legs",
               "Char_Armor_Backpack", "Char_Armor_Undersuit")
# A kind can take more than one query (the wiki's classification filter matches one pattern at a time):
# their results are put together, each item once.
KINDS = {
    "weapons": [("items", {"filter[type]": "WeaponPersonal"})],
    "armor": [("items", {"filter[type]": ",".join(ARMOR_TYPES)})],
    "blueprints": [("blueprints", {})],
    # What the Star Citizen Wiki files under Gadgets: multi-tools, tractor beams, rangefinders, the Cambio
    # SRT, extinguishers, glow sticks… (personal weapons of the Gadget kind) and the mining gadgets.
    # Multi-tool attachments (cutter, tractor beam, healing, mining) are gadgets too
    "gadgets": [("items", {"filter[classification]": "FPS.Weapon.Gadget"}), ("items", {"filter[type]": "Gadget"}),
                ("items", {"filter[classification]": "FPS.WeaponAttachment.Utility"})],
    "clothing": [("items", {"filter[classification]": "FPS.Clothing"})],
    # Food, drinks and medical items (MedPens, OxyPens…)
    "consumables": [("items", {"filter[type]": "Food,Bottle,Drink"}), ("items", {"filter[classification]": "FPS.Consumable"})],
    # The Keys tab (kept as "utility" inside): hacking chips, cryptokeys and keycards
    "utility": [("items", {"filter[sub_type]": "Hacking"}), ("items", {"filter[name]": "cryptokey"}),
                ("items", {"filter[name]": "keycard"}), ("items", {"filter[name]": "key card"})],
}
# The newer tabs (Gadgets, Clothing, Consumables, Utility) share one way of trimming an item
ITEM_KINDS = ("gadgets", "clothing", "consumables", "utility")
SLOT_OF_TYPE = {"Char_Armor_Helmet": "Helmet", "Char_Armor_Torso": "Core", "Char_Armor_Arms": "Arms",
                "Char_Armor_Legs": "Legs", "Char_Armor_Backpack": "Backpack", "Char_Armor_Undersuit": "Undersuit"}
SLOT_ORDER = ["Helmet", "Core", "Arms", "Legs", "Backpack", "Undersuit"]
# Words that name the piece rather than the set ("ADP Core Woodland" is the Core of the ADP Woodland set)
SLOT_WORDS = {"helmet", "helm", "core", "torso", "chest", "arms", "arm", "legs", "leg", "backpack", "pack",
              "undersuit", "suit", "armor", "armour"}
JUNK = re.compile(r"(?i)\b(test|template|placeholder|dummy)\b|_ai_|_npc|\[PH\]|PLACEHOLDER")


def _get(url, timeout=30):
    req = urllib.request.Request(url, headers=UA)
    with urllib.request.urlopen(req, timeout=timeout) as r:
        return json.loads(r.read().decode("utf-8"))


def _en(d):
    if isinstance(d, dict):
        return d.get("en_EN") or d.get("en") or next((v for v in d.values() if isinstance(v, str) and v), None)
    return d if isinstance(d, str) else None


def _num(v):
    return v if isinstance(v, (int, float)) and not isinstance(v, bool) else None


def _maker(d):
    m = d.get("manufacturer")
    return ((m.get("name") if isinstance(m, dict) else m) or d.get("manufacturer_description") or "").strip()


def _maker_code(d):
    m = d.get("manufacturer")
    c = (m.get("code") if isinstance(m, dict) else None) or ""
    return c.strip() if c.strip().upper() not in ("", "UNKN", "UNKNOWN") else None


def _prices(d):
    """The wiki's copy of UEX's shop prices: [{terminal_id, terminal, price, updated, where, system}]."""
    up = d.get("uex_prices")
    rows = (up.get("purchase") or []) if isinstance(up, dict) else []
    out = []
    for p in rows:
        if not isinstance(p, dict) or not _num(p.get("price_buy")):
            continue
        loc = p.get("starmap_location") or {}
        out.append({"terminal_id": p.get("terminal_id"), "terminal": p.get("terminal_name"), "price": p["price_buy"],
                    "updated": p.get("date_updated"), "where": loc.get("name") if isinstance(loc, dict) else None,
                    "system": loc.get("star_system_name") if isinstance(loc, dict) else None})
    out.sort(key=lambda x: x["price"])
    return out


def _image(d):
    imgs = d.get("images") or []
    return imgs[0].get("url") if imgs and isinstance(imgs[0], dict) else None


def _desc_data(d):
    """{"damage reduction": "40%", ...} from the wiki's description_data rows."""
    out = {}
    for r in d.get("description_data") or []:
        if isinstance(r, dict) and r.get("name"):
            out[str(r["name"]).strip().lower()] = r.get("value")
    return out


def _pct(v):
    m = re.search(r"(-?\d+(?:\.\d+)?)\s*%", str(v or ""))
    return float(m.group(1)) if m else None


def _common(d):
    return {"uuid": d.get("uuid"), "name": (d.get("name") or "").strip(), "class_name": d.get("class_name") or "",
            "maker": _maker(d), "maker_code": _maker_code(d), "size": d.get("size"), "mass": _num(d.get("mass")), "rarity": d.get("rarity"),
            "base": bool(d.get("is_base_variant")), "craftable": bool(d.get("is_craftable")),
            "lootable": bool(d.get("is_lootable")), "desc": _en(d.get("description")), "image": _image(d),
            "web_url": d.get("web_url"), "prices": _prices(d)}


def trim_weapon(d):
    """A personal weapon: what it is (rifle, pistol…, ballistic or energy) and how it shoots."""
    pw = d.get("personal_weapon") or {}
    dmg = pw.get("damage") or {}
    ammo = pw.get("ammunition") or d.get("ammunition") or {}
    dtypes = [x.get("name") for x in pw.get("damages") or [] if isinstance(x, dict) and x.get("name")]
    modes = [m.get("localised") or m.get("mode") for m in pw.get("modes") or [] if isinstance(m, dict)]
    kind = (pw.get("type") or d.get("sub_type_label") or d.get("sub_type") or "Other").strip()
    out = _common(d)
    out.update({"kind": kind, "cls": (pw.get("class") or "").strip() or None,
                "weight": d.get("sub_type_label") or d.get("sub_type"),
                "stats": {k: v for k, v in {
                    "dps": _num(dmg.get("dps_total")), "alpha": _num(dmg.get("alpha_total") or pw.get("damage_per_shot")),
                    "rpm": _num(pw.get("rpm") or pw.get("rof")), "mag": _num(pw.get("magazine_size") or pw.get("capacity")),
                    "range": _num(pw.get("effective_range") or pw.get("range")), "speed": _num(ammo.get("speed")),
                    "pellets": _num(pw.get("pellets_per_shot")) if (pw.get("pellets_per_shot") or 1) > 1 else None,
                    "mass": _num(d.get("mass"))}.items() if v},
                "damage_type": ", ".join(dict.fromkeys(t.title() for t in dtypes)) or None,
                "modes": [m for m in dict.fromkeys(modes) if m]})
    return out


def armor_set_name(name, slot=None):
    """The set a piece belongs to, from its name: "ADP Core Woodland" -> "ADP Woodland"."""
    words = [w for w in re.split(r"\s+", (name or "").strip()) if w]
    keep = [w for w in words if w.lower().strip("()-") not in SLOT_WORDS]
    return " ".join(keep).strip() or (name or "").strip()


def trim_armor(d):
    """An armor piece: slot, weight, protection, temperature range, carrying space, signature."""
    ca = d.get("suit_armor") or d.get("clothing") or {}
    slot = SLOT_OF_TYPE.get(d.get("type")) or ca.get("slot") or ca.get("armor_type") or "Other"
    if slot == "Torso":
        slot = "Core"
    dd = _desc_data(d)
    res = {}
    for r in ca.get("damage_resistance") or []:
        if isinstance(r, dict) and r.get("type") and _num(r.get("multiplier")) is not None:
            res[str(r["type"]).lower()] = r["multiplier"]
    dr = _pct(dd.get("damage reduction"))
    if dr is None and res.get("physical") is not None:
        dr = round((1 - res["physical"]) * 100, 1)
    inv = d.get("inventory") or {}
    carry = _num(inv.get("scu_converted")) or (_num(inv.get("scu")) and inv["scu"] * 1e6)
    rad = d.get("radiation_resistance") or ca.get("radiation_resistance") or {}
    sig = ca.get("signature") or {}
    out = _common(d)
    out.update({"slot": slot, "weight": d.get("sub_type_label") or d.get("sub_type") or None,
                "set": armor_set_name(out["name"], slot),
                "stats": {k: v for k, v in {
                    "dr": dr, "temp_min": _num(ca.get("temp_resistance_min")), "temp_max": _num(ca.get("temp_resistance_max")),
                    "carry": carry, "rad": _num(rad.get("maximum_radiation_capacity")),
                    "rad_rate": _num(rad.get("radiation_dissipation_rate")), "em": _num(sig.get("electromagnetic")),
                    "mass": _num(d.get("mass"))}.items() if v is not None},
                "res": res})
    return out


def trim_blueprint(b):
    """A crafting blueprint: what it makes, what it takes, how long, and how you get it."""
    o = b.get("output") or {}
    ings = []
    for i in b.get("ingredients") or []:
        if isinstance(i, dict) and i.get("name"):
            ings.append({"name": i["name"], "kind": i.get("kind"), "scu": _num(i.get("quantity_scu")),
                         "qty": _num(i.get("quantity")), "uuid": i.get("item_uuid") or i.get("resource_type_uuid")})
    back = [{"name": i["name"], "scu": _num(i.get("quantity_scu")), "qty": _num(i.get("quantity"))}
            for i in b.get("dismantle_returns") or [] if isinstance(i, dict) and i.get("name")]
    grade = o.get("grade")
    letter = {"1": "A", "2": "B", "3": "C", "4": "D"}.get(str(grade)) if grade is not None else None
    return {"uuid": b.get("uuid"), "key": b.get("key"), "name": (b.get("output_name") or o.get("name") or "").strip(),
            "out_uuid": b.get("output_item_uuid") or o.get("uuid"), "out_type": o.get("type"),
            "category": (o.get("type_label") or o.get("type") or "Other").strip(),
            "sub_type": o.get("sub_type") or o.get("subtype"), "grade": letter or (str(grade) if grade else None),
            "time": _num(b.get("craft_time_seconds")), "time_label": b.get("craft_time_label"),
            "default": bool(b.get("is_available_by_default")), "missions": _num(b.get("unlocking_missions_count")) or 0,
            "ingredients": ings, "returns": back, "web_url": b.get("web_url"), "item_url": b.get("output_item_web_url"),
            "version": b.get("game_version")}


def _facts(d):
    """The wiki's description rows ("NDR: 25", "Effects: Hydrating"…) as [[name, value]], minus the ones
    shown elsewhere (maker, item type, size)."""
    out = []
    for r in d.get("description_data") or []:
        if not isinstance(r, dict) or not r.get("name") or r.get("value") in (None, ""):
            continue
        n = str(r["name"]).strip()
        if n.lower() in ("manufacturer", "item type", "type", "size", "class", "grade"):
            continue
        out.append([n, str(r["value"]).strip()])
    return out[:16]


GADGET_KIND = [(r"multi.?tool", "Multi-tool"), (r"tractor beam", "Tractor beam"), (r"rangefinder|monocular|telescope", "Rangefinder"),
               (r"\bsrt\b|repair", "Repair tool"), (r"extinguisher", "Fire extinguisher"), (r"cutting|cutter|torch", "Cutting tool"),
               (r"glow|flare", "Glow stick"), (r"breach|charge|mine\b", "Explosive"), (r"hologram|decoy", "Hologram"),
               (r"quikcade|barricade|cover", "Barricade"), (r"medgun|med gun|paramed|cure", "Medical")]


def _category(kind, d, t):
    name, typ = t["name"].lower(), d.get("type") or ""
    cls = (d.get("classification") or "").lower()
    if kind == "gadgets":
        if "weaponattachment" in cls:
            return "Multi-tool attachment"
        if typ == "Gadget" or cls.startswith("mining."):
            return "Mining gadget"
        return next((lab for rx, lab in GADGET_KIND if re.search(rx, name)), d.get("sub_type_label") or "Other")
    if kind == "clothing":
        return d.get("type_label") or (d.get("clothing") or {}).get("type") or "Other"
    if kind == "consumables":
        if "medical" in cls or isinstance(d.get("medical"), dict):
            return "Medical"
        return {"Food": "Food", "Drink": "Drink", "Bottle": "Drink"}.get(typ) or d.get("type_label") or "Other"
    if kind == "utility":
        if re.search(r"cryptokey", name):
            return "Cryptokey"
        if re.search(r"key ?card", name):
            return "Keycard"
        if d.get("sub_type") == "Hacking" or re.search(r"hack|chip", name):
            return "Hacking chip"
        return d.get("type_label") or "Other"
    return d.get("type_label") or "Other"


def trim_item(d, kind):
    """A gadget, piece of clothing, consumable or utility item: what it is, who makes it, where to buy
    it, and whatever numbers the wiki gives for it."""
    out = _common(d)
    out["kind"] = _category(kind, d, out)
    out["sub"] = d.get("sub_type_label") if d.get("sub_type_label") not in (None, "", "UNDEFINED", "Undefined") else None
    out["type"], out["classification"] = d.get("type"), d.get("classification")
    st = {"mass": _num(d.get("mass"))}
    if kind == "clothing":
        a = trim_armor(d)
        st.update({k: a["stats"].get(k) for k in ("temp_min", "temp_max", "carry", "dr", "rad")})
    inv = d.get("inventory") or {}
    if kind != "clothing" and (_num(inv.get("scu_converted")) or _num(inv.get("scu"))):
        st["carry"] = _num(inv.get("scu_converted")) or inv["scu"] * 1e6
    f = d.get("food") if isinstance(d.get("food"), dict) else {}
    if f:
        st.update({"ndr": _num(f.get("nutritional_density_rating")), "hei": _num(f.get("hydration_efficacy_index"))})
        out["effects"] = [str(e).replace("_", " ").title() for e in (f.get("effects") or []) if e][:8] or None
        out["buffs"] = sorted({str(k).replace("_", " ").title() for k in (f.get("buffs") or {})})[:8] or None
    med = d.get("medical") if isinstance(d.get("medical"), dict) else {}
    if med:
        out["buffs"] = sorted({str(k).replace("_", " ").title() for k in (med.get("combat_buffs") or {})})[:8] or None
    out["stats"] = {k: v for k, v in st.items() if v is not None}
    out["facts"] = _facts(d)
    return out


TRIM = {"weapons": trim_weapon, "armor": trim_armor, "blueprints": trim_blueprint,
        **{k: (lambda d, k=k: trim_item(d, k)) for k in ITEM_KINDS}}


def _skip(kind, d):
    """Entries that belong in another tab: gadgets (multi-tools, tractor beams…) aren't weapons, and the
    utility query's ship things (weapon racks) aren't carried."""
    if kind == "weapons":
        return d.get("sub_type") == "Gadget" or (d.get("classification") or "").startswith("FPS.Weapon.Gadget")
    if kind == "utility":
        cls = d.get("classification") or ""
        return d.get("type") in ("WeaponRack", "Container", "Cargo") or cls.startswith(("Ship.", "Vehicle."))
    return False


def _strip_paint(name):
    """'Pyro RYT "Ghost" Multi-Tool' -> 'Pyro RYT Multi-Tool': the same item in another paint."""
    return re.sub(r"\s+", " ", re.sub(r'\s*["“”][^"“”]+["“”]\s*', " ", name)).strip()


def dedupe(items, kind):
    """One entry per item. The wiki can list the same item more than once (another game version, an
    unbuyable copy): they're merged, keeping the one shops sell and every shop price. In Gadgets, paints of
    an item ('Pyro RYT "Ghost" Multi-Tool') go with it as its paints instead of each being listed."""
    by, out = {}, []
    score = lambda t: (bool(t.get("prices")), bool(t.get("base")), len(t.get("stats") or {}) + len(t.get("facts") or []))
    for t in items:
        k = t["name"].strip().lower()
        a = by.get(k)
        if a is None:
            by[k] = t
            out.append(t)
            continue
        keep, drop = (a, t) if score(a) >= score(t) else (t, a)
        seen = {p.get("terminal_id") for p in keep.get("prices") or []}
        keep["prices"] = (keep.get("prices") or []) + [p for p in drop.get("prices") or [] if p.get("terminal_id") not in seen]
        keep["prices"].sort(key=lambda p: p.get("price") or 0)
        keep["alias_uuids"] = sorted({*(keep.get("alias_uuids") or []), *(drop.get("alias_uuids") or []), drop.get("uuid")} - {None, keep.get("uuid")})
        for f in ("image", "desc", "web_url"):
            keep[f] = keep.get(f) or drop.get(f)
        if keep is not a:
            out[out.index(a)] = keep
            by[k] = keep
    if kind == "gadgets":
        names = {t["name"].strip().lower(): t for t in out}
        rest = []
        for t in out:
            base = _strip_paint(t["name"])
            b = names.get(base.lower()) if base != t["name"] else None
            if b is not None and b is not t:
                b.setdefault("paints", []).append({"name": t["name"], "uuid": t.get("uuid"), "prices": t.get("prices") or []})
                b["alias_uuids"] = sorted({*(b.get("alias_uuids") or []), t.get("uuid")} - {None})
                continue
            rest.append(t)
        out = rest
    return out


class Gear:
    def __init__(self, cache_dir):
        self.dir = Path(cache_dir)

    def _file(self, name):
        return self.dir / f"gear_v3_{re.sub(r'[^A-Za-z0-9_-]+', '_', name)}.json"   # v3: one entry per item, Keys tab

    def items(self, kind, max_pages=60, fresh=False):
        """Every entry of one kind, trimmed: {"items": [...], "at": when fetched, "stale": bool}."""
        f = self._file(kind)
        old = None
        if f.exists():
            try:
                old = json.loads(f.read_text(encoding="utf-8"))
                if not fresh and time.time() - f.stat().st_mtime < DAY:
                    return old
            except Exception:
                old = None
        out, seen = [], set()
        try:
            for path, flt in KINDS[kind]:
                page = 1
                while page <= max_pages:
                    q = dict(flt, **{"page[number]": page, "page[size]": 100})
                    r = _get(f"{API}/{path}?" + urllib.parse.urlencode(q))
                    data = r.get("data") or []
                    for d in data:
                        if not isinstance(d, dict) or _skip(kind, d):
                            continue
                        t = TRIM[kind](d)
                        if not t.get("name") or JUNK.search(f"{t['name']} {t.get('class_name') or t.get('key') or ''}"):
                            continue
                        if t["uuid"] in seen:
                            continue
                        seen.add(t["uuid"])
                        out.append(t)
                    last = (r.get("meta") or {}).get("last_page") or page
                    if not data or page >= last:
                        break
                    page += 1
        except Exception:
            if old is not None:
                return dict(old, stale=True)
            raise
        if kind != "blueprints":
            out = dedupe(out, kind)
        res = {"items": out, "at": time.time(), "stale": False}
        self.dir.mkdir(exist_ok=True)
        f.write_text(json.dumps(res), encoding="utf-8")
        return res

    def commodity_sources(self, name):
        """Where a commodity is mined or harvested, from the wiki's resource data: {name, from, sources,
        web_url}. A refined commodity (Laranite) uses its ore's places, with "from" naming the ore.
        Cached for a week; None when the wiki has no such commodity."""
        f = self._file("cm_" + name.lower())
        if f.exists():
            try:
                old = json.loads(f.read_text(encoding="utf-8"))
                if time.time() - f.stat().st_mtime < (7 * DAY if old else DAY):     # a miss is asked again next day
                    return old
            except Exception:
                pass
        key = re.sub(r"[^a-z0-9]", "", name.lower())
        base = re.sub(r"\s*\((ore|raw|gem|refined)\)\s*$", "", name, flags=re.I).strip()
        rows = _get(f"{API}/commodities?" + urllib.parse.urlencode({"filter[query]": base, "page[size]": 50})).get("data") or []
        norm = lambda r: re.sub(r"[^a-z0-9]", "", str(r.get("display_name") or r.get("name") or "").lower())
        hit = next((r for r in rows if norm(r) == key or re.sub(r"[^a-z0-9]", "", str(r.get("name") or "").lower()) == key), None)
        if not hit:
            hit = next((r for r in rows if norm(r).startswith(re.sub(r"[^a-z0-9]", "", base.lower()))), None)
        out = None
        if hit and hit.get("uuid"):
            c = _get(f"{API}/commodities/{urllib.parse.quote(hit['uuid'])}").get("data") or {}
            src, frm = trim_commodity_sources(c), None
            if not src:                                   # refined: its ore is what's found
                for raw in c.get("raw_versions") or []:
                    if isinstance(raw, dict) and raw.get("uuid"):
                        rc = _get(f"{API}/commodities/{urllib.parse.quote(raw['uuid'])}").get("data") or {}
                        src = trim_commodity_sources(rc)
                        if src:
                            frm = raw.get("name") or rc.get("name")
                            break
            out = {"name": c.get("display_name") or c.get("name") or name, "from": frm, "sources": src,
                   "web_url": c.get("web_url"), "refined": ((c.get("refined_version") or {}).get("name"))}
        self.dir.mkdir(exist_ok=True)
        f.write_text(json.dumps(out), encoding="utf-8")
        return out

    def blueprint(self, uuid):
        """One blueprint's full record: its unlocking missions too. Cached for a week."""
        f = self._file(f"bp2_{uuid}")                 # bp2: unlocks carry the mission's ref (opened in Quantum)
        if f.exists() and time.time() - f.stat().st_mtime < 7 * DAY:
            try:
                return json.loads(f.read_text(encoding="utf-8"))
            except Exception:
                pass
        r = _get(f"{API}/blueprints/{urllib.parse.quote(str(uuid))}").get("data") or {}
        out = trim_blueprint(r)
        out["unlocks"] = [{"title": m.get("title") or m.get("debug_name"), "scope": m.get("reward_scope"),
                           "chance": _num(m.get("chance")), "web_url": m.get("web_url"),
                           "code": m.get("debug_name"), "ref": mission_ref(m.get("web_url"))}
                          for m in r.get("unlocking_missions") or [] if isinstance(m, dict)]
        self.dir.mkdir(exist_ok=True)
        f.write_text(json.dumps(out), encoding="utf-8")
        return out


# Where items no shop sells can be found, as players have reported it (the wiki's data doesn't say where
# loot spawns). Keyed by lower-case name; each is a list of places. Shown under "How to get it" for gear,
# and on the commodity's page when it's a commodity. Add to it as more turn up.
KNOWN_SOURCES = {
    "paramed amalgam medical device": ["PAF sites (Platform Alignment Facilities)", "Distribution Centres",
                                       "QV stations in Nyx"],
}
# Map searches for the places above, so each can be shown on the map in one click
SOURCE_SEARCH = {"PAF sites (Platform Alignment Facilities)": "PAF", "Distribution Centres": "Distribution",
                 "QV stations in Nyx": "QV"}


def known_sources(name):
    """[{text, search}] for an item or commodity players have found somewhere, else []."""
    key = re.sub(r"\s+", " ", str(name or "").strip().lower())
    return [{"text": t, "search": SOURCE_SEARCH.get(t)} for t in KNOWN_SOURCES.get(key, [])]


# How a deposit is gathered, from the wiki's resource group names
METHOD = [(r"^spaceship", "Ship mining"), (r"^groundvehicle", "ROC mining"), (r"^fps", "Hand mining"),
          (r"^(harvest|havest|plant)", "Harvesting"), (r"^salvage", "Salvage")]


def _method(group):
    g = re.sub(r"[^a-z]", "", str(group or "").lower())
    return next((lab for rx, lab in METHOD if re.search(rx, g)), (group or "").replace("_", " ").strip() or None)


def trim_commodity_sources(c):
    """A commodity's record -> where it can be mined or harvested: [{name, display, system, type, parent,
    methods, chance, quality}] (best chance first)."""
    out = []
    for L in c.get("locations") or []:
        if not isinstance(L, dict) or not L.get("name"):
            continue
        methods = sorted({m for m in (_method(r.get("group_name")) for r in L.get("resources") or [] if isinstance(r, dict)) if m})
        out.append({"name": L["name"], "display": L.get("display_name") or L["name"], "system": L.get("system"),
                    "type": L.get("type"), "parent": L.get("parent_name"), "methods": methods,
                    "chance": _num(L.get("relative_probability")) if L.get("relative_probability") else _num(L.get("group_probability")),
                    "quality": [L.get("quality_min"), L.get("quality_max")] if L.get("quality_max") else None,
                    "areas": [a.get("name") if isinstance(a, dict) else str(a) for a in (L.get("areas") or [])][:6]})
    out.sort(key=lambda x: (-(x["chance"] or 0), x["name"]))
    return out


def mission_ref(web_url):
    """The mission's uuid or slug from its wiki address (…/missions/<ref>?version=…), for /api/missions/<ref>."""
    m = re.search(r"/missions/([^/?#]+)", str(web_url or ""))
    return urllib.parse.unquote(m.group(1)) if m else None


def armor_sets(pieces):
    """Pieces grouped into sets: [{"name", "weight", "maker", "pieces": [...in slot order], "slots"}]."""
    sets = {}
    for p in pieces:
        if p["slot"] == "Undersuit":                 # undersuits are their own thing, not part of a set
            continue
        key = p["set"].lower()
        s = sets.setdefault(key, {"name": p["set"], "weight": p.get("weight"), "maker": p.get("maker"), "pieces": []})
        s["pieces"].append(p)
    out = []
    for s in sets.values():
        if len(s["pieces"]) < 2:                     # a lone helmet or backpack isn't a set
            continue
        s["pieces"].sort(key=lambda p: SLOT_ORDER.index(p["slot"]) if p["slot"] in SLOT_ORDER else 9)
        s["slots"] = [p["slot"] for p in s["pieces"]]
        out.append(s)
    out.sort(key=lambda s: s["name"].lower())
    return out
