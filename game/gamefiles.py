"""Quantum's own game data, built from the game files after each patch (sc_components.py,
build_game_data.py) and served from the Quantum server's assets (data/*.json, see assets.py).

    contracts_data.json   mission board entries: title, description, giver, type, reward, cargo, reputation
    gear_data.json        personal weapons, armor, clothing, consumables, gadgets
    vehicles_data.json    player ships and ground vehicles: insurance, cargo, speeds, stock parts
    blueprints_data.json  crafting blueprints: product, craft time, ingredients, reward pools and the contracts
                          that unlock them (build_blueprints.py)

These come first; the Star Citizen Wiki only adds what the game files don't have (shop prices,
pictures, the places a contract can send you). When the wiki can't be reached, what's here still works.

Each file is chosen the way component_stats.json is (fleet.GameData): the newest of the copies on this
PC by its "generated" time, and a newer one from the server is swapped in while the app runs.
"""
import json
import re
from datetime import datetime
from pathlib import Path

NAMES = ("contracts_data.json", "gear_data.json", "vehicles_data.json", "blueprints_data.json")


def _norm(s):
    return re.sub(r"[^a-z0-9]+", "", str(s or "").lower())


def _nums(text):
    return [float(x) for x in re.findall(r"-?\d+(?:\.\d+)?", str(text or "").replace(",", ""))]


class DataFile:
    """One data file: {"generated", "count", "items": {uuid: {...}}}, newest copy wins."""

    def __init__(self, *paths):
        self.items, self.generated = {}, None
        best = None
        for p in paths:
            raw = self._read(p)
            if raw and (best is None or str(raw.get("generated") or "") > str(best.get("generated") or "")):
                best = raw
        self._use(best or {})

    @staticmethod
    def _read(path):
        try:
            raw = json.loads(Path(path).read_text(encoding="utf-8"))
            return raw if isinstance(raw.get("items"), dict) and raw["items"] else None
        except Exception:
            return None

    def _use(self, raw):
        items = raw.get("items") or {}
        self._index(items)                      # built first, then swapped in, so readers never see half
        self.items, self.generated = items, raw.get("generated")

    def _index(self, items):
        pass

    def update_from(self, path):
        raw = self._read(path)
        if raw and str(raw.get("generated") or "") > str(self.generated or ""):
            self._use(raw)
            return True
        return False

    @property
    def at(self):
        """When the file was built, as a timestamp (what the app shows as "updated")."""
        try:
            return datetime.fromisoformat(str(self.generated)).timestamp()
        except (TypeError, ValueError):
            return None

    def __bool__(self):
        return bool(self.items)


# ---------------------------------------------------------------- contracts
class Contracts(DataFile):
    def _index(self, items):
        by_code, by_title = {}, {}
        for uid, c in items.items():
            for k in (c.get("class_name"), c.get("debug_name")):
                if k:
                    by_code.setdefault(_norm(k), uid)
            if c.get("title"):
                by_title.setdefault(_norm(c["title"]), []).append(uid)
        self._by_code, self._by_title = by_code, by_title

    def find(self, code, name=None, title_guesses=()):
        """The contract Game.log calls `code` ("HaulCargo_LinearChain"), or one titled like `name`."""
        uid = self._by_code.get(_norm(code)) if code else None
        if not uid:
            for t in [name, *title_guesses]:
                hits = self._by_title.get(_norm(t)) if t else None
                if hits:
                    uid = hits[0]
                    break
        return (uid, self.items[uid]) if uid else (None, None)

    @staticmethod
    def summary(c):
        """A contract in the shape missions_wiki.summarize() gives (what the Contracts tab shows)."""
        rew, mx = c.get("reward"), c.get("reward_max")
        rep = [{"faction": r.get("faction"), "amount": r.get("amount")} for r in c.get("rep") or [] if r.get("amount")]
        cargo = [{"what": o.get("resource"), "scu": [o.get("min_scu"), o.get("max_scu") or o.get("min_scu")]
                  if o.get("min_scu") is not None else None, "box": None, "amount": None}
                 for o in c.get("cargo") or [] if o.get("resource")]
        cur = c.get("currency")
        none = {"names": [], "more": 0}
        return {"title": c.get("title"), "debug_name": c.get("class_name"), "type": c.get("type"),
                "giver": c.get("giver"), "faction": rep[0]["faction"] if rep else None,
                "reward": [rew, mx or rew] if rew or mx else None,
                "currency": "aUEC" if cur in (None, "", "UEC") else cur,
                "rep": rep, "rank": None, "rank_name": c.get("rank"),
                "illegal": c.get("lawful") is False, "minutes": None, "combat": False, "enemies": None,
                "max_players": c.get("max_players"), "shareable": c.get("shareable"),
                "cargo": cargo, "pickups": none, "destinations": none, "offered_at": none,
                "reward_items": [], "blueprints": [], "url": None, "version": None,
                "description": c.get("description"), "source": "game"}


# What the game files are the better source for (they're this patch's own numbers); the rest of a wiki
# record (places, blueprints, time limits, enemies) fills in around them.
GAME_FIRST = ("title", "giver", "type", "reward", "currency", "illegal", "max_players", "shareable")
GAME_IF_MISSING = ("rep", "cargo", "faction", "rank_name", "debug_name", "description")


def merge_contract(game, wiki):
    if not wiki:
        return game
    if not game:
        return wiki
    out = dict(wiki)
    for k in GAME_FIRST:
        if game.get(k) not in (None, "", []):
            out[k] = game[k]
    for k in GAME_IF_MISSING:
        if not out.get(k) and game.get(k):
            out[k] = game[k]
    out["source"] = "game+wiki"
    return out


# ---------------------------------------------------------------- gear
GEAR_TABS = {"weapons", "armor", "clothing", "consumables", "gadgets", "utility", "attachments"}
CLASSIFICATION = {"FPS_Consumable": "FPS.Consumable", "Food": "FPS.Consumable.Food", "Drink": "FPS.Consumable.Drink",
                  "Bottle": "FPS.Consumable.Drink", "Gadget": "FPS.Weapon.Gadget", "Grenade": "FPS.Weapon.Grenade"}


class Gear(DataFile):
    def _index(self, items):
        by_kind = {}
        for uid, g in items.items():
            by_kind.setdefault(g.get("kind"), []).append(uid)
        self._by_kind = by_kind
        self._trimmed = {}                       # kind -> trimmed list (gear.py's shape), made when first asked

    @staticmethod
    def wiki_shape(uid, g):
        """A game-file item dressed as a wiki item record, so gear.py's TRIM functions read it unchanged."""
        st, info = g.get("stats") or {}, g.get("info") or {}
        typ = g.get("type") or ""
        d = {"uuid": uid, "name": g.get("name"), "class_name": g.get("class_name"), "type": typ,
             "sub_type": g.get("subtype"), "sub_type_label": g.get("subtype") if g.get("subtype") not in ("UNDEFINED", None) else None,
             "type_label": info.get("Item Type"), "size": g.get("size"), "mass": st.get("mass"),
             "manufacturer": {"name": g.get("maker")} if g.get("maker") else None,
             "description": g.get("description"), "classification": CLASSIFICATION.get(typ),
             "description_data": [{"name": k, "value": v} for k, v in info.items()]}
        if st.get("capacity_scu"):
            d["inventory"] = {"scu": st["capacity_scu"]}
        if g.get("kind") == "weapons":
            rng = _nums(info.get("Effective Range"))
            d["personal_weapon"] = {
                "damage": {"dps_total": st.get("dps"), "alpha_total": st.get("damage_per_shot")},
                "rpm": st.get("fire_rate"), "magazine_size": st.get("max_ammo"),
                "effective_range": rng[0] if rng else None, "pellets_per_shot": st.get("pellets"),
                "damages": [{"name": k} for k in (st.get("damage_breakdown") or {})]}
            d["ammunition"] = {"speed": st.get("projectile_speed")}
        if g.get("ports"):                       # attachment slots (build_attachments.py), the wiki's port shape
            d["ports"] = g["ports"]
        if g.get("kind") == "attachments":
            d["weapon_modifier"] = g.get("modifier") or {}
            d["grade"] = g.get("grade")
            if st.get("zoom"):
                d["zoom"] = st["zoom"]
            if st.get("capacity"):
                d["capacity"] = st["capacity"]
        if g.get("kind") in ("armor", "clothing"):
            temp = _nums(info.get("Temp. Rating"))
            d["suit_armor"] = {"temp_resistance_min": temp[0] if len(temp) > 1 else None,
                               "temp_resistance_max": temp[1] if len(temp) > 1 else None}
            rad, rate = _nums(info.get("Radiation Protection")), _nums(info.get("Radiation Scrub Rate"))
            d["radiation_resistance"] = {"maximum_radiation_capacity": rad[0] if rad else None,
                                         "radiation_dissipation_rate": rate[0] if rate else None}
        return d

    def trimmed(self, kind, trim, skip=None, dedupe=None, junk=None):
        """Every item of one Gear tab in gear.py's shape (no prices or pictures: those are the wiki's)."""
        if kind not in GEAR_TABS:
            return []
        key = (kind, self.generated)
        hit = self._trimmed.get(key)
        if hit is not None:
            return hit
        out = []
        for uid in self._by_kind.get(kind, []):
            d = self.wiki_shape(uid, self.items[uid])
            if skip and skip(kind, d):
                continue
            try:
                t = trim(d)
            except Exception:
                continue
            if not t.get("name") or (junk and junk.search(f"{t['name']} {t.get('class_name') or ''}")):
                continue
            t["source"] = "game"
            out.append(t)
        if dedupe:
            out = dedupe(out, kind)
        self._trimmed = {key: out, **{k: v for k, v in self._trimmed.items() if k[1] == self.generated}}
        return out


# ---------------------------------------------------------------- vehicles
class Vehicles(DataFile):
    def _index(self, items):
        by = {}
        for uid, v in items.items():
            for k in (v.get("class_name"), v.get("name")):
                if k:
                    by.setdefault(_norm(k), uid)
        for uid, v in items.items():                     # "Gladius" as well as "Aegis Gladius"
            words = (v.get("name") or "").split()
            if len(words) > 1:
                by.setdefault(_norm(" ".join(words[1:])), uid)
        self._by = by
        carry = {}                                       # part uuid -> the vehicles that come with it fitted
        for v in items.values():
            for p in v.get("parts") or []:
                u = str(p.get("uuid") or "").lower()
                if u and v.get("name"):
                    carry.setdefault(u, set()).add(v["name"].strip())
        self._carry = {u: sorted(n) for u, n in carry.items()}

    def fitted_with(self, part_uuid):
        """The vehicles whose stock loadout has this part (by the part's uuid), or None when the data has none."""
        return self._carry.get(str(part_uuid or "").lower()) if self.items else None

    def find(self, uuid=None, name=None, class_name=None):
        if uuid and uuid in self.items:
            return dict(self.items[uuid], uuid=uuid)
        for k in (class_name, name):
            uid = self._by.get(_norm(k)) if k else None
            if uid:
                return dict(self.items[uid], uuid=uid)
        return None

    def lookup(self, keys):
        """The vehicle for the first of keys (uuid, name, slug…) that matches, or None."""
        for k in [k for k in keys if k]:
            v = self.find(uuid=k) or self.find(name=k)
            if v:
                return v
        return None

    @staticmethod
    def wiki_record(v, part_info=None):
        """A vehicle from the game files in the shape of the wiki's vehicle record (fleet.Wiki.loadout reads
        it): its slots as a tree, each with its size range and the stock part fitted, plus its speeds and
        cargo. part_info(uuid) -> {"maker", "class"} fills in what the slot list doesn't carry."""
        ports, parts = v.get("ports") or [], v.get("parts") or []
        fitted = {((p.get("parent") or "").lower(), (p.get("port") or "").lower()): p for p in parts}
        kids = {}
        for pt in ports:
            kids.setdefault((pt.get("parent") or "").lower(), []).append(pt)

        def node(pt, parent, depth):
            name = pt.get("name") or ""
            f = fitted.get(((parent or "").lower(), name.lower()))
            types = [t.split(":", 1)[0] for t in pt.get("types") or []]
            typ = f["type"] if f and f.get("type") in types else (types[0] if types else (f or {}).get("type"))
            eq = None
            if f:
                info = (part_info(f.get("uuid")) if part_info and f.get("uuid") else None) or {}
                eq = {"name": f.get("name"), "type": f.get("type"), "size": f.get("size"), "grade": f.get("grade"),
                      "class": info.get("class"), "manufacturer": {"name": info.get("maker")} if info.get("maker") else None,
                      "uuid": f.get("uuid"), "class_name": f.get("class_name")}
            sub = [node(c, name, depth + 1) for c in kids.get(name.lower(), [])] if depth < 6 else []
            return {"name": name, "type": typ, "editable": bool(pt.get("editable")),
                    "sizes": {"min": pt.get("min"), "max": pt.get("max")}, "equipped_item": eq, "ports": sub,
                    "guessed": bool(pt.get("guessed"))}

        fl = v.get("flight") or {}
        return {"name": v.get("name"), "game_name": v.get("name"), "uuid": v.get("uuid"), "class_name": v.get("class_name"),
                "manufacturer": {"name": v.get("maker")} if v.get("maker") else None,
                "ports": [node(pt, None, 0) for pt in kids.get("", [])],
                "speed": {k: x for k, x in (("scm", fl.get("scm_speed")), ("max", fl.get("max_speed"))) if x},
                "cargo_capacity": v.get("cargo_scu"), "mass": v.get("mass"),
                "insurance": v.get("insurance"), "source": "game"}


def merge_vehicle(game, wiki):
    """The game files' slots, speeds and cargo; everything else (pictures, crew, signatures, armor,
    descriptions) from the wiki's record when there is one."""
    if not wiki:
        return game
    out = dict(wiki)
    out["ports"] = game["ports"]
    if game.get("speed"):
        out["speed"] = {**(wiki.get("speed") or {}), **game["speed"]}
    for k in ("cargo_capacity", "mass", "insurance", "class_name"):
        if game.get(k) is not None:
            out[k] = game[k]
    out["source"] = "game+wiki"
    return out


# ---------------------------------------------------------------- blueprints
class Blueprints(DataFile):
    """Crafting blueprints (build_blueprints.py), handed out in the shape sources/gear.py's trim_blueprint
    gives the wiki's, so the Blueprints tab and blueprint pages read them unchanged."""

    def _index(self, items):
        self._list = None
        self._by_out = {str(b.get("out_uuid") or "").lower(): uid for uid, b in items.items() if b.get("out_uuid")}

    @staticmethod
    def _ing(i):
        return {"name": i.get("name"), "kind": i.get("kind"), "scu": i.get("scu"), "qty": i.get("qty"), "uuid": i.get("uuid")}

    def trimmed(self, uid, b):
        return {"uuid": uid, "key": b.get("key"), "name": b.get("name"), "out_uuid": b.get("out_uuid"),
                "out_type": b.get("out_type"), "category": b.get("category") or "Other", "sub_type": b.get("out_subtype"),
                "grade": b.get("grade"), "time": b.get("time"), "time_label": b.get("time_label"),
                "default": bool(b.get("default")), "missions": len(b.get("unlocks") or []),
                "ingredients": [self._ing(i) for i in b.get("ingredients") or [] if i.get("name")],
                "returns": [self._ing(i) for i in b.get("returns") or [] if i.get("name")],
                "web_url": None, "item_url": None, "version": None, "source": "game"}

    def listing(self):
        """Every blueprint, trimmed (made once per file)."""
        if self._list is None:
            L = [self.trimmed(uid, b) for uid, b in self.items.items() if b.get("name")]
            L.sort(key=lambda x: x["name"].lower())
            self._list = L
        return self._list

    def detail(self, uid, contracts=None):
        """One blueprint with the contracts that unlock it, in gear.Gear.blueprint()'s shape. contracts: the
        Contracts file, for each contract's title (the code is what the mission pages are found by)."""
        b = self.items.get(uid) or self.items.get(self._by_out.get(str(uid or "").lower(), ""))
        if not b:
            return None
        out = self.trimmed(uid if uid in self.items else self._by_out[str(uid).lower()], b)
        unlocks = []
        for u in b.get("unlocks") or []:
            c = contracts.find(u.get("code"))[1] if contracts and u.get("code") else None
            unlocks.append({"title": (c or {}).get("title") or u.get("code"), "scope": None, "chance": u.get("chance"),
                            "web_url": None, "code": u.get("code"), "ref": None})
        out["unlocks"] = unlocks
        return out


class GameFiles:
    """The data files together. dirs: where copies may be, newest first is not needed (newest wins)."""

    def __init__(self, *dirs):
        p = lambda name: [Path(d) / name for d in dirs]
        self.contracts = Contracts(*p("contracts_data.json"))
        self.gear = Gear(*p("gear_data.json"))
        self.vehicles = Vehicles(*p("vehicles_data.json"))
        self.blueprints = Blueprints(*p("blueprints_data.json"))

    def update_from(self, name, path):
        f = {"contracts_data.json": self.contracts, "gear_data.json": self.gear,
             "vehicles_data.json": self.vehicles, "blueprints_data.json": self.blueprints}.get(name)
        return bool(f and f.update_from(path))
