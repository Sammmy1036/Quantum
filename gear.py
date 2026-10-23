"""Personal gear and crafting from the Star Citizen Wiki API (api.star-citizen.wiki, community-maintained;
please credit it): personal (FPS) weapons, armor and blueprints, for Quantum's Weapons, Armor and
Blueprints tabs.

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
KINDS = {
    "weapons": ("items", {"filter[type]": "WeaponPersonal"}),
    "armor": ("items", {"filter[type]": ",".join(ARMOR_TYPES)}),
    "blueprints": ("blueprints", {}),
}
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
            "maker": _maker(d), "size": d.get("size"), "mass": _num(d.get("mass")), "rarity": d.get("rarity"),
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


TRIM = {"weapons": trim_weapon, "armor": trim_armor, "blueprints": trim_blueprint}


class Gear:
    def __init__(self, cache_dir):
        self.dir = Path(cache_dir)

    def _file(self, name):
        return self.dir / f"gear_{re.sub(r'[^A-Za-z0-9_-]+', '_', name)}.json"

    def items(self, kind, max_pages=60, fresh=False):
        """Every entry of one kind, trimmed: {"items": [...], "at": when fetched, "stale": bool}."""
        path, flt = KINDS[kind]
        f = self._file(kind)
        old = None
        if f.exists():
            try:
                old = json.loads(f.read_text(encoding="utf-8"))
                if not fresh and time.time() - f.stat().st_mtime < DAY:
                    return old
            except Exception:
                old = None
        out, page, seen = [], 1, set()
        try:
            while page <= max_pages:
                q = dict(flt, **{"page[number]": page, "page[size]": 100})
                r = _get(f"{API}/{path}?" + urllib.parse.urlencode(q))
                data = r.get("data") or []
                for d in data:
                    if not isinstance(d, dict):
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
        res = {"items": out, "at": time.time(), "stale": False}
        self.dir.mkdir(exist_ok=True)
        f.write_text(json.dumps(res), encoding="utf-8")
        return res

    def blueprint(self, uuid):
        """One blueprint's full record: its unlocking missions too. Cached for a week."""
        f = self._file(f"bp_{uuid}")
        if f.exists() and time.time() - f.stat().st_mtime < 7 * DAY:
            try:
                return json.loads(f.read_text(encoding="utf-8"))
            except Exception:
                pass
        r = _get(f"{API}/blueprints/{urllib.parse.quote(str(uuid))}").get("data") or {}
        out = trim_blueprint(r)
        out["unlocks"] = [{"title": m.get("title") or m.get("debug_name"), "scope": m.get("reward_scope"),
                           "chance": _num(m.get("chance")), "web_url": m.get("web_url")}
                          for m in r.get("unlocking_missions") or [] if isinstance(m, dict)]
        self.dir.mkdir(exist_ok=True)
        f.write_text(json.dumps(out), encoding="utf-8")
        return out


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
