"""Api, part of: Shops, vehicles and components, wiki text and pictures, and pictures Quantum users send.

A mixin of app.py's Api (class Api(... CatalogMixin ...)): the methods are the Api's, `self` is the one Api.
Module-level names come from qbase.py."""
from qbase import *  # noqa: F401,F403


class CatalogMixin:
    # ---- What a place's shops sell (armor, clothing, weapons, ship weapons and parts, food, medical…), for the
    # windows the service tiles on a place's card open. From UEX's item prices at every terminal (one cached
    # request), sorted into groups by each item's UEX category.
    SHOP_GROUPS = (("armor", "Armor"), ("clothing", "Clothing"), ("weapons", "Personal weapons"),
                   ("gadgets", "Gadgets and tools"), ("shipweapons", "Ship weapons"), ("components", "Ship components"),
                   ("food", "Food and drink"), ("medical", "Medical"), ("rentals", "Vehicle rentals"), ("paints", "Paints"),
                   ("other", "Other"))

    @staticmethod
    def _shop_group(cat):
        """Which SHOP_GROUPS group a UEX item category goes in, from its section and name."""
        sec = str((cat or {}).get("section") or "").lower()
        nm = str((cat or {}).get("name") or "").lower()
        txt = f"{sec} {nm}"
        has = lambda *w: any(x in txt for x in w)
        if has("livery", "liveries", "paint", "skin"):
            return "paints"
        if has("food", "drink", "beverage", "snack", "meal"):
            return "food"
        if has("medic", "medpen", "health", "first aid", "hemozal", "oxypen"):
            return "medical"
        if has("vehicle", "ship") or sec in ("systems", "components"):
            if has("weapon", "gun", "missile", "turret", "torpedo", "bomb", "cannon", "repeater", "scattergun", "rack", "mount"):
                return "shipweapons"
            return "components"
        if has("cooler", "power plant", "quantum drive", "shield generator", "jump module", "jump drive", "radar",
               "mining laser", "mining module", "salvage", "tractor beam"):
            return "components"
        if has("missile", "torpedo", "bomb", "turret"):
            return "shipweapons"
        if has("armor", "armour", "undersuit", "helmet", "backpack", "torso", "core"):
            return "armor"
        if has("cloth", "jacket", "shirt", "pants", "legwear", "footwear", "shoe", "boot", "glove", "hat", "jumpsuit",
               "eyewear", "glasses", "outerwear"):
            return "clothing"
        if has("weapon", "pistol", "rifle", "smg", "shotgun", "lmg", "sniper", "launcher", "knife", "knives", "grenade",
               "magazine", "ammo", "attachment", "optic", "barrel", "underbarrel"):
            return "weapons"
        if has("gadget", "tool", "multi-tool", "utility", "flair", "decoration", "mining"):
            return "gadgets"
        return "other"

    def _shop_rows(self):
        """Every item for sale at a terminal on the map: [(place, terminal, row, group)], newest price per item
        and terminal. Cached with UEX's prices."""
        rows, at = self._uex.get("items_prices_all")
        c = getattr(self, "_shop_cache", None)
        if c and c[0] == at:
            return c[1], at
        terms = self._uex.terminals()
        places = self._uex.place_map(self._db.locations)
        cats = {c_["id"]: c_ for c_ in self._uex.get("categories")[0]}
        best = {}
        for r in rows:
            t = terms.get(r.get("id_terminal"))
            place = places.get(r.get("id_terminal"))
            if not t or not place or not (r.get("price_buy") or 0) > 0 or not uex.is_live(t):
                continue
            key = (r.get("id_item"), r.get("id_terminal"))
            prev = best.get(key)
            if prev and _num_or0(prev[2].get("date_modified")) >= _num_or0(r.get("date_modified")):
                continue
            best[key] = (place, t, r, self._shop_group(cats.get(r.get("id_category"))))
        out = list(best.values())
        self._shop_cache = (at, out)
        return out, at

    def _rental_rows(self):
        """Every vehicle for rent at a terminal on the map: [(place, terminal, row, vehicle)], newest price per
        vehicle and terminal. UEX's rental price is for one day."""
        rows, at = self._uex.get("vehicles_rentals_prices_all")
        c = getattr(self, "_rent_cache", None)
        if c and c[0] == at:
            return c[1], at
        terms = self._uex.terminals()
        places = self._uex.place_map(self._db.locations)
        vehicles = {v["id"]: v for v in with_extra_vehicles(self._uex.get("vehicles")[0])}
        best = {}
        for r in rows:
            t = terms.get(r.get("id_terminal"))
            place = places.get(r.get("id_terminal"))
            price = next((r[k] for k in ("price_rent", "price", "price_buy") if r.get(k)), None)
            if not t or not place or not price or not uex.is_live(t):
                continue
            key = (r.get("id_vehicle"), r.get("id_terminal"))
            prev = best.get(key)
            if prev and _num_or0(prev[2].get("date_modified")) >= _num_or0(r.get("date_modified")):
                continue
            best[key] = (place, t, dict(r, _price=price), vehicles.get(r.get("id_vehicle")) or {})
        out = list(best.values())
        self._rent_cache = (at, out)
        return out, at

    def _rental_item(self, r, v):
        name = v.get("name_full") or v.get("name") or r.get("vehicle_name") or f"#{r.get('id_vehicle')}"
        return {"name": name, "id": r.get("id_vehicle"), "vid": v.get("id") or r.get("id_vehicle"), "price": r["_price"],
                "per": "day", "at": _num_or0(r.get("date_modified")) or None, "group": "rentals",
                "category": "Ground vehicle" if v.get("is_ground_vehicle") else "Ship",
                "maker": v.get("company_name") or "", "photo": self._vehicle_photo(v) if v else None,
                "scu": v.get("scu") or 0, "crew": v.get("crew") or "", "pad": v.get("pad_type")}

    def uex_shop_places(self):
        """For each place on the map, the groups of things its shops sell: {ok, places: {place: [group]}}."""
        def run():
            rows, _ = self._shop_rows()
            out = {}
            for place, _t, _r, g in rows:
                out.setdefault(place, set()).add(g)
            try:
                for place, _t, _r, _v in self._rental_rows()[0]:
                    out.setdefault(place, set()).add("rentals")
            except uex.UexError:
                pass
            # Fuel, for search ("hydrogen", "quantum fuel"): which kinds UEX lists at each place
            fuel = {}
            try:
                places = self._uex.place_map(self._db.locations)
                for r in self._uex.get("fuel_prices_all")[0]:
                    pl = places.get(r.get("id_terminal"))
                    nm = str(r.get("commodity_name") or "").lower()
                    if pl and r.get("price_buy"):
                        kind = "hydrogen" if "hydrogen" in nm else "quantum" if "quantum" in nm else None
                        if kind:
                            fuel.setdefault(pl, set()).add(kind)
            except uex.UexError:
                pass
            return {"ok": True, "places": {p: sorted(g) for p, g in out.items()},
                    "groups": [list(x) for x in self.SHOP_GROUPS], "fuel": {p: sorted(k) for p, k in fuel.items()}}
        return self._uex_call(run)

    def uex_place_shop(self, place):
        """What every shop at a place sells, with price, category and when the price was reported:
        {ok, place, shops: [{name, id, updated, items: [{name, id, price, at, group, category}]}], groups, at}."""
        def run():
            rows, at = self._shop_rows()
            cats = {c_["id"]: c_ for c_ in self._uex.get("categories")[0]}
            shops = {}
            for p, t, r, g in rows:
                if p != place:
                    continue
                s = shops.setdefault(t["id"], {"id": t["id"], "name": self._shop_name(r.get("terminal_name") or t.get("name"), uex.where(t)) or t.get("name"),
                                                "terminal": t.get("name"), "items": []})
                cat = cats.get(r.get("id_category")) or {}
                s["items"].append({"name": r.get("item_name") or f"#{r.get('id_item')}", "id": r.get("id_item"),
                                   "uuid": r.get("item_uuid"), "price": r["price_buy"], "at": _num_or0(r.get("date_modified")) or None,
                                   "group": g, "category": cat.get("name") or "", "section": cat.get("section") or "",
                                   "cat": r.get("id_category")})
            try:                                     # vehicles for rent, as the rental desk's own shop
                rent = self._rental_rows()[0]
            except uex.UexError:
                rent = []
            for p, t, r, v in rent:
                if p != place:
                    continue
                s = shops.setdefault(t["id"], {"id": t["id"], "name": self._shop_name(r.get("terminal_name") or t.get("name"), uex.where(t)) or t.get("name"),
                                                "terminal": t.get("name"), "items": []})
                s["items"].append(self._rental_item(r, v))
            res = []
            for s in shops.values():
                s["items"].sort(key=lambda i: i["name"].lower())
                dates = [i["at"] for i in s["items"] if i["at"]]
                s["updated"] = max(dates) if dates else None
                s["oldest"] = min(dates) if dates else None
                res.append(s)
            res.sort(key=lambda s: s["name"].lower())
            return {"ok": True, "place": place, "shops": res, "groups": [list(x) for x in self.SHOP_GROUPS], "at": at}
        return self._uex_call(run)

    def uex_vehicles(self):
        """Every ship and ground vehicle, with where to buy and rent it in game and for how much."""
        def run():
            vehicles, at = self._uex.get("vehicles")
            vehicles = with_extra_vehicles(vehicles)
            terms = self._uex.terminals()
            places = self._uex.place_map(self._db.locations)
            spots = {}

            def add(kind, rows, price_keys):
                for r in rows:
                    t = terms.get(r.get("id_terminal"))
                    price = next((r[k] for k in price_keys if r.get(k)), None)
                    if not t or not price:
                        continue
                    place = places.get(r["id_terminal"])
                    spots.setdefault(r.get("id_vehicle"), {"buy": [], "rent": []})[kind].append({
                        "where": uex.where(t), "place": place, "system": t.get("star_system_name"),
                        "price": price, "dist": self._dist_from_you(place), "updated": r.get("date_modified")})
            add("buy", self._uex.get("vehicles_purchases_prices_all")[0], ("price_buy",))
            add("rent", self._uex.get("vehicles_rentals_prices_all")[0], ("price_rent", "price", "price_buy"))
            roles = VEHICLE_ROLES
            wiki = self._wikiapi.vehicle_summary(wait=True)    # medical beds and cargo grid, from the wiki
            try:                       # wiki pictures for ships UEX has none for, asked for in one go
                self._wikiapi.pictures([r for v in vehicles if not v.get("url_photo")
                                        for r in (v.get("wiki_page"), v.get("name_full"), v.get("name")) if r], size=720)
            except Exception:
                pass
            out = []
            for v in vehicles:
                # Concepts are shown too (flagged), so a ship you've pledged for, like a new Constellation
                # Mk V, can be looked up; add-on modules that aren't ships stay out.
                if not listed_vehicle(v, wiki) and not (is_concept(v, wiki) and not v.get("is_addon")):
                    continue
                sp = spots.get(v["id"], {"buy": [], "rent": []})
                for k in ("buy", "rent"):
                    sp[k].sort(key=lambda x: x["price"])
                out.append({
                    "id": v["id"], "name": v.get("name"), "full": v.get("name_full") or v.get("name"),
                    "maker": v.get("company_name") or "", "scu": v.get("scu") or 0, "crew": v.get("crew") or "",
                    "pad": v.get("pad_type"), "ground": bool(v.get("is_ground_vehicle")),
                    "roles": self._vehicle_roles(v, wiki),
                    "qfuel": v.get("fuel_quantum"), "hfuel": v.get("fuel_hydrogen"),
                    "addon": bool(v.get("is_addon")), "concept": is_concept(v, wiki), "aka": vehicle_aka(v),
                    "store": store_url(v), "photo": self._vehicle_photo(v), "buy": sp["buy"], "rent": sp["rent"]})
            out.sort(key=lambda v: (v["buy"][0]["price"] if v["buy"] else 9e12, v["full"]))
            return {"ok": True, "vehicles": out, "at": at}
        return self._uex_call(run)

    CARGO_MIN = 40          # SCU of cargo grid that makes a ship a cargo hauler too (Cutlass Black 46, Carrack 456)

    def _vehicle_roles(self, v, wiki):
        """UEX's roles, plus what the ship can actually do: Medical when it has a medical bed, Cargo when it
        has a real cargo grid (from the wiki's numbers when it has them, else UEX's SCU)."""
        out = []
        for _, label in VEHICLE_ROLES:
            if label not in out and any(v.get(f) for f, l in VEHICLE_ROLES if l == label):
                out.append(label)
        w = next((wiki[str(k).lower()] for k in (v.get("uuid"), v.get("name"), v.get("slug"), v.get("name_full"))
                  if k and str(k).lower() in wiki), None) or {}
        if not v.get("is_ground_vehicle"):
            if w.get("medical_beds") and "Medical" not in out:
                out.append("Medical")
            cargo = w.get("cargo") if w else v.get("scu")
            if (cargo or 0) >= self.CARGO_MIN and "Cargo" not in out:
                out.insert(0, "Cargo")
        return out

    def wiki_image(self, ref):
        """The picture for an item page: one you (the server owner) put in its place, else the wiki's,
        else one a Quantum user sent in and you approved."""
        key = self._pic_key(ref)
        over = self._community.photo_overrides().get(key)
        return over or self._wiki_image(ref) or self._community.photos().get(key) or \
            self._part_images.get(str(ref or "").lower())

    # Map markers the wiki has no page of their own for: caves, orbital markers, comm arrays, numbered
    # derelicts, microTech's animal areas (else "Area 18" would show ArcCorp's city) and the game's internal ids ("Stanton1c_rock01_unoc_..."). Not asked about at all.
    # Wrecks are skipped too: "Freelancer C Wreck" could land on the ship's own page and show the ship.
    PLACE_NO_PAGE = re.compile(r"_|\bcave\b|\bwreck|spawn point|^(?:OM-\d|derelict outpost\b|comm array\b|"
                               r"river #|unknown\b|colonial outpost xs\b|mining claim\b|escort asteroid\b|animal area\b)", re.I)

    def place_image(self, name, page=None):
        """A photo of a place or body for its info card, from its Star Citizen Wiki page:
        {ok, url, page} (url None when the wiki has none). page: the wiki page we already know for it
        (planets and moons); else the place's name is tried as Quantum spells it, then without the tags
        on the end ("HDES Calthrope (NA) [F]" -> "HDES Calthrope"). The wiki follows its own redirects
        ("CRU-L5" -> "CRU-L5 Beautiful Glen Station"). Rest stops: the wiki leaves off the "R&R" Quantum
        puts in front ("R&R HUR-L1 Green Glade Station" is "HUR-L1 Green Glade Station" there), so the name
        the wiki data matched for the place (its services record) is tried too, and its own picture is the
        last resort. A picture you (the server owner) put in place of the wiki's comes first."""
        name = str(name or "").strip()
        if not name and not page:
            return {"ok": True, "url": None}
        ovr = self._community.photo_overrides()
        over = next((ovr[k] for k in (self._pic_key(x) for x in [page or name, *([] if page else self._old_names(name))]) if ovr.get(k)), None)
        if over:
            return {"ok": True, "url": over, "page": wiki.page_url(fleet.title_of(page)) if page else None}
        cands = [page] if page else []
        rec = (self._services.get(name) or {}) if name and not page else {}
        if name and not self.PLACE_NO_PAGE.search(name):
            cands.append(name)
            if rec.get("name"):
                cands.append(rec["name"])                      # the wiki's own spelling of it
            bare = re.sub(r"^R\s*(?:&|and)\s*R\s+", "", name, flags=re.I)
            if bare != name:
                cands.append(bare)
            short = name
            for _ in range(3):                                 # trailing "(…)" / "[…]" tags, one at a time
                short = re.sub(r"\s*[\(\[][^\)\]]*[\)\]]\s*$", "", short).strip()
            if short and short != name:
                cands.append(short)
        cands = list(dict.fromkeys(c for c in cands if c))
        fallback = {"ok": True, "url": rec.get("image") or None,
                    "page": (wiki.page_url(rec["name"]) if rec.get("image") and rec.get("name") else None)}
        if not cands:
            return fallback
        try:
            got = self._wikiapi.pictures(cands, size=720, any_page=True)
        except Exception:
            return fallback if fallback["url"] else {"ok": False, "url": None}
        for c in cands:
            if got.get(c):
                return {"ok": True, "url": got[c], "page": wiki.page_url(fleet.title_of(c))}
        return fallback

    def _wiki_image(self, ref):
        """Picture for an item from the Star Citizen Wiki (its page's main image), cached. ref is the
        wiki URL UEX gives, or a page title. A page about armour or clothing (a name a ship part shares)
        counts as no picture."""
        if not ref:
            return None
        try:
            return self._wikiapi.pictures([ref], size=720).get(ref)
        except Exception:
            return None

    def _item_spots(self):
        """id_item -> where it's sold, cheapest first."""
        terms = self._uex.terminals()
        places = self._uex.place_map(self._db.locations)
        spots, by_term = {}, {}
        for r in self._uex.get("items_prices_all")[0]:
            t = terms.get(r.get("id_terminal"))
            if not t or not r.get("price_buy"):
                continue
            # UEX can hold more than one price for the same item at the same terminal (an old report next to
            # a newer one): keep only the newest, so a shop isn't listed twice at two prices.
            key = (r["id_item"], r["id_terminal"])
            prev = by_term.get(key)
            if prev is not None and str(prev["updated"] or "") >= str(r.get("date_modified") or ""):
                continue
            place = places.get(r["id_terminal"])
            row = {"where": uex.where(t), "shop": self._shop_name(r.get("terminal_name") or t.get("name"), uex.where(t)),
                   "place": place, "system": t.get("star_system_name"), "price": r["price_buy"],
                   "dist": self._dist_from_you(place), "updated": r.get("date_modified")}
            lst = spots.setdefault(r["id_item"], [])
            if prev is not None:
                lst.remove(prev)
            lst.append(row)
            by_term[key] = row
        for v in spots.values():
            v.sort(key=lambda x: x["price"])
        return spots

    @staticmethod
    def _shop_name(terminal, where):
        """The shop part of a UEX terminal name ("Centermass - Area 18" -> "Centermass"), so two shops in
        one city can be told apart in "Where to buy"."""
        t = str(terminal or "").strip()
        if not t:
            return None
        city = (where or "").split(",")[0].strip().lower()
        parts = [x.strip() for x in re.split(r"\s+-\s+", t) if x.strip()]
        keep = [x for x in parts if x.lower() != city and x.lower() not in (where or "").lower()]
        return " - ".join(keep) or t

    COMPONENT_HINTS = ("vehicle", "ship", "cooler", "power plant", "quantum drive", "shield generator", "missile",
                       "turret", "mining laser", "mining module", "gadget", "salvage", "tractor", "radar", "bomb",
                       "jump module", "jump drive")
    COMPONENT_SKIP = ("clothing", "armor", "undersuit", "jumpsuit", "helmet", "personal", "fps", "food", "drink",
                      "medical", "tool", "decoration", "flair", "paint", "livery", "utility")

    # Categories UEX lists that hold no ship components (whole ships are on the Vehicles tab)
    COMPONENT_EMPTY = ("vehicle",)

    # Parts UEX doesn't list yet (new ones like the RSI Discovery's cooler, power plants and radar, the
    # Helix mining lasers, flight blades) come from the Star Citizen Wiki, which reads the game files:
    # (words in a UEX category's name, the wiki's item type, a test on the part's class name or None).
    # Kinds UEX has no category for at all get one of their own (WIKI_ONLY).
    WIKI_KINDS = (("mining laser", "WeaponMining", None),
                  ("flight blade", "FlightController", r"_blade_(spd|hnd)$|_flight_blade_(spd|hnd)$"),
                  ("cooler", "Cooler", None), ("power plant", "PowerPlant", None), ("radar", "Radar", None),
                  ("quantum drive", "QuantumDrive", None), ("shield", "Shield", None))
    WIKI_ONLY = {"WeaponMining": ("Mining Lasers", "Mining"), "FlightController": ("Flight Blades", "Systems")}

    @classmethod
    def _wiki_kind(cls, category_name):
        nm = (category_name or "").lower()
        if any(k in nm for k in ("rack", "turret", "module", "gadget", "mount")) and "mining laser" not in nm:
            return None
        return next(((t, test) for words, t, test in cls.WIKI_KINDS if words in nm), None)

    @staticmethod
    def _blade_ship(class_name):
        """'controller_flight_aegs_gladius_blade_spd' -> ('Aegis Gladius', 'Speed')."""
        m = re.match(r"(?i)controller_flight_([a-z]{4})_(.+?)_(?:flight_)?blade_(spd|hnd)$", class_name or "")
        if not m:
            return None, None
        maker = gamelog.MAKERS.get(m.group(1).upper(), m.group(1).upper())
        ship = " ".join(w.capitalize() if not re.match(r"^[a-z]?\d", w) else w.upper() for w in m.group(2).split("_"))
        return f"{maker} {ship}", {"spd": "Speed", "hnd": "Handling"}[m.group(3).lower()]

    def _wiki_parts(self, wtype, test=None):
        """The wiki's parts of one kind, as Components-tab rows (no UEX id; the uuid is the id)."""
        try:
            raw = self._wikiapi.items_of_type(wtype)
        except Exception:
            return []
        terms = places = None
        out = []
        for d in raw:
            if not d.get("name") or (test and not re.search(test, d.get("class_name") or "", re.I)):
                continue
            if wtype != "FlightController" and re.search(r"(?i)\b(test|template|placeholder)\b|_ai_|_npc", f"{d.get('class_name')} {d['name']}"):
                continue
            name, vehicle = d["name"], None
            if wtype == "FlightController":
                vehicle, kind = self._blade_ship(d.get("class_name"))
                if vehicle and "blade" in name.lower() and vehicle.split(" ", 1)[-1].lower() not in name.lower():
                    name = f"{vehicle.split(' ', 1)[-1]} {kind} Flight Blade"
            buy = []
            if d.get("prices"):
                if terms is None:
                    try:
                        terms, places = self._uex.terminals(), self._uex.place_map(self._db.locations)
                    except Exception:
                        terms, places = {}, {}
                for p in d["prices"]:
                    t = terms.get(p.get("terminal_id"))
                    place = places.get(p.get("terminal_id"))
                    buy.append({"where": uex.where(t) if t else (p.get("where") or p.get("terminal") or ""),
                                "shop": p.get("terminal"), "place": place, "system": p.get("system"),
                                "price": p["price"], "dist": self._dist_from_you(place), "updated": p.get("updated")})
                buy.sort(key=lambda x: x["price"])
            size = d.get("size")
            game = self._game_view(d.get("uuid"), d["name"], size)
            ref = name                                         # its Star Citizen Wiki page title
            if d.get("image"):
                self._part_images[ref.lower()] = d["image"]     # the wiki API's own picture, if the page has none
            out.append({"id": d.get("uuid") or name, "name": name, "maker": d.get("maker") or "",
                        "size": None if str(size if size is not None else "").strip() in ("", "0") and wtype != "WeaponMining"
                        else size, "grade": d.get("grade"), "category": None, "vehicle": vehicle,
                        "wiki": ref, "web_url": d.get("web_url"), "store": None, "exclusive": False,
                        "note": "From the Star Citizen Wiki (game files): UEX doesn't list it yet, so shop prices may be missing.",
                        "buy": buy, "uuid": d.get("uuid"), "source": "wiki", "image": d.get("image"),
                        "game": game or ({"maker": d.get("maker"), "grade": d.get("grade"), "class": d.get("class"),
                                          "size": size, "stats": {}} if d.get("stats") else None),
                        "extra": d.get("stats") or []})
        return out

    def _with_wiki_parts(self, rows, category_name, cat_id=None, index=False):
        """UEX's parts for a category plus the wiki's ones UEX doesn't have (matched by uuid or name)."""
        kind = self._wiki_kind(category_name)
        if not kind:
            return rows
        have = {(r.get("uuid") or "").lower() for r in rows} | {(r.get("name") or "").lower() for r in rows}
        for w in self._wiki_parts(*kind):
            if (w.get("uuid") or "").lower() in have or w["name"].lower() in have:
                continue
            have.add(w["name"].lower())
            if index:
                rows.append({"id": w["id"], "name": w["name"], "maker": w["maker"], "size": w["size"], "grade": w["grade"],
                             "cat": cat_id, "cat_name": category_name, "wiki": w["wiki"]})
            else:
                rows.append(w)
        return rows

    @staticmethod
    def _slot_type_for(category):
        """The My Fleet slot type a UEX component category fits ("Coolers" -> "Cooler"), or None."""
        nm = (category or "").lower()
        if "jump" in nm:                                  # "Jump Modules": a module, but one you fit like a part
            return "JumpDrive"
        if "missile rack" in nm or "missile launcher" in nm:
            return "MissileLauncher"
        if any(k in nm for k in ("rack", "turret", "module", "gadget", "mount", "gimbal", "attachment")):
            return None
        for typ, (_, words) in fleet.SLOT_TYPES.items():
            if any(w in nm for w in words):
                return typ
        return None

    def component_fit_targets(self, category):
        """For the Components tab's "Fit to a ship": every ship in My Fleet with its slots of the kind
        this category fits, and what's in each now (your swap, else stock)."""
        slot = self._slot_type_for(category)
        if not slot:
            return {"ok": True, "slot": None, "ships": []}
        return self._uex_call(lambda: self._fit_targets(slot))

    def _fit_targets(self, slot):
        rows = self._vehicle_rows()
        fl = list(self._fleet())

        def one(f):
            v = rows.get(f["vehicle_id"], {})
            name = v.get("name") or f["name"]
            out = {"uid": f["uid"], "name": v.get("name_full") or f["name"], "main": bool(f.get("main")),
                   "photo": self._vehicle_photo(v), "slots": []}
            try:
                data = self._wikiapi.vehicle([v.get("uuid"), name, v.get("slug"), name.lower().replace(" ", "-"),
                                              v.get("name_full")])
            except Exception:
                data = None
            if not data:
                out["error"] = "The Star Citizen Wiki has no loadout for this ship (or it can't be reached)"
                return out
            fitted = self._loadout_of(f, "primary")["loadout"]       # the Components tab fits your primary loadout
            lo_ = fleet.Wiki.loadout(data)
            self._apply_rack_swaps(lo_, fitted)
            for s_ in lo_["slots"]:
                if s_["type"] != slot:
                    continue
                fit = fitted.get(s_["port"])
                fit = {"name": fit} if isinstance(fit, str) else fit
                out["slots"].append({"port": s_["port"], "label": s_["label"], "size": s_.get("size"),
                                     "where": s_.get("where") or "", "stock": (s_.get("stock") or {}).get("name"),
                                     "fitted": fit["name"] if fit else None})
            return out
        from concurrent.futures import ThreadPoolExecutor
        with ThreadPoolExecutor(max_workers=6) as ex:
            ships = list(ex.map(one, fl))
        return {"ok": True, "slot": slot, "label": fleet.SLOT_TYPES[slot][0], "ships": ships}

    def _aka(self, uuid, name, size=None, g=None):
        """Another name a part goes by, for search: the game files' full name when it differs from UEX's,
        which carries the nickname ("SW16BR3 Repeater" is the SW16BR3 “Shredder” Repeater in game, so a
        search for shredder finds it). Matched by uuid, else name, else the model code ("SW16BR3")."""
        try:
            sz = int(size) if str(size or "").strip() not in ("", "0") else None
        except (TypeError, ValueError):
            sz = None
        g = g or self._game.find(uuid, name, sz)
        if not g:
            code = next((w for w in re.findall(r"[A-Za-z0-9-]+", name or "") if re.search(r"\d", w) and re.search(r"[A-Za-z]", w)
                         and len(w) >= 4), None)
            if code:
                if not hasattr(self, "_game_codes"):
                    self._game_codes = {}
                    for it in self._game.items.values():
                        for w in re.findall(r"[A-Za-z0-9-]+", it.get("name") or ""):
                            if re.search(r"\d", w) and re.search(r"[A-Za-z]", w) and len(w) >= 4:
                                self._game_codes.setdefault(w.lower(), it)
                g = self._game_codes.get(code.lower())
        gn = (g or {}).get("name") or ""
        if not gn or gn.lower() == str(name or "").lower():
            return ""
        nick = re.findall(r"[“”\"']([^“”\"']{3,})[“”\"']", gn)
        return " ".join([gn] + nick)

    def _game_view(self, uuid, name, size):
        """A component's numbers from the game files, for its detail page."""
        try:
            sz = int(size) if str(size or "").strip() not in ("", "0") else None
        except ValueError:
            sz = None
        g = self._game.find(uuid, name, sz)
        if not g:
            return None
        st = dict(g.get("stats") or {})
        pw = g.get("power") or {}
        for k in ("power_use", "power_min", "coolant_make", "power_make"):
            if pw.get(k) is not None:
                st[k] = pw[k]
        return {"type": g.get("type"), "class": g.get("class"), "grade": g.get("grade"), "size": g.get("size"),
                "maker": g.get("maker"), "stats": st}

    # Game-file parts that aren't real, buyable components: AI and test parts, and ones with no proper name.
    GAME_JUNK = re.compile(r"(?i)\b(test|template|placeholder|dummy|unused|npc|ai)\b|_|^\s*$")

    def _game_only_parts(self, slot, have):
        """Parts of one kind from the game files (component_stats.json) whose name or uuid isn't in have:
        new parts (an event's rewards) show as soon as the game data has them, before UEX or the wiki do."""
        def norm(n):                      # "RSI Medusa Cannon" / "Medusa" / "medusa-cannon" are one part
            w = re.findall(r"[a-z0-9]+", str(n or "").lower())
            return " ".join(x for x in w if x not in self.NAME_NOISE)
        out, seen = [], {str(h).lower() for h in have if h}
        seen |= {norm(h) for h in seen}
        for g in self._game.of_kind(slot, None):
            nm = (g.get("name") or "").strip()
            if not nm or self.GAME_JUNK.search(nm) or not g.get("maker") or g.get("maker") == "Unknown":
                continue
            if nm.lower() in seen or norm(nm) in seen or str(g.get("uuid") or "").lower() in seen:
                continue
            seen |= {nm.lower(), norm(nm)}
            out.append(g)
        return out

    # Words that don't tell two parts apart, for matching game-file names to UEX's and the wiki's.
    NAME_NOISE = {"rsi", "cannon", "repeater", "gatling", "scattergun", "beam", "laser", "ballistic", "distortion",
                  "neutron", "cooler", "shield", "generator", "power", "plant", "quantum", "drive", "radar", "s1",
                  "s2", "s3", "s4", "s5", "s6", "s7", "s8", "the"}

    def uex_component_categories(self):
        """Ship upgrade categories: coolers, power plants, quantum drives, shields, weapons, mining…"""
        def run():
            rows, _ = self._uex.get("categories")
            items = [c for c in rows if (c.get("type") or "item") == "item"]
            def txt(c):
                return f"{c.get('section') or ''} {c.get('name') or ''}".lower()
            pick = [c for c in items if any(h in txt(c) for h in self.COMPONENT_HINTS)
                    and not any(k in txt(c) for k in self.COMPONENT_SKIP)
                    and (c.get("name") or "").strip().lower().rstrip("s") not in self.COMPONENT_EMPTY] or items
            out = [{"id": c["id"], "name": c.get("name"), "section": c.get("section") or "Other",
                    "slot": self._slot_type_for(c.get("name"))} for c in pick]
            for wtype, (label, section) in self.WIKI_ONLY.items():      # kinds UEX has no category for
                if not any((self._wiki_kind(c["name"]) or (None,))[0] == wtype for c in out):
                    out.append({"id": f"wiki:{wtype}", "name": label, "section": section, "slot": None, "wiki": True})
            out.sort(key=lambda c: (c["section"], c["name"] or ""))
            return {"ok": True, "items": out}
        return self._uex_call(run)

    # Ship guns by how they fire, for the Components tab: (id, label, words in the name). Checked in this
    # order, so "Distortion Repeater" is a distortion weapon and "Scattergun" isn't a plain gun.
    WEAPON_TYPES = (("distortion", "Distortion", ("distortion",)), ("scattergun", "Scatterguns", ("scattergun", "scatter gun")),
                    ("gatling", "Gatlings", ("gatling",)), ("repeater", "Repeaters", ("repeater",)),
                    ("cannon", "Cannons", ("cannon",)), ("beam", "Beams", ("beam",)),
                    ("massdriver", "Mass drivers", ("mass driver", "railgun", "rail gun")))

    @classmethod
    def weapon_type(cls, name, game=None):
        """A ship gun's kind (see WEAPON_TYPES), from its name and the game files' numbers; "other" when
        neither says (a few named guns, like the Jericho)."""
        n = (name or "").lower()
        st = (game or {}).get("stats") or {}
        dmg = str(st.get("damage_type") or "").lower()
        if dmg == "distortion":
            return "distortion"
        for key, _, words in cls.WEAPON_TYPES:
            if any(w in n for w in words):
                return key
        if dmg == "beam":
            return "beam"
        rpm = st.get("rpm") or 0
        if rpm >= 900:                                   # very fast fire: a gatling if ballistic, else a repeater
            return "gatling" if dmg == "physical" else "repeater"
        if 0 < rpm <= 200:
            return "cannon"
        return "other"

    def uex_component_index(self):
        """Every part in every component category, small enough to search all at once from the
        Components tab: name, maker, size, grade, its category and (for guns) what kind it is."""
        def run():
            cats = self.uex_component_categories()
            if not cats.get("ok"):
                return cats
            out, at = [], None
            for c in cats["items"]:
                if str(c["id"]).startswith("wiki:"):
                    rows = []
                else:
                    try:
                        rows, at = self._uex.get("items", {"id_category": int(c["id"])})
                    except uex.UexError:
                        continue
                n0 = len(out)
                for i in rows:
                    if i.get("is_commodity") or not i.get("name"):
                        continue
                    size = i.get("size")
                    row = {"id": i["id"], "name": i.get("name"), "maker": i.get("company_name") or "",
                           "size": None if str(size or "").strip() in ("", "0") else size, "grade": i.get("quality"),
                           "cat": c["id"], "cat_name": c.get("name"), "wiki": i.get("wiki"), "uuid": i.get("uuid"),
                           "aka": self._aka(i.get("uuid"), i.get("name"), size)}
                    if c.get("slot") == "WeaponGun":
                        try:
                            sz = int(size) if str(size or "").strip() not in ("", "0") else None
                        except ValueError:
                            sz = None
                        row["wtype"] = self.weapon_type(i.get("name"), self._game.find(i.get("uuid"), i.get("name"), sz))
                    out.append(row)
                mine = out[n0:]
                del out[n0:]
                out.extend(self._with_wiki_parts(mine, c.get("name") if not str(c["id"]).startswith("wiki:")
                                                 else ("flight blade" if "Flight" in c["id"] else "mining laser"),
                                                 c["id"], index=True))
                for r in out[n0:]:
                    r["cat_name"] = c.get("name")
                if c.get("slot"):                          # parts in the game files that UEX and the wiki don't list yet
                    have = {str(r.get(k) or "").lower() for r in out if r["cat"] == c["id"] for k in ("name", "uuid", "id")}
                    for g in self._game_only_parts(c["slot"], have):
                        row = {"id": g["uuid"], "name": g["name"], "maker": g.get("maker") or "", "size": g.get("size"),
                               "grade": g.get("grade"), "cat": c["id"], "cat_name": c.get("name"), "wiki": g["name"]}
                        if c["slot"] == "WeaponGun":
                            row["wtype"] = self.weapon_type(g["name"], g)
                        out.append(row)
            return {"ok": True, "items": out, "types": [[k, label] for k, label, _ in self.WEAPON_TYPES] + [["other", "Other guns"]],
                    "at": at}
        return self._uex_call(run)

    def uex_components(self, id_category):
        """Items in one category with where to buy them and for how much."""
        if str(id_category).startswith("wiki:"):            # a kind only the wiki has (flight blades...)
            wtype = str(id_category)[5:]
            test = next((t for _, w, t in self.WIKI_KINDS if w == wtype), None)
            items = self._wiki_parts(wtype, test)
            items.sort(key=lambda x: (x.get("vehicle") or "", str(x["size"] or ""), x["name"] or ""))
            if not items:
                return {"ok": False, "error": "Couldn't reach the Star Citizen Wiki for these parts. Try again in a minute"}
            return {"ok": True, "items": items, "at": None, "types": None}

        def run():
            rows, at = self._uex.get("items", {"id_category": int(id_category)})
            spots = self._item_spots()
            out = []
            for i in rows:
                if i.get("is_commodity"):
                    continue
                buy = spots.get(i["id"], [])
                size = i.get("size")
                out.append({"id": i["id"], "name": i.get("name"), "maker": i.get("company_name") or "",
                            "size": None if str(size or "").strip() in ("", "0") else size,
                            "grade": i.get("quality"), "category": i.get("category"),
                            "vehicle": i.get("vehicle_name"), "wiki": i.get("wiki"), "store": i.get("url_store"),
                            "exclusive": bool(i.get("is_exclusive_pledge") or i.get("is_exclusive_subscriber")
                                              or i.get("is_exclusive_concierge")),
                            "note": (i.get("notification") or None), "buy": buy,
                            "uuid": i.get("uuid"), "game": self._game_view(i.get("uuid"), i.get("name"), size),
                            "aka": self._aka(i.get("uuid"), i.get("name"), size)})
            cat_name = next((c.get("name") for c in self._uex.get("categories")[0]
                             if str(c.get("id")) == str(id_category)), "")
            slot = self._slot_type_for(cat_name)
            out = self._with_wiki_parts(out, cat_name)
            guns = slot == "WeaponGun"
            if slot:                                      # every part in the game files, even ones UEX and the wiki
                have = {(x.get("uuid") or "").lower() for x in out} | {(x["name"] or "").lower() for x in out}
                for g in self._game_only_parts(slot, have):   # don't list yet (new event parts, the Exfiltrate)
                    out.append({"id": g["uuid"], "name": g["name"], "maker": g.get("maker") or "", "size": g.get("size"),
                                "grade": g.get("grade"), "category": None, "vehicle": None, "wiki": g["name"], "store": None,
                                "exclusive": False, "buy": [], "uuid": g["uuid"], "source": "game",
                                "note": "From the game files: UEX and the Star Citizen Wiki don't list it yet, so shop prices may be missing.",
                                "game": self._game_view(g["uuid"], g["name"], g.get("size"))})
            if guns:
                for x in out:
                    x["wtype"] = self.weapon_type(x["name"], x["game"])
            if slot == "MissileLauncher":                 # racks aren't in the game-file numbers: what they hold, from the name
                for x in out:
                    spec = fleet.rack_spec(x["name"])
                    if spec.get("missiles") and not x.get("game"):
                        x["game"] = {"type": "MissileLauncher", "size": x.get("size"), "maker": x.get("maker"),
                                     "stats": {k: spec[k] for k in ("missiles", "missile_size") if k in spec}}
            out.sort(key=lambda x: (str(x["size"] or ""), x["buy"][0]["price"] if x["buy"] else 9e12, x["name"] or ""))
            return {"ok": True, "items": out, "at": at,
                    "types": [[k, label] for k, label, _ in self.WEAPON_TYPES] + [["other", "Other guns"]] if guns else None}
        return self._uex_call(run)

    def _vehicle_desc(self, d, name):
        """The ship's description: the wiki API's (it comes per language), else the wiki page's intro."""
        desc = d.get("description") if d else None
        if isinstance(desc, dict):
            desc = desc.get("en_EN") or desc.get("en") or next((v for v in desc.values() if isinstance(v, str) and v), None)
        if isinstance(desc, str) and desc.strip():
            return desc.strip()
        try:
            return self._wikiapi.summary(name)
        except Exception:
            return None

    def wiki_text(self, ref):
        """A commodity's (or anything's) description from its Star Citizen Wiki page."""
        try:
            return self._wikiapi.summary(ref)
        except Exception:
            return None

    def vehicle_detail(self, vehicle_id):
        """A ship's own page: crew and seats, beds and medical, cargo and storage, size, speed, quantum,
        defences and weapons, from the Star Citizen Wiki, with UEX's roles."""
        v = self._vehicle_rows().get(int(vehicle_id))
        if not v:
            return {"ok": False, "error": "Vehicle not found"}
        name = v.get("name") or ""
        d = self._wikiapi.vehicle([v.get("uuid"), name, v.get("slug"), name.lower().replace(" ", "-"),
                                   v.get("name_full"), v.get("wiki_page")]) or {}
        fb = v.get("fallback") or {}                 # a just-released ship's known numbers, until the wiki has them
        if fb:
            d = {**{k: fb[k] for k in ("career", "mass", "size_class") if fb.get(k)}, **d}
            if not (d.get("sizes") or d.get("dimension")):
                d["sizes"] = {k: fb[k] for k in ("length", "beam", "height") if fb.get(k)}
            if fb.get("crew_min") and not fleet._dig(d, "crew", "min"):
                d["crew"] = {**(d.get("crew") or {}), "min": fb["crew_min"]}
        g = lambda *path: fleet._dig(d, *path)
        seat = d.get("seating") or {}
        size = d.get("sizes") or d.get("dimension") or {}
        inv = d.get("vehicle_inventory")
        out = {
            "ok": True, "id": v["id"], "name": v.get("name_full") or name, "maker": v.get("company_name") or "",
            "photo": self._vehicle_photo(v), "store": store_url(v), "wiki": bool(d) and not (fb and set(d) <= {"career", "mass", "size_class", "sizes", "crew"}),
            "roles": self._vehicle_roles(v, self._wikiapi.vehicle_summary()),
            "career": d.get("career") or d.get("role"),
            "description": (self._vehicle_desc(d, v.get("name_full") or name) if d or not v.get("desc") else None) or v.get("desc"),
            "crew_min": g("crew", "min") or v.get("crew"), "crew_max": g("crew", "max"),
            "seats": seat.get("crew_stations"), "beds": seat.get("beds"), "medical_beds": _bed_count(seat.get("medical_beds")),
            "medical_tier": _tier(d.get("max_medical_tier")), "ejection": seat.get("ejection_seats"), "escape_pods": seat.get("escape_pods"),
            "jump_seats": seat.get("jump_seats"),
            "scu": v.get("scu") or d.get("cargo_capacity") or 0, "ore": d.get("ore_capacity"),
            "storage_scu": round(inv / 1e6, 2) if isinstance(inv, (int, float)) and inv else None,
            "lockers": g("weapon_storage", "slots_total"),
            "length": size.get("length"), "beam": size.get("beam") or size.get("width"), "height": size.get("height"),
            "mass": d.get("mass_total") or d.get("mass"), "pad": v.get("pad_type"), "size_class": d.get("size_class") or v.get("size"),
            "scm": g("speed", "scm"), "max": g("speed", "max"), "boost": g("speed", "boost_forward"),
            "pitch": g("agility", "pitch"), "yaw": g("agility", "yaw"), "roll": g("agility", "roll"),
            "qt_speed": g("quantum", "quantum_speed"), "qt_range": g("quantum", "quantum_range"),
            "qt_spool": g("quantum", "quantum_spool_time"), "h_fuel": g("fuel", "capacity") or v.get("fuel_hydrogen"),
            "q_fuel": g("quantum", "quantum_fuel_capacity") or v.get("fuel_quantum"),
            "shield": g("shield", "hp") or d.get("shield_hp"), "shield_face": g("shield", "face_type"),
            "hull": d.get("health"), "armor": g("armor", "health"), "dps": g("weaponry", "pilot_dps"),
            "missiles": g("weapon_snapshot", "missile_count"), "missile_dmg": g("weaponry", "total_missile_damage"),
            "turrets": (g("weapon_snapshot", "turrets_manned_count") or 0) + (g("weapon_snapshot", "turrets_remote_count") or 0),
            "countermeasures": g("weapon_snapshot", "countermeasures_count"),
            "ir": g("signature", "ir_shields") or g("emission", "ir"), "em": g("signature", "em_shields") or g("emission", "em_idle"),
            "cs": d.get("cross_section_max"), "claim": g("insurance", "claim_time"), "expedite": g("insurance", "expedite_time"),
            # A modular ship (the Galaxy): each module's cargo, beds and refinery, for the page's module picker
            "modules": ship_modules.module_options(v),
        }
        return out

    def _prefetch_assets(self):
        """Right from the first start: download what the Vehicles, My Fleet and Components tabs show into the
        cache in the background (manufacturer logos, the wiki's ship data, UEX's vehicle list and its
        pictures' addresses), so they're on screen as soon as a tab opens instead of after the first click."""
        time.sleep(3)                                       # let the window and map come up first
        for name, fn in (("logos", self._wikiapi.brand_logos),
                         ("wiki vehicles", lambda: self._wikiapi.vehicle_summary(wait=True))):
            try:
                fn()
            except Exception as e:
                print(f"prefetch {name}:", e, flush=True)
        if not self._uex.token:
            return
        try:
            r = self.uex_vehicles()
            refs = [v["photo"] for v in (r.get("vehicles") or []) if v.get("photo")]
            self._prefetched_photos = refs                  # the page warms its own image cache with these
        except Exception as e:
            print("prefetch vehicles:", e, flush=True)
        try:
            self.uex_component_categories()
        except Exception as e:
            print("prefetch components:", e, flush=True)

    def prefetch_photos(self):
        """Vehicle pictures to download into the page's cache early (empty until the background prefetch is done)."""
        return list(getattr(self, "_prefetched_photos", None) or [])

    def brand_logos(self):
        """The Star Citizen Wiki's manufacturer icons, for the Vehicles tab."""
        try:
            return {"ok": True, "logos": self._wikiapi.brand_logos()}
        except Exception as e:
            return {"ok": False, "logos": {}, "error": str(e)}

    def maker_logos(self, makers):
        """Logos for the makers of personal gear (armor, weapons, gadgets, clothing…), which the ship and
        component logo lists don't have: {ok, logos: {"cmp:<maker>": data URL}}. makers: [{name, code}]."""
        try:
            return {"ok": True, "logos": self._wikiapi.maker_logos(makers)}
        except Exception as e:
            return {"ok": False, "logos": {}, "error": str(e)}

    def wiki_images(self, refs):
        """{ref: picture url} for many wiki pages at once (commodity and component grids). Pictures you
        (the server owner) put in place of the wiki's come first; ones Quantum users sent in (and you
        approved) fill the gaps."""
        refs = list(refs or [])
        got = self._wikiapi.pictures(refs)
        mine, over = self._community.photos(), self._community.photo_overrides()
        for ref in refs:
            k = self._pic_key(ref)
            if over.get(k):
                got[ref] = over[k]
            elif not got.get(ref) and mine.get(k):
                got[ref] = mine[k]
            elif not got.get(ref) and self._part_images.get(str(ref).lower()):
                got[ref] = self._part_images[str(ref).lower()]   # parts from the wiki API (mining lasers, blades)
        return got

    def _vehicle_photo(self, v):
        """UEX's picture of a vehicle, or else one a Quantum user sent in and you approved (sent under the
        vehicle's full name, like "Drake Command Module")."""
        over = self._community.photo_overrides()
        hit = next((over[k] for k in (self._pic_key(v.get("name_full")), self._pic_key(v.get("name"))) if k and k in over), None)
        if hit:
            return hit                                     # you replaced UEX's picture
        if v.get("url_photo"):
            return v["url_photo"]
        mine = self._community.photos()
        hit = next((mine[k] for k in (self._pic_key(v.get("name_full")), self._pic_key(v.get("name"))) if k and k in mine), None)
        if hit:
            return hit
        # No UEX picture yet (a ship that's just come out, like the Constellation Mk V or the Skylark):
        # the Star Citizen Wiki page's own picture, once it has one.
        for ref in (v.get("wiki_page"), v.get("name_full"), v.get("name")):
            if not ref:
                continue
            try:
                pic = self._wikiapi.pictures([ref], size=720).get(ref)
            except Exception:
                pic = None
            if pic:
                return pic
        return None

    # Approved pictures are checked for every PHOTOS_SYNC_EVERY; when the set changes, photos_version goes
    # up in the live state and the page swaps in the new pictures, without restarting Quantum.
    PHOTOS_SYNC_EVERY = 120

    def _photos_changed(self):
        sig = hash((tuple(sorted(self._community.photos(fresh=True).items())),
                    tuple(sorted(self._community.photo_overrides()))))
        if sig != getattr(self, "_photos_sig", None):
            first = not hasattr(self, "_photos_sig")
            self._photos_sig = sig
            if not first:
                self._photos_version = getattr(self, "_photos_version", 0) + 1
                self._photo_jobs = None                  # an approved picture takes its picture job away

    def _sync_photos(self):
        time.sleep(15)
        while True:
            try:
                if self._community.url:
                    self._photos_changed()
            except Exception as e:
                print("photo sync:", e, flush=True)
            time.sleep(self.PHOTOS_SYNC_EVERY)

    def _old_names(self, name):
        """A place's earlier names (before a rename like "R&R HUR-L1 …" -> "HUR-L1 …"): shared data from
        Quantum users on older versions still uses them."""
        return [o for o, n in (getattr(self, "_renamed", None) or {}).items() if n == name]

    def _shared_pad(self, name):
        pads = getattr(self, "_community_pads", None) or {}
        return next((pads[k] for k in [name, *self._old_names(name)] if pads.get(k)), None)

    @staticmethod
    def _pic_key(ref):
        return urllib.parse.unquote(str(ref or "").rstrip("/").rsplit("/", 1)[-1]).replace("_", " ").strip().lower()

    def photo_submit(self, kind, name, data_url, replace=False):
        """A picture for something with none, sent to the Quantum server for review. replace: you, the
        server owner, putting it in place of the picture shown now (wrong or poor); it's live at once."""
        if not self._uex.token:
            return {"ok": False, "error": "Add your UEX Bearer Token in Settings to send pictures"}
        user = self._dr_cfg().get("username") or (self._dr_cfg().get("uex_user") or {}).get("username")
        if not user:
            return {"ok": False, "error": "Add your UEX Secret Key in Settings, so the picture is credited to your UEX name"}
        if replace and not self.photo_owner().get("owner"):
            return {"ok": False, "error": "Only the Quantum server's owner can replace a picture"}
        title = urllib.parse.unquote(str(name or "").rstrip("/").rsplit("/", 1)[-1]).replace("_", " ").strip()
        r = self._community.submit_photo(kind, title, data_url, user, replace=bool(replace))
        if r.get("ok") and r.get("approved"):
            try:
                self._photos_changed()                 # live straight away: shown everywhere now
            except Exception:
                pass
        return r

    def photo_owner(self):
        """Whether you're the Quantum server's owner, signed in: then pictures shown in Quantum get a
        Replace button. Asked once every 10 minutes."""
        hit = getattr(self, "_owner_at", None)
        if hit and time.time() - hit[0] < (600 if hit[1].get("owner") else 60):
            return hit[1]
        cfg = self._dr_cfg()
        user = cfg.get("username") or (cfg.get("uex_user") or {}).get("username")
        out = {"owner": False}
        if user and self._community.url and self._uex.token:
            try:
                if cfg.get("secret") and not self._session_token():
                    self._sign_in()
                r = self._community.trust(user) or {}
                out = {"owner": bool(r.get("signed_in") and (r.get("info") or {}).get("owner"))}
            except Exception:
                pass
        self._owner_at = (time.time(), out)
        return out
