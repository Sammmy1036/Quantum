"""Personal gear and crafting from the Star Citizen Wiki API (api.star-citizen.wiki, community-maintained;
please credit it): personal (FPS) weapons, armor, gadgets, clothing, consumables, utility items and
blueprints, for the tabs of the same names.

Each kind is fetched page by page, trimmed to what the tabs show and cached on disk for a day (an older
copy is used when the wiki can't be reached). A blueprint's unlocking missions only come with its own
record, which is fetched when you open it and cached for a week.
"""
import json
import re
import threading
import time
import urllib.parse
import urllib.request
from pathlib import Path

import netcache

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
    # Food, drinks and medical items (MedPens, OxyPens…), and MedGel: the ParaMed and LifeGuard refills (filed as the
    # medical devices' magazines) and the Pancea MedGel Canister that refills med beds
    "consumables": [("items", {"filter[type]": "Food,Bottle,Drink"}), ("items", {"filter[classification]": "FPS.Consumable"}),
                    ("items", {"filter[name]": "Refill"}), ("items", {"filter[name]": "MedGel"})],
    # Weapon attachments: optics, barrel and underbarrel attachments, magazines (multi-tool ones are gadgets)
    "attachments": [("items", {"filter[type]": "WeaponAttachment"})],
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
    with netcache.fetch(req, timeout=timeout) as r:
        return json.loads(r.read().decode("utf-8"))


def _en(d):
    if isinstance(d, dict):
        return d.get("en_EN") or d.get("en") or next((v for v in d.values() if isinstance(v, str) and v), None)
    return d if isinstance(d, str) else None


def _num(v):
    return v if isinstance(v, (int, float)) and not isinstance(v, bool) else None


def _maker(d):
    m = d.get("manufacturer")
    for v in ((m.get("name") if isinstance(m, dict) else m), d.get("manufacturer_description")):
        v = str(v or "").strip()
        if v and not re.search(r"(?i)placeholder|^unknown$|^n/?a$|^none$", v):
            return "CureLife" if v.lower() == "curelife" else v
    if is_medgel(d):
        return "CureLife"                        # every MedGel product is CureLife's (the wiki leaves the canister blank)
    return ""


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


FIRE_MODES = {"single": "Semi-auto", "semi": "Semi-auto", "rapid": "Full-auto", "auto": "Full-auto", "burst": "Burst",
              "charge": "Charge", "beam": "Beam", "shotgun": "Spread", "sequence": "Sequence"}


def fire_mode(m):
    """A fire mode's name for people: the wiki's "localised" label is often "<= PLACEHOLDER =>" or "[SEMI]",
    so go by the mode itself ("Rapid" -> "Full-auto")."""
    for t in (m.get("mode"), m.get("localised")):
        t = re.sub(r"[\[\]<>=]", " ", str(t or "")).strip()
        if not t or re.search(r"(?i)placeholder|^test", t):
            continue
        return FIRE_MODES.get(t.lower(), t.title() if t.isupper() else t)
    return None


WEAPON_KINDS = ["LMG", "SMG", "Sniper Rifle", "Rifle", "Shotgun", "Pistol", "Launcher", "Railgun", "Grenade Launcher",
                "Knife", "Grenade", "Gadget", "Medical", "Tractor Beam", "Multi-Tool"]
# words in a name or "Item Type" line -> the kind ("Sniper Rifle" before "Rifle", "Grenade Launcher" before "Launcher")
_WEAPON_WORDS = [("grenade launcher", "Grenade Launcher"), ("sniper", "Sniper Rifle"), ("lmg", "LMG"), ("light machine", "LMG"),
                 ("smg", "SMG"), ("submachine", "SMG"), ("shotgun", "Shotgun"), ("scattergun", "Shotgun"), ("railgun", "Railgun"),
                 ("launcher", "Launcher"), ("pistol", "Pistol"), ("rifle", "Rifle"), ("knife", "Knife"), ("grenade", "Grenade")]


def weapon_kind(d, pw):
    """What kind of weapon it is (LMG, Rifle, Pistol…). The wiki's weapon type is sometimes missing, and its fallback
    is the size class ("Medium"), so the description's "Item Type" line and the name are asked before that."""
    t = str(pw.get("type") or "").strip()
    if t and t.lower() not in ("small", "medium", "large", "other", "unknown"):
        return t
    for src in (_desc_data(d).get("item type"), d.get("name")):
        low = str(src or "").lower()
        for w, k in _WEAPON_WORDS:
            if re.search(r"(?<![a-z])" + w + r"(?![a-z])", low):
                return k
    t = str(d.get("sub_type_label") or d.get("sub_type") or "").strip()
    return t if t and t.lower() not in ("small", "medium", "large") else "Other"


def armor_weight(*vals):
    """Light, Medium, Heavy or Super Heavy, from the wiki's sub type or the description's item type; anything else
    (undersuits, flight suits, odd labels) has no weight class."""
    for v in vals:
        low = str(v or "").lower()
        if "super" in low and "heavy" in low:
            return "Super Heavy"
        for w in ("heavy", "medium", "light"):
            if re.search(r"(?<![a-z])" + w, low):
                return w.title()
    return None


def trim_weapon(d):
    """A personal weapon: what it is (rifle, pistol…, ballistic or energy) and how it shoots."""
    pw = d.get("personal_weapon") or {}
    dmg = pw.get("damage") or {}
    ammo = pw.get("ammunition") or d.get("ammunition") or {}
    dtypes = [x.get("name") for x in pw.get("damages") or [] if isinstance(x, dict) and x.get("name")]
    modes = [fire_mode(m) for m in pw.get("modes") or [] if isinstance(m, dict)] or \
        ([fire_mode({"mode": pw["fire_mode"]})] if isinstance(pw.get("fire_mode"), str) else [])
    kind = weapon_kind(d, pw)
    out = _common(d)
    out.update({"kind": kind, "cls": (pw.get("class") or "").strip() or None,
                "weight": d.get("sub_type_label") or d.get("sub_type"),
                "stats": {k: v for k, v in {
                    "dps": _num(dmg.get("dps_total")), "alpha": _num(dmg.get("alpha_total") or pw.get("damage_per_shot")),
                    "rpm": _num(pw.get("rpm") or pw.get("rof")), "mag": _num(pw.get("magazine_size") or pw.get("capacity")),
                    "range": _num(pw.get("effective_range") or pw.get("range")), "speed": _num(ammo.get("speed")),
                    "pellets": _num(pw.get("pellets_per_shot")) if (pw.get("pellets_per_shot") or 1) > 1 else None,
                    "mass": _num(d.get("mass"))}.items() if v},
                "ports": weapon_ports(d) or None,          # attachment slots (see weapon_ports)
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
    out.update({"slot": slot, "weight": armor_weight(d.get("sub_type_label"), d.get("sub_type"), dd.get("item type")),
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


def is_medgel(d):
    """MedGel: the ParaMed and LifeGuard refills and the Pancea canister for med beds."""
    return bool(re.search(r"(?i)medgel|paramed refill|lifeguard refill",
                          f"{d.get('name') or ''} {_en(d.get('description')) or ''} {d.get('sub_type_label') or ''}"))


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
        if is_medgel(d):
            return "Medical"
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
    if kind == "consumables" and is_medgel(d):
        out["sub"] = "MedGel (med beds)" if re.search(r"(?i)canister", out["name"]) else "MedGel refill"
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


# ---------------------------------------------------------------- weapon attachments
# Optics, barrel attachments (compensators, suppressors, flash hiders, energy stabilizers), underbarrel
# attachments (lasers, flashlights) and magazines: the wiki files them all as type WeaponAttachment, with the
# sub type naming where they go. Multi-tool attachments (sub type Utility) stay in Gadgets.
ATT_SLOTS = {"IronSight": ("optics", "Optic"), "Barrel": ("barrel", "Barrel"),
             "BottomAttachment": ("underbarrel", "Underbarrel"), "Magazine": ("magazine", "Magazine")}
ATT_SLOT_LABEL = {v[0]: v[1] for v in ATT_SLOTS.values()}
ATT_PORT_NAME = [(r"optic|sight|scope", "optics"), (r"underbarrel|bottom|under_?barrel", "underbarrel"),
                 (r"barrel|muzzle", "barrel"), (r"magazine|\bmag\b|ammo", "magazine")]
ATT_TYPE_WORDS = [(r"telescop|sniper scope|\bx(8|10|12|16)\b", "Telescopic"), (r"holo", "Holographic"), (r"reflex|red ?dot", "Reflex"),
                  (r"compensat", "Compensator"), (r"suppress|silenc", "Suppressor"), (r"flash ?hider", "Flash hider"),
                  (r"stabili[sz]", "Energy stabilizer"), (r"laser", "Laser pointer"), (r"flash ?light|torch|\blight\b", "Flashlight"),
                  (r"magazine|battery|\bcap\)", "Magazine")]
# Weapon-modifier numbers worth naming: the rest get a name made from their own key
ATT_MOD_NAMES = {"fire_rate_multiplier": "Fire rate", "damage_multiplier": "Damage", "projectile_speed_multiplier": "Projectile speed",
                 "sound_radius_multiplier": "Noise", "heat_generation_multiplier": "Heat build-up", "ammo_cost_multiplier": "Ammo use",
                 "charge_time_multiplier": "Charge time", "zoom_time_scale": "Aim-down-sights time",
                 "recoil.decay_multiplier": "Recoil recovery", "recoil.fire_recoil_strength_multiplier": "Recoil",
                 "recoil.angle_recoil_strength_multiplier": "Recoil kick", "recoil.randomness_multiplier": "Recoil wobble",
                 "spread.max_multiplier": "Max spread", "spread.min_multiplier": "Min spread", "spread.attack_multiplier": "Spread per shot",
                 "spread.decay_multiplier": "Spread recovery", "spread.first_attack_multiplier": "First-shot spread"}


def _snake(k):
    return re.sub(r"(?<=[a-z0-9])([A-Z])", r"_\1", str(k)).lower()


def _mods(wm, path=""):
    """[(key, value)] of every number under the wiki's weapon_modifier block, keys snake_case with the
    group in front ("recoil.decay_multiplier")."""
    out = []
    if isinstance(wm, dict):
        for k, v in wm.items():
            k = _snake(k)
            grp = re.sub(r"_?modifier$", "", k)
            if isinstance(v, dict):
                out += _mods(v, f"{path}{grp}." if grp not in ("weapon_stats", "stats", "modifier", "") else path)
            elif _num(v) is not None:
                out.append((path + k, v))
    return out


def att_effects(wm):
    """What an attachment changes, as [[label, "+15%"]]: only the multipliers that aren't 1."""
    out, seen = [], set()
    for k, v in _mods(wm):
        if not (k.endswith("multiplier") or k.endswith("zoom_time_scale")) or abs(v - 1) < 1e-4:
            continue
        lab = ATT_MOD_NAMES.get(k) or ATT_MOD_NAMES.get(k.split(".")[-1])
        if not lab:
            parts = [p for p in re.split(r"[._]", k) if p not in ("multiplier", "scale")]
            lab = " ".join(parts).capitalize()
        if lab in seen:
            continue
        seen.add(lab)
        out.append([lab, f"{(v - 1) * 100:+.0f}%"])
    return out[:12]


def _att_slot(sub, name=""):
    if sub in ATT_SLOTS:
        return ATT_SLOTS[sub][0]
    for rx, slot in ATT_PORT_NAME:
        if re.search(rx, str(name or ""), re.I):
            return slot
    return None


def trim_attachment(d):
    """One weapon attachment: where it goes, how big, what it is and what it changes."""
    out = _common(d)
    sub = d.get("sub_type") or ""
    slot = _att_slot(sub, f"{d.get('classification') or ''} {d.get('position') or ''} {d.get('name') or ''}")
    dd = _desc_data(d)
    wm = d.get("weapon_modifier") if isinstance(d.get("weapon_modifier"), dict) else {}
    aim = (wm.get("aim") or wm.get("aim_modifier") or {}) if isinstance(wm.get("aim") or wm.get("aim_modifier"), dict) else {}
    iron = d.get("iron_sight") if isinstance(d.get("iron_sight"), dict) else {}
    zoom = _num(aim.get("zoom_scale")) or _num(iron.get("zoom_scale")) or _num(d.get("zoom"))
    if not zoom:
        m = re.search(r"(\d+(?:\.\d+)?)\s*x", str(dd.get("magnification") or ""))
        zoom = float(m.group(1)) if m else None
    mag = d.get("magazine") if isinstance(d.get("magazine"), dict) else {}
    cap = _num(mag.get("max_ammo_count") or mag.get("capacity") or mag.get("initial_ammo_count")) or _num(d.get("capacity"))
    if not cap:
        m = re.search(r"\d+", str(dd.get("capacity") or dd.get("magazine size") or ""))
        cap = int(m.group(0)) if m else None
    typ = dd.get("type")
    if not typ or str(typ).lower() in ("weaponattachment", "weapon attachment"):
        typ = next((lab for rx, lab in ATT_TYPE_WORDS if re.search(rx, f"{out['name']} {d.get('class_name') or ''}", re.I)), None)
    out.update({"kind": ATT_SLOT_LABEL.get(slot, "Other"), "slot": slot, "sub": typ,
                "type": d.get("type"), "classification": d.get("classification"),
                "grade": d.get("grade"),
                "effects": att_effects(wm) or d.get("effects") or [],
                "stats": {k: v for k, v in {"zoom": zoom if zoom and zoom > 1.0001 else None, "mag": cap,
                                            "mass": _num(d.get("mass")), "size": _num(d.get("size"))}.items() if v is not None},
                "facts": [f for f in _facts(d) if f[0].lower() not in ("attachment point", "magnification", "capacity")]})
    return out


def weapon_ports(d):
    """A weapon's attachment slots: [{slot, min, max, stock: {name, uuid} | None}], one per slot, from the
    wiki's ports (or Quantum's game data, in the same shape)."""
    out = {}
    for p in d.get("ports") or []:
        if not isinstance(p, dict):
            continue
        subs = [p.get("sub_type")]
        for ct in p.get("compatible_types") or p.get("types") or []:
            if isinstance(ct, dict):
                subs += [s.get("name") if isinstance(s, dict) else s for s in (ct.get("sub_types") or [])] + [ct.get("sub_type")]
            elif isinstance(ct, str):
                subs.append(ct.split(".")[-1])
        slot = next((ATT_SLOTS[s][0] for s in subs if s in ATT_SLOTS), None) or \
            _att_slot(None, f"{p.get('name') or ''} {p.get('display_name') or ''}")
        if not slot or slot in out:
            continue
        sz = p.get("sizes") if isinstance(p.get("sizes"), dict) else {}
        mn = _num(sz.get("min")) if _num(sz.get("min")) is not None else _num(p.get("min_size"))
        mx = _num(sz.get("max")) if _num(sz.get("max")) is not None else _num(p.get("max_size"))
        if mn is None and mx is None and _num(p.get("size")) is not None:
            mn = mx = _num(p.get("size"))
        eq = p.get("equipped_item") if isinstance(p.get("equipped_item"), dict) else {}
        su = eq.get("uuid") or p.get("equipped_item_uuid")
        stock = {"name": (eq.get("name") or "").strip() or None, "uuid": su or None} if (eq.get("name") or su) else None
        out[slot] = {"slot": slot, "min": mn, "max": mx, "stock": stock}
    order = ["optics", "barrel", "underbarrel", "magazine"]
    return [out[k] for k in order if k in out]


TRIM = {"weapons": trim_weapon, "armor": trim_armor, "blueprints": trim_blueprint, "attachments": trim_attachment,
        **{k: (lambda d, k=k: trim_item(d, k)) for k in ITEM_KINDS}}


def _skip(kind, d):
    """Entries that belong in another tab: gadgets (multi-tools, tractor beams…) aren't weapons, and the
    utility query's ship things (weapon racks) aren't carried."""
    if kind == "weapons":
        return d.get("sub_type") == "Gadget" or (d.get("classification") or "").startswith("FPS.Weapon.Gadget")
    if kind == "consumables" and re.search(r"(?i)refill|medgel", d.get("name") or ""):
        if re.fullmatch(r"(?i)\s*med\s*gel\s*", d.get("name") or ""):
            return True                          # the commodity a canister holds, not something you buy
        return not is_medgel(d)                  # the name queries also find other refills
    if kind == "attachments":
        # Multi-tool attachments (Utility) are gadgets; the rest are kept when anything about them names a slot
        # (the sub type, else the classification like FPS.WeaponAttachment.BarrelAttachment, else the name)
        cls = d.get("classification") or ""
        if d.get("sub_type") == "Utility" or cls.endswith(".Utility") or not (d.get("type") == "WeaponAttachment" or "WeaponAttachment" in cls):
            return True
        return not _att_slot(d.get("sub_type"), f"{cls} {d.get('position') or ''} {d.get('name') or ''}")
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
        self.files = None              # gamefiles.Gear: Quantum's own data from the game files (set by the app)

    def _game_list(self, kind):
        """This tab from Quantum's own game data, in the same shape as the wiki's (no prices or pictures)."""
        if not self.files or kind == "blueprints":
            return []
        return self.files.trimmed(kind, TRIM[kind], skip=_skip, dedupe=dedupe if kind != "blueprints" else None, junk=JUNK)

    def _with_game(self, res, kind):
        """The wiki's list with any number it lacks filled in from the game files (matched by the game's
        own id, then by name). The cached file isn't changed: a newer game data file applies at once."""
        game = self._game_list(kind)
        if not game or not res or not res.get("items"):
            return res
        by_id = {t["uuid"]: t for t in game if t.get("uuid")}
        by_name = {t["name"].strip().lower(): t for t in game}
        items = []
        for t in res["items"]:
            g = by_id.get(t.get("uuid")) or next((by_id[a] for a in t.get("alias_uuids") or [] if a in by_id), None) \
                or by_name.get((t.get("name") or "").strip().lower())
            if g and g.get("stats"):
                missing = {k: v for k, v in g["stats"].items() if (t.get("stats") or {}).get(k) in (None, "", 0)}
                if missing:
                    t = dict(t, stats={**(t.get("stats") or {}), **missing})
            if g:                                    # attachment slots and what an attachment changes, when the wiki lacks them
                for f in ("ports", "effects", "slot"):
                    if g.get(f) and not t.get(f):
                        t = dict(t, **{f: g[f]})
            items.append(t)
        return dict(res, items=items)

    def _file(self, name):
        return self.dir / f"gear_v6_{re.sub(r'[^A-Za-z0-9_-]+', '_', name)}.json"   # v6: MedGel in Consumables, CureLife, fire modes

    # Each list's own file name: weapons got their attachment slots (ports) and Attachments is new. Every other
    # list keeps the file it had, so an update doesn't make Quantum download them all again.
    FILE_OF = {"weapons": "weapons_ports", "attachments": "attachments_v2"}

    def items(self, kind, max_pages=60, fresh=False):
        """Every entry of one kind, trimmed: {"items": [...], "at": when fetched, "stale": bool}.
        One download per list at a time: other callers wait for it and get its result, rather than each
        fetching every page from the wiki themselves (that froze startup when several asked at once)."""
        locks = self.__dict__.setdefault("_locks", {})
        lock = locks.setdefault(kind, threading.Lock())
        with lock:
            return self._items(kind, max_pages, fresh)

    def _legacy(self, kind):
        """Weapons from before they had attachment slots: shown while the new list downloads in the background."""
        if kind != "weapons":
            return None
        f = self._file(kind)
        try:
            return json.loads(f.read_text(encoding="utf-8")) if f.exists() else None
        except Exception:
            return None

    def _refresh_later(self, kind):
        busy = self.__dict__.setdefault("_bg", set())
        if kind in busy:
            return
        busy.add(kind)

        def run():
            try:
                self.items(kind, fresh=True)
            except Exception:
                pass
            finally:
                busy.discard(kind)
        threading.Thread(target=run, daemon=True).start()

    def _items(self, kind, max_pages=60, fresh=False):
        f = self._file(self.FILE_OF.get(kind, kind))
        if not f.exists() and not fresh:
            leg = self._legacy(kind)
            if leg and leg.get("items"):
                self._refresh_later(kind)
                return self._with_game(leg, kind) if hasattr(self, "_with_game") else leg
        old = None
        if f.exists():
            try:
                old = json.loads(f.read_text(encoding="utf-8"))
                # The wiki builds these from the game files, so they're kept until the patch changes
                # (netcache: daily for the first days of a patch, never past a week)
                if not fresh and netcache.static_fresh(old.get("at") or f.stat().st_mtime, old.get("patch")):
                    return self._with_game(old, kind)
            except Exception:
                old = None
        if old is not None and old.get("items") and not fresh:
            self._refresh_later(kind)                  # out of date: show the saved copy now, fetch the new one behind it
            return self._with_game(old, kind)
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
                return self._with_game(dict(old, stale=True), kind)
            game = self._game_list(kind)
            if game:                                 # the wiki can't be reached and nothing's saved: ours
                return {"items": game, "at": self.files.at, "stale": False, "source": "game"}
            raise
        if kind != "blueprints":
            out = dedupe(out, kind)
        res = {"items": out, "at": time.time(), "stale": False, "patch": netcache.patch_key()}
        self.dir.mkdir(exist_ok=True)
        f.write_text(json.dumps(res), encoding="utf-8")
        return self._with_game(res, kind)

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

    def weapon_ports(self, uuid):
        """One weapon's attachment slots from its own wiki record (the lists don't always carry them):
        [{slot, min, max, stock}]. Cached for a week; [] when the wiki has none."""
        uuid = str(uuid or "").strip()
        if not re.fullmatch(r"[0-9a-fA-F-]{32,36}", uuid):
            return []
        f = self._file(f"ports_{uuid}")
        if f.exists() and time.time() - f.stat().st_mtime < 7 * DAY:
            try:
                return json.loads(f.read_text(encoding="utf-8"))
            except Exception:
                pass
        d = _get(f"{API}/items/{urllib.parse.quote(uuid)}?include=ports").get("data") or {}
        out = weapon_ports(d)
        if not out and self.files:                  # the game files know the weapon's ports
            g = self.files.items.get(uuid) or {}
            out = weapon_ports({"ports": g.get("ports") or []})
        self.dir.mkdir(exist_ok=True)
        f.write_text(json.dumps(out), encoding="utf-8")
        return out

    def item_record(self, uuid):
        """One item's own record (what the game files say about it): its entity tags (PromotionalItem,
        CanGenerateAsLoot…), item tags, event source and class name. Cached for a week; None when unknown."""
        uuid = str(uuid or "").strip()
        if not re.fullmatch(r"[0-9a-fA-F-]{32,36}", uuid):
            return None
        f = self._file(f"rec2_{uuid}")                # rec2: with the ships that carry it fitted
        if f.exists() and time.time() - f.stat().st_mtime < 7 * DAY:
            try:
                return json.loads(f.read_text(encoding="utf-8"))
            except Exception:
                pass
        d = _get(f"{API}/items/{urllib.parse.quote(uuid)}?include=vehicles").get("data") or {}
        if not d:
            return None
        tags = d.get("entity_tag_map") or []
        out = {"uuid": uuid, "name": (d.get("name") or "").strip(), "class_name": d.get("class_name") or "",
               "maker": _maker(d), "maker_code": _maker_code(d),
               "entity_tags": [t.get("name") for t in tags if isinstance(t, dict) and t.get("name")],
               "tags": [str(t) for t in (d.get("tags") or []) if isinstance(t, (str, int))][:40],
               "event_source": [str(e) for e in (d.get("event_source") or []) if e],
               "lootable": bool(d.get("is_lootable")), "craftable": bool(d.get("is_craftable")),
               "base": ((d.get("base_variant") or {}).get("name") if isinstance(d.get("base_variant"), dict) else None),
               # ships and vehicles that come with it fitted (their stock loadout, from the game files)
               "vehicles": sorted({(v.get("name") or "").strip() for v in d.get("vehicles") or []
                                   if isinstance(v, dict) and (v.get("name") or "").strip()
                                   and not JUNK.search(f"{v.get('name')} {v.get('class_name') or ''}")})}
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


# Pledge store packs an item comes in, checked by hand: shown even when RSI has the pack off sale (and so
# missing from the live store list, pledgestore.py). Keyed by lower-case item name; price is US dollars as
# last seen (the live store's own price wins when the pack is on sale). Add to it as more are checked.
_RED_ALERT_ADP = [
    {"title": "\"Red Alert\" Weapons & Armor Collection", "price": 89,
     "note": "Every Red Alert armor set and weapon in one collection"},
    {"title": "CDS ADP-mk4 \"Red Alert\" Gear Pack", "price": None, "note": "The ADP-mk4 Red Alert armor with its gear"},
    {"title": "CDS ADP-mk4 \"Red Alert\" Armor", "price": 14, "note": "The ADP-mk4 Red Alert armor set on its own"},
]
PLEDGE_SOURCES = {
    "csp-68h backpack red alert": _RED_ALERT_ADP,
    "adp-mk4 helmet red alert": _RED_ALERT_ADP,
    "adp-mk4 core red alert": _RED_ALERT_ADP,
    "adp-mk4 arms red alert": _RED_ALERT_ADP,
    "adp-mk4 legs red alert": _RED_ALERT_ADP,
}


def pledge_sources(name):
    key = re.sub(r"\s+", " ", str(name or "").strip().lower())
    return [dict(x) for x in PLEDGE_SOURCES.get(key, [])]


# ---- What the game files say about where an item comes from. The Star Citizen Wiki's API copies each item's
# record out of the game files (Data.p4k), with its entity tags, item tags and class name. Those don't name a
# pack or a shop, but they do say what kind of item it is: a promotional (pledge store) item, event flair, a
# subscriber item, or whether it may spawn as loot at all.
EVENT_TEXT = {
    "iae": "Intergalactic Aerospace Expo (IAE): sold on the pledge store during the expo, or an expo reward",
    "invictus": "Invictus Launch Week: a pledge store or event item from Invictus",
    "citizencon": "CitizenCon: a pledge store or attendee item from CitizenCon",
    "luminalia": "Luminalia: a holiday event gift or pledge store item",
    "xenothreat": "XenoThreat: a reward from the XenoThreat event",
    "jumptown": "Jump Town: a reward from the Jump Town event",
    "coramor": "Coramor: a Valentine's event gift or pledge store item",
    "stella fortuna": "Stella Fortuna: a St Patrick's event item",
    "red festival": "Red Festival: a Lunar New Year event item",
    "foundation festival": "Foundation Festival: a community event reward",
    "subscriber": "Subscriber item: given to RSI subscribers (Centurion/Imperator) in a monthly promotion",
    "referral": "Referral Program: earned by recruiting new players",
}
# Event and promotion hints in class names ("cds_combat_heavy_backpack_01_iae2022_01")
CLASS_HINTS = [
    (r"iae[_]?(\d{4})", lambda m: f"IAE {int(m.group(1)) + 930}", "iae"),
    (r"invictus", lambda m: "Invictus", "invictus"),
    (r"citizen_?con|_cc(\d{4})", lambda m: "CitizenCon", "citizencon"),
    (r"luminalia|xmas|holiday", lambda m: "Luminalia", "luminalia"),
    (r"xeno_?threat", lambda m: "XenoThreat", "xenothreat"),
    (r"coramor|valentine", lambda m: "Coramor", "coramor"),
    (r"(?:^|_)sub(?:scriber)?(?:_|\d|$)", lambda m: "Subscriber", "subscriber"),
    (r"referral", lambda m: "Referral", "referral"),
]


def acquisition_hints(rec):
    """[{kind: pledge|event|subscriber|noloot|loot, label, text}] from an item record (Gear.item_record)."""
    if not rec:
        return []
    tags = {str(t).strip() for t in rec.get("entity_tags") or []}
    out, seen = [], set()

    def add(kind, label, text):
        if label.lower() in seen:
            return
        seen.add(label.lower())
        out.append({"kind": kind, "label": label, "text": text})

    events = [str(e) for e in rec.get("event_source") or [] if e]
    # the class name and item tags ("Color_iae2022") both carry event names
    cls = " ".join([str(rec.get("class_name") or "")] + [str(t) for t in rec.get("tags") or []]).lower().replace(" ", "_")
    for rx, label, key in CLASS_HINTS:
        m = re.search(rx, cls)
        if m:
            events.append(label(m))
    # "IAE" from the wiki and "IAE 2952" from the class name: just the one that says more
    events = [e for e in dict.fromkeys(events) if not any(o != e and o.lower().startswith(e.lower() + " ") for o in events)]
    for e in events:
        k = next((k for k in EVENT_TEXT if k in e.lower()), None)
        add("subscriber" if k == "subscriber" else "event", e, EVENT_TEXT.get(k) or f"Tied to {e}")
    if "PromotionalItem" in tags:
        add("pledge", "Promotional item", "The game files mark it as a promotional item: it comes from the RSI pledge "
                                          "store (often in a pack) or a promotion, not from an in-game shop.")
    if "SpecialEventFlair" in tags and not events:
        add("event", "Event item", "The game files mark it as special event flair: handed out during an event.")
    if "CannotGenerateAsLoot" in tags:
        add("noloot", "Never loot", "The game files rule it out as loot: it won't turn up in crates or on enemies.")
    elif "CanGenerateAsLoot" in tags:
        add("loot", "Can be loot", "The game files let it spawn as loot.")
    return out


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
