"""Api, part of: My Fleet, ship upgrades (CCUs), liveries and flight blades.

A mixin of app.py's Api (class Api(... FleetMixin ...)): the methods are the Api's, `self` is the one Api.
Module-level names come from qbase.py."""
from qbase import *  # noqa: F401,F403


class FleetMixin:
    # ------------------------------------------------------------ My Fleet
    def _fleet(self):
        fl = self._settings.setdefault("fleet", [])
        for f in fl:
            self._loadouts(f)
        return fl

    # ---- loadouts: each ship keeps up to MAX_LOADOUTS named sets of component swaps and power settings.
    # The one being edited in My Fleet is "active"; its swaps and power are also the ship's own "loadout"
    # and "power" (the very same objects), so everything that reads those keeps working. The "primary" one
    # is what the rest of Quantum uses for this ship (the Components tab's fitting, for one).
    MAX_LOADOUTS = 5

    @staticmethod
    def _loadouts(f):
        """The ship's loadouts, made from its single old loadout the first time, with the active one's
        swaps and power linked to the ship's own."""
        L = f.get("loadouts")
        if not isinstance(L, list) or not L:
            L = f["loadouts"] = [{"id": "l1", "name": "Default", "loadout": f.get("loadout") or {}, "power": f.get("power") or {}}]
        L[:] = [x for x in L if isinstance(x, dict) and x.get("id")][:FleetMixin.MAX_LOADOUTS] or \
            [{"id": "l1", "name": "Default", "loadout": {}, "power": {}}]
        for x in L:
            x.setdefault("name", "Loadout")
            if not isinstance(x.get("loadout"), dict):
                x["loadout"] = {}
            if not isinstance(x.get("power"), dict):
                x["power"] = {}
        ids = [x["id"] for x in L]
        if f.get("active_loadout") not in ids:
            f["active_loadout"] = ids[0]
        if f.get("primary_loadout") not in ids:
            f["primary_loadout"] = ids[0]
        act = next(x for x in L if x["id"] == f["active_loadout"])
        f["loadout"], f["power"] = act["loadout"], act["power"]
        return L

    def _loadout_of(self, f, lid=None):
        """One of a ship's loadouts: lid, or "primary", or (None) the one being edited."""
        L = self._loadouts(f)
        want = f["primary_loadout"] if lid == "primary" else (lid or f["active_loadout"])
        return next((x for x in L if x["id"] == want), None)

    def _ship(self, uid):
        return next((x for x in self._fleet() if x["uid"] == uid), None)

    def fleet_loadouts(self, uid):
        f = self._ship(uid)
        if not f:
            return {"ok": False, "error": "That ship isn't in your fleet"}
        return {"ok": True, "active": f["active_loadout"], "primary": f["primary_loadout"], "max": self.MAX_LOADOUTS,
                "loadouts": [{"id": x["id"], "name": x["name"], "swaps": len(x["loadout"]), "livery": (x.get("livery") or {}).get("name")}
                             for x in f["loadouts"]]}

    def fleet_loadout_new(self, uid, name, copy=True):
        """A new loadout for this ship, named, starting as a copy of the one shown now (or stock), and
        shown straight away."""
        f = self._ship(uid)
        if not f:
            return {"ok": False, "error": "That ship isn't in your fleet"}
        L = f["loadouts"]
        if len(L) >= self.MAX_LOADOUTS:
            return {"ok": False, "error": f"A ship can have up to {self.MAX_LOADOUTS} loadouts. Delete one first."}
        name = " ".join(str(name or "").split())[:40] or f"Loadout {len(L) + 1}"
        if any(x["name"].lower() == name.lower() for x in L):
            return {"ok": False, "error": f"This ship already has a loadout called {name}"}
        n = 1
        while f"l{n}" in {x["id"] for x in L}:
            n += 1
        cur = self._loadout_of(f)
        L.append({"id": f"l{n}", "name": name, "loadout": json.loads(json.dumps(cur["loadout"])) if copy else {},
                  "power": json.loads(json.dumps(cur["power"])) if copy else {},
                  **({"livery": dict(cur["livery"])} if copy and cur.get("livery") else {})})
        f["active_loadout"] = f"l{n}"
        self._loadouts(f)
        self._save_settings()
        return {"ok": True, "id": f"l{n}"}

    def fleet_loadout_switch(self, uid, lid):
        f = self._ship(uid)
        if not f or not self._loadout_of(f, lid):
            return {"ok": False, "error": "That loadout is gone"}
        f["active_loadout"] = lid
        self._loadouts(f)
        self._save_settings()
        return {"ok": True}

    def fleet_loadout_rename(self, uid, lid, name):
        f = self._ship(uid)
        x = self._loadout_of(f, lid) if f else None
        name = " ".join(str(name or "").split())[:40]
        if not x or not name:
            return {"ok": False, "error": "Give the loadout a name"}
        if any(o["name"].lower() == name.lower() and o is not x for o in f["loadouts"]):
            return {"ok": False, "error": f"This ship already has a loadout called {name}"}
        x["name"] = name
        self._save_settings()
        return {"ok": True}

    def fleet_loadout_primary(self, uid, lid):
        f = self._ship(uid)
        if not f or not self._loadout_of(f, lid):
            return {"ok": False, "error": "That loadout is gone"}
        f["primary_loadout"] = lid
        self._save_settings()
        return {"ok": True}

    def fleet_loadout_delete(self, uid, lid):
        f = self._ship(uid)
        if not f or not self._loadout_of(f, lid):
            return {"ok": False, "error": "That loadout is gone"}
        if len(f["loadouts"]) <= 1:
            return {"ok": False, "error": "A ship always keeps one loadout. Set its parts back to stock instead."}
        f["loadouts"][:] = [x for x in f["loadouts"] if x["id"] != lid]
        self._loadouts(f)                                  # active and primary move to another one if needed
        self._save_settings()
        return {"ok": True}

    def _vehicle_rows(self):
        try:
            return {v["id"]: v for v in with_extra_vehicles(self._uex.get("vehicles", offline=not self._uex.token)[0])}
        except uex.UexError:
            return {}

    # ------------------------------------------------------------ ship upgrades (CCUs)
    def _ccu_uex(self):
        """{ccu.key(name): UEX row} so the planner can show UEX's pictures and open a ship's Vehicles page."""
        out = {}
        for v in self._vehicle_rows().values():
            maker = str(v.get("company_name") or "").lower()
            for n in (v.get("name"), v.get("name_full")):
                k = ccu.key(n)
                if k:
                    out.setdefault(k, v)
                    if maker and k.startswith(ccu.key(maker) + " "):
                        out.setdefault(k[len(ccu.key(maker)) + 1:], v)
        return out

    def ccu_ships(self):
        """Every ship with a pledge value, cheapest first: its value, whether an upgrade to it is on sale now
        (and the cheapest), its RSI page, UEX's picture when there is one, and whether it's in My Fleet."""
        ships, at, err = self._ccu.ships(wait=True)
        if not ships:
            return {"ok": False, "error": f"Couldn't load ship upgrade prices from the Star Citizen Wiki ({err or 'no ships'})"}
        rows = self._ccu_uex()
        mine = {f.get("vehicle_id") for f in self._fleet()}
        try:                       # wiki pictures for ships UEX has none for, asked for in one go
            self._wikiapi.pictures([r for v in rows.values() if not v.get("url_photo")
                                    for r in (v.get("wiki_page"), v.get("name_full"), v.get("name")) if r], size=720)
        except Exception:
            pass
        out = []
        for s in ships:
            v = rows.get(ccu.key(s["name"])) or rows.get(ccu.key(f"{s['maker']} {s['name']}")) or {}
            o = ccu.offers(s)
            out.append({"name": s["name"], "maker": s["maker"], "value": s["msrp"], "status": s["status"],
                        "store": s.get("store") or (store_url(v) if v else None),
                        "on_sale": bool(o), "best": o[0] if o else None,
                        "editions": [x for x in s["skus"] if x["available"]],
                        "uex_id": v.get("id"), "photo": self._vehicle_photo(v) if v else None,
                        "mine": bool(v) and v.get("id") in mine})
        self._ccu.warm()                     # ask RSI about sale upgrades now, while ships are being picked
        return {"ok": True, "ships": out, "at": at, "source": self._ccu.source}

    def ccu_photo(self, name):
        """The wiki's picture of a ship UEX has none for."""
        try:
            return {"ok": True, "photo": self._wikiapi.pictures([name], size=720).get(name)}
        except Exception:
            return {"ok": True, "photo": None}

    def ccu_path(self, src, dst, warbond=True):
        """The cheapest chain of upgrades from src to dst that RSI's own upgrade tool sells (Ccu.path), with
        The Impound's search for dst when there's none."""
        r = self._ccu.path(src, dst, warbond=bool(warbond))
        r["impound"] = ccu.impound_url(dst)
        if not r["ok"] and r["reason"] in ("unavailable", "none") and warbond is False:
            alt = self._ccu.path(src, dst, warbond=True)
            r["warbond_only"] = alt.get("ok", False)
        return r

    def fleet_list(self):
        rows = self._vehicle_rows()
        out = []
        for f in self._fleet():
            v = rows.get(f["vehicle_id"], {})
            prim = self._loadout_of(f, "primary")
            out.append(dict({k: x for k, x in f.items() if k not in ("loadouts", "loadout", "power")},
                            full=v.get("name_full") or f.get("name"), maker=v.get("company_name") or "",
                            scu=v.get("scu") or 0, pad=v.get("pad_type"),
                            photo=self._livery_photo(prim.get("livery"), v, cached_only=True) or self._vehicle_photo(v),
                            swaps=len(prim["loadout"]), loadouts=len(f["loadouts"]), primary_name=prim["name"],
                            total_swaps=sum(len(x["loadout"]) for x in f["loadouts"])))
        return {"ok": True, "ships": out, "main": next((f["uid"] for f in self._fleet() if f.get("main")), None)}

    def fleet_add(self, vehicle_id):
        v = self._vehicle_rows().get(int(vehicle_id))
        if not v:
            return {"ok": False, "error": "Pick a ship from the list"}
        uid = f"s{int(time.time() * 1000)}"
        fl = self._fleet()
        fl.append({"uid": uid, "vehicle_id": v["id"], "name": v.get("name_full") or v.get("name"),
                   "main": not any(f.get("main") for f in fl), "loadout": {}})
        self._loadouts(fl[-1])
        self._save_settings()
        return {"ok": True, "uid": uid}

    def fleet_remove(self, uid):
        fl = self._fleet()
        was_main = any(f["uid"] == uid and f.get("main") for f in fl)
        fl[:] = [f for f in fl if f["uid"] != uid]
        if was_main and fl:
            fl[0]["main"] = True
        self._save_settings()
        return {"ok": True}

    def fleet_move(self, uid, target_uid, after=False):
        """Put a ship just before (or after) another one in My Fleet: the fleet's order is the order it's kept in."""
        fl = self._fleet()
        ship = next((f for f in fl if f["uid"] == uid), None)
        if not ship or uid == target_uid or not any(f["uid"] == target_uid for f in fl):
            return {"ok": False, "error": "That ship isn't in your fleet any more"}
        fl.remove(ship)
        i = next(n for n, f in enumerate(fl) if f["uid"] == target_uid)
        fl.insert(i + 1 if after else i, ship)
        self._save_settings()
        return {"ok": True}

    def fleet_set_main(self, uid):
        for f in self._fleet():
            f["main"] = f["uid"] == uid
        self._save_settings()
        return {"ok": True}

    def _rack_spec_for(self, name, uuid=None):
        """How many missiles a rack holds and how big ({"missiles", "missile_size"}): from its name when it
        says (MSD-341), else its Star Citizen Wiki record (class name and missile ports)."""
        spec = fleet.rack_spec(name)
        if not (spec.get("missiles") and spec.get("missile_size")):
            try:
                rec = self._wikiapi.item(uuid, name)
            except Exception:
                rec = None
            if rec:
                spec = {**fleet.rack_spec(rec.get("name"), rec.get("class_name"), rec.get("ports")), **spec}
        return {k: spec[k] for k in ("missiles", "missile_size") if spec.get(k)}

    def _apply_rack_swaps(self, lo, fits):
        """Swapped missile racks change the missile slots under them: the stock rack's missiles go and the
        new rack's come in (as many as it holds, at its missile size, empty until you fit missiles; a fresh
        rack comes without any). Returns the stock missiles' damage taken off the ship."""
        removed = 0.0
        racks = [s for s in lo["slots"] if s["type"] == "MissileLauncher"]
        for rk in racks:
            fit = fits.get(rk["port"])
            fit = {"name": fit} if isinstance(fit, str) else fit
            if not fit or (fit.get("name") or "").lower() == ((rk.get("stock") or {}).get("name") or "").lower():
                continue
            spec = self._rack_spec_for(fit.get("name"), fit.get("uuid"))
            rk["fitted_stats"] = spec
            if not spec.get("missiles"):
                continue                                # don't know what it holds: leave the missiles as they are
            for s in lo["slots"]:
                if s.get("rack") == rk["port"]:
                    st = s.get("stock") or {}
                    g = self._game.stats(st.get("uuid"), st.get("name"), st.get("size")) or {}
                    removed += g.get("missile") or (st.get("stats") or {}).get("missile") or 0
            lo["slots"] = [s for s in lo["slots"] if s.get("rack") != rk["port"]]
            for n in range(spec["missiles"]):
                lo["slots"].append({"port": f"{rk['port']}/missile_{n + 1:02d}_attach", "type": "Missile",
                                    "label": fleet.SLOT_TYPES["Missile"][0], "size": spec.get("missile_size"),
                                    "where": rk.get("where") or "", "stock": None, "rack": rk["port"],
                                    "rack_name": fit["name"]})
        lo["slots"].sort(key=lambda s: (fleet.ORDER.index(s["type"]) if s["type"] in fleet.ORDER else 99,
                                        -(s["size"] or 0), s["port"]))
        return removed

    @staticmethod
    def _missile_summary(slots):
        """What the racks carry, for My Fleet's missile group: {"racks", "slots", "loaded", "by_size": {size: n}}."""
        ms = [s for s in slots if s["type"] == "Missile"]
        by = {}
        for s in ms:
            by[str(s.get("size") or "?")] = by.get(str(s.get("size") or "?"), 0) + 1
        return {"racks": sum(1 for s in slots if s["type"] == "MissileLauncher"), "slots": len(ms),
                "loaded": sum(1 for s in ms if s.get("fitted") or s.get("stock")), "by_size": by}

    def fleet_fill_rack(self, uid, rack_port, item_name, uuid=None):
        """Fit one missile to every missile slot on a rack (a fresh rack's 16 empty slots in one go)."""
        lo = self.fleet_loadout(uid)
        if not lo.get("ok"):
            return lo
        ports = [s["port"] for s in lo["slots"] if s["type"] == "Missile" and s.get("rack") == rack_port]
        if not ports:
            return {"ok": False, "error": "That rack has no missile slots"}
        f = self._ship(uid)
        fits = self._loadout_of(f)["loadout"]
        for p_ in ports:
            fits[p_] = {"name": item_name, "uuid": uuid}
        self._save_settings()
        return {"ok": True, "count": len(ports)}

    def fleet_fill_missiles(self, uid, size, item_name, uuid=None):
        """Fit one missile to every missile slot of its size on the whole ship, across all its racks."""
        lo = self.fleet_loadout(uid)
        if not lo.get("ok"):
            return lo
        ports = [s["port"] for s in lo["slots"] if s["type"] == "Missile" and str(s.get("size") or "") == str(size or "")]
        if not ports:
            return {"ok": False, "error": f"This ship has no size {size} missile slots"}
        fits = self._loadout_of(self._ship(uid))["loadout"]
        for p_ in ports:
            fits[p_] = {"name": item_name, "uuid": uuid}
        self._save_settings()
        return {"ok": True, "count": len(ports)}

    def fleet_loadout(self, uid, _ship=None):
        """The ship's slots stock component in each, and what you've swapped in. _ship: a copy of the ship to
        work out instead (the website copy works out each loadout this way, without touching the real one)."""
        f = _ship or next((x for x in self._fleet() if x["uid"] == uid), None)
        if not f:
            return {"ok": False, "error": "That ship isn't in your fleet"}
        v = self._vehicle_rows().get(f["vehicle_id"], {})
        name = v.get("name") or f["name"]
        data = self._wikiapi.vehicle([v.get("uuid"), name, v.get("slug"), name.lower().replace(" ", "-"),
                                   v.get("name_full"), v.get("wiki_page")])
        if not data:
            return {"ok": False, "error": f"The Star Citizen Wiki has no loadout for {f['name']} (or it can't be reached)"}
        lo = fleet.Wiki.loadout(data)
        removed_missile = self._apply_rack_swaps(lo, f.get("loadout") or {})
        for s_ in lo["slots"]:                            
            st = s_.get("stock")
            if st:
                g = self._game.stats(st.get("uuid"), st.get("name"), st.get("size"))
                if g:
                    st["stats"] = {**(st.get("stats") or {}), **g}
                    st["source"] = "game"
            fit = (f.get("loadout") or {}).get(s_["port"])
            if isinstance(fit, str):                    
                fit = {"name": fit}
            if s_["type"] == "MissileLauncher":         # a swapped rack: its numbers come from _apply_rack_swaps
                s_["fitted"] = fit["name"] if fit else None
                if fit and not s_.get("fitted_stats"):
                    s_["fitted_stats"] = self._rack_spec_for(fit["name"], fit.get("uuid"))
                continue
            if fit and s_["type"] == "Missile" and s_.get("size"):
                gi = self._game.find(fit.get("uuid"), fit["name"], None)
                if gi and (gi.get("size") or 0) > s_["size"]:
                    fit = None                          # left over from a rack that took bigger missiles
            s_["fitted"] = fit["name"] if fit else None
            if fit:
                gi = self._game.find(fit.get("uuid"), fit["name"], s_.get("size"))
                if gi:
                    # stats() adds the power numbers (power use, minimum, cooling made) the bare stats lack,
                    # so a swapped part is powered and cooled the same way its stock one is
                    full = self._game.stats(gi.get("uuid"), fit["name"], s_.get("size")) or dict(gi["stats"])
                    s_["fitted_stats"], s_["fitted_grade"], s_["fitted_maker"] = full, gi.get("grade"), gi.get("maker")
                    if s_["type"] == "Cooler":              
                        rec = self._wikiapi.item(gi["uuid"], fit["name"])
                        s_["fitted_stats"].update({k: v for k, v in (fleet.item_stats(rec) if rec else {}).items()
                                                   if k not in s_["fitted_stats"]})
                else:
                    rec = self._wikiapi.item(fit.get("uuid"), fit["name"])
                    s_["fitted_stats"] = fleet.item_stats(rec) if rec else {}
                    s_["fitted_grade"] = (rec or {}).get("grade")
                    s_["fitted_maker"] = ((rec or {}).get("manufacturer") or {}).get("name")
        # The wiki's vehicle record often leaves out the ship's shield regen (and sometimes its shield HP):
        # add up its stock shield generators' instead, so My Fleet always shows them
        for ship_k, item_k in (("shield_regen", "shield_regen"), ("shield", "shield_hp")):
            if not lo["stats"].get(ship_k):
                tot = sum(((s_.get("stock") or {}).get("stats") or {}).get(item_k) or 0
                          for s_ in lo["slots"] if s_["type"] == "Shield")
                if tot:
                    lo["stats"][ship_k] = tot
        lo["stock_stats"] = dict(lo["stats"])
        lo["stats"], lo["delta"] = fleet.apply_swaps(lo["stats"], lo["slots"])
        if removed_missile and lo["stats"].get("missile_dmg") is not None:   # missiles on a stock rack you swapped out
            lo["stats"]["missile_dmg"] = max(0, lo["stats"]["missile_dmg"] - removed_missile)
            d = (lo["delta"].get("missile_dmg") or 0) - removed_missile
            if d:
                lo["delta"]["missile_dmg"] = d
            else:
                lo["delta"].pop("missile_dmg", None)
        lo["missiles"] = self._missile_summary(lo["slots"])
        pw = f.get("power") or {}
        mode = pw.get("mode", "scm")
        for fx in lo.get("fixed") or []:                
            st = fx.get("stock") or {}
            g = self._game.stats(st.get("uuid"), st.get("name"), st.get("size"))
            if g:
                st["stats"] = g
        opts = {"pips": None, "mode": mode, "cooling": pw.get("cooling"),
                "parts": (pw.get("parts") or {}).get(mode) or {}, "fixed": lo.get("fixed") or [],
                "armor": lo.get("armor")}
        now, stock = fleet.signatures(lo["slots"], True, **opts), fleet.signatures(lo["slots"], False, **opts)
        if now["em"] or now["ir"]:
            for k in ("em", "ir"):
                lo["stats"][k] = round(now[k])
                d = round(now[k] - stock[k])
                if d:
                    lo["delta"][k] = d
                else:
                    lo["delta"].pop(k, None)
        lo["power"] = {"mode": mode, "cooling": now["cooling"], "cooling_auto": now["cooling_auto"],
                       "custom": bool(opts["parts"]) or not now["cooling_auto"],
                       "cool_make": now["cool_make"], "pips_gen": now["pips_gen"], "pips_used": now["pips_used"]}
        for s_ in lo["slots"] + (lo.get("fixed") or []):
            s_["power"] = now["parts"].get(s_["port"])
        # Flight blade: a slot of its own when aftermarket blades exist for this ship. Its power stays on
        # the fixed "Thrusters" entry; picking a blade changes the ship's speeds where the wiki has them.
        fc = next((x for x in lo.get("fixed") or [] if x["type"] == "FlightController"), None)
        if fc and self._blades_for(fc.get("stock")):
            fit = (f.get("loadout") or {}).get(fc["port"])
            fit = {"name": fit} if isinstance(fit, str) else fit
            blade = {"port": fc["port"], "type": "FlightController", "label": "Flight blade", "size": fc.get("size") or 1,
                     "where": "", "stock": fc.get("stock"), "fitted": fit["name"] if fit else None}
            if fit:
                rec = self._wikiapi.item(fit.get("uuid"), None) if fit.get("uuid") else None
                scm, mx = fleet.flight_speeds(rec)
                blade["fitted_stats"] = {k: v for k, v in (("scm", scm), ("max", mx)) if v}
                blade["fitted_grade"], blade["fitted_maker"] = (rec or {}).get("grade"), ((rec or {}).get("manufacturer") or {}).get("name")
                fc["stock"] = dict(fc.get("stock") or {}, name=fit["name"])
                for k, v in blade["fitted_stats"].items():          # the ship's speeds with this blade
                    if lo["stats"].get(k):
                        d = round(v - lo["stats"][k])
                        lo["stats"][k] = v
                        if d:
                            lo["delta"][k] = d
            lo["slots"].append(blade)
        if now.get("pool"):                               # the guns' shared power pool, shown as one bar
            guns = [x for x in lo["slots"] if x["type"] == "WeaponGun"]
            lo.setdefault("fixed", []).insert(0, {"port": fleet.WEAPONS, "type": fleet.WEAPONS, "label": "Weapons",
                                                  "stock": {"name": f"{len(guns)} gun{'s' if len(guns) != 1 else ''}"},
                                                  "power": now["parts"].get(fleet.WEAPONS)})
        return {"ok": True, "uid": uid, "ship": dict({k: x for k, x in f.items() if k not in ("loadouts", "loadout", "power")},
                                                     full=v.get("name_full") or f["name"],
                                                     photo=self._livery_photo((self._loadout_of(f) or {}).get("livery"), v) or self._vehicle_photo(v),
                                                     stock_photo=self._vehicle_photo(v),
                                                     livery_photo=bool(self._livery_photo((self._loadout_of(f) or {}).get("livery"), v)),
                                                     scu=v.get("scu") or 0, maker=v.get("company_name") or ""),
                "loadouts": self.fleet_loadouts(uid),
                "game_data": self._game.generated, **lo}

    # ------------------------------------------------------------ liveries (paints)
    @staticmethod
    def _paint_family(name):
        """The ship family paints are made for: 'Cutlass Black' -> 'cutlass', 'Constellation Andromeda' ->
        'constellation', 'Avenger Titan' -> 'avenger', 'C2 Hercules' -> 'hercules', 'F7C-M Super Hornet' -> 'hornet'."""
        words = [w for w in re.findall(r"[a-z0-9\-]+", (name or "").lower()) if w not in ("mk", "ii", "iv", "v", "i")]
        for w in words:
            if re.search(r"[a-z]{4,}", w) and not re.match(r"^[a-z]?\d", w) and w not in ("super", "heavy", "star"):
                return w
        if words and re.match(r"^\d+", words[0]):        # '300i' -> '300' (paints say "300 Series")
            return re.match(r"^\d+", words[0]).group(0)
        return words[0] if words else ""

    def _livery_options(self, v, ship_name):
        """Every paint UEX (and the Star Citizen Wiki) has for this ship: [{id, name, source, buy, wiki}]."""
        vid, name = v.get("id"), (v.get("name") or ship_name or "").lower()
        fam = self._paint_family(v.get("name") or ship_name)
        fam_rx = re.compile(rf"\b{re.escape(fam)}\b") if fam else None
        out, seen = [], set()

        def fits(pname, vname=None, pid_vehicle=None):
            if vid and pid_vehicle and str(pid_vehicle) == str(vid):
                return True
            vname = (vname or "").lower()
            if vname and (vname == name or vname in name or name in vname):
                return True
            return bool(fam_rx and fam_rx.search((pname or "").lower()))
        try:
            cats = [c for c in self._uex.get("categories")[0]
                    if re.search(r"paint|livery|liveries", f"{c.get('section') or ''} {c.get('name') or ''}", re.I)]
            spots = self._item_spots() if cats else {}
            for c in cats:
                for i in self._uex.get("items", {"id_category": int(c["id"])})[0]:
                    nm = i.get("name")
                    if not nm or nm.lower() in seen or not fits(nm, i.get("vehicle_name"), i.get("id_vehicle")):
                        continue
                    seen.add(nm.lower())
                    out.append({"id": str(i["id"]), "name": nm, "source": "uex", "buy": spots.get(i["id"], [])[:3],
                                "wiki": i.get("wiki") or nm, "store": i.get("url_store"),
                                "_hay": f"{nm} {i.get('vehicle_name') or ''} {i.get('slug') or ''}"})
        except Exception:
            pass
        try:
            for d in self._wikiapi.items_of_type("Paints"):
                nm = d.get("name")
                if not nm or nm.lower() in seen or re.search(r"(?i)\b(test|template|placeholder)\b|_ai_|_npc", f"{d.get('class_name')} {nm}"):
                    continue
                if not fits(nm) and not (fam and fam in (d.get("class_name") or "").lower()):
                    continue
                seen.add(nm.lower())
                out.append({"id": d.get("uuid") or nm, "name": nm, "source": "wiki", "buy": [], "wiki": d.get("web_url") or nm,
                            "image": d.get("image"), "_hay": f"{nm} {d.get('class_name') or ''}"})
        except Exception:
            pass
        # Paints the ship's wiki Paints page pictures that neither list has (the Intrepid's Wavefront)
        try:
            ship = v.get("name") or ship_name or ""
            Fam = next((w for w in re.findall(r"[A-Za-z0-9\-]+", ship) if w.lower() == fam), (fam or "").title())
            ship_words = set(re.findall(r"[a-z0-9]+", f"{ship} {fam}".lower())) - {"mk", "series"}
            have = [re.findall(r"[a-z0-9]+", x["name"].lower()) for x in out]
            for paint, fl in self._wikiapi.paints_on_page([f"{Fam} series/Paints", f"{ship} series/Paints", f"{ship}/Paints"],
                                                          ship_words):
                pw = [w for w in re.findall(r"[a-z0-9]+", paint.lower())]
                if any(all(any(self._wikiapi._near(a, b) for b in h) for a in pw) for h in have):
                    continue                                 # already listed ("Altar" is the Altair)
                nm = f"{Fam} {paint} Livery"
                have.append(re.findall(r"[a-z0-9]+", nm.lower()))
                out.append({"id": f"wikifile:{fl}", "name": nm, "source": "wiki", "buy": [], "wiki": nm, "file": fl})
        except Exception as e:
            print("paints page:", e, flush=True)
        out = [x for x in out if not self._paint_not_for(x["name"], fam)]
        out = [x for x in out if self._paint_fits_mark(x.get("_hay") or x["name"], v.get("name") or ship_name, fam)]
        # The same paint under two names (UEX's 'Constellation Blackthorne Livery' and the wiki's 'Constellation
        # Mk V Blackthorne Paint') is listed once: the paint's own words decide, ship and filler words left out.
        ship_words = set(re.findall(r"[a-z0-9]+", f"{v.get('name') or ship_name or ''} {fam or ''}".lower()))
        filler = {"livery", "liveries", "paint", "paints", "skin", "mk", "mark", "series", "rsi", "the", "edition",
                  "i", "ii", "iii", "iv", "v", "1", "2", "3", "4", "5"}
        keyed, uniq = {}, []
        for x in out:
            words = frozenset(re.findall(r"[a-z0-9]+", x["name"].lower())) - filler - ship_words
            k = words or x["name"].lower()
            a = keyed.get(k)
            if a is None:
                keyed[k] = x
                uniq.append(x)
                continue
            keep, drop = (a, x) if (a["source"] == "uex") >= (x["source"] == "uex") else (x, a)
            for f in ("image", "file", "store"):
                if drop.get(f) and not keep.get(f):
                    keep[f] = drop[f]
            keep["buy"] = keep.get("buy") or drop.get("buy") or []
            if keep is not a:
                uniq[uniq.index(a)] = keep
                keyed[k] = keep
        out = uniq
        for x in out:
            x.pop("_hay", None)
        out.sort(key=lambda x: x["name"].lower())
        return out

    _MARK_RX = re.compile(r"(?i)(?:\bmk|\bmark)[\s_\-]*(iv|v|iii|ii|i|[1-9])\b")
    _MARK_NUM = {"i": 1, "ii": 2, "iii": 3, "iv": 4, "v": 5}

    @classmethod
    def _mark_of(cls, text):
        """The generation in a name: 'Constellation Mk V Centaurus' -> 5, 'rsi_constellation_mk5_paint' -> 5, None."""
        m = cls._MARK_RX.search((text or "").replace("_", " "))
        if not m:
            m = re.search(r"(?i)mk(\d)", text or "")
            return int(m.group(1)) if m else None
        g = m.group(1).lower()
        return cls._MARK_NUM.get(g) or int(g)

    def _paint_fits_mark(self, hay, ship, fam):
        """Paints for a ship line that has generations (the Constellation Mk IV and Mk V) only fit their own
        generation: a Mk V Centaurus doesn't take the older Constellations' paints, and the reverse. A paint that
        names no generation fits a newer-generation ship only when it names a word only that generation's ships
        have ('Centaurus')."""
        ship_mark, paint_mark = self._mark_of(ship), self._mark_of(hay)
        try:
            fam_ships = [vv.get("name") or "" for vv in self._vehicle_rows().values()
                         if self._paint_family(vv.get("name")) == fam]
        except Exception:
            fam_ships = []
        marks = {self._mark_of(n) for n in fam_ships} | {ship_mark}
        if len(marks) < 2:                       # one generation only: nothing to sort out
            return True
        if paint_mark is not None:
            # 'Mk IV' paints and old unmarked ships (UEX's 'Constellation Andromeda' is the Mk IV)
            return paint_mark == ship_mark or (ship_mark is None and paint_mark != max(m for m in marks if m))
        newest = max(m for m in marks if m)
        older_words, newest_words = set(), set()
        for n in fam_ships + [ship or ""]:
            (newest_words if self._mark_of(n) == newest else older_words).update(re.findall(r"[a-z0-9]+", n.lower()))
        skip = {"mk", "v", "iv", "rsi", fam}
        words = set(re.findall(r"[a-z0-9]+", (hay or "").lower().replace("_", " ")))
        if ship_mark != newest:                  # an older ship: an unmarked paint is its own, unless it names a newer-only ship
            return not (words & (newest_words - older_words - skip))
        own = set(re.findall(r"[a-z0-9]+", (ship or "").lower())) - older_words - skip
        return bool(own & words)

    # Paints listed somewhere that aren't in the game (reported by players)
    PAINT_NOT_IN_GAME = {"spirit intrepid livery"}

    def _paint_not_for(self, name, fam):
        """A paint that doesn't belong in this ship's list: one known not to exist, or one named after another
        ship as well ("Spirit Intrepid Livery": a paint named for two ships isn't this one's)."""
        n = (name or "").strip().lower()
        if n in self.PAINT_NOT_IN_GAME:
            return True
        if not fam:
            return False
        others = self.__dict__.get("_ship_families")
        if others is None:
            try:
                others = {self._paint_family(v.get("name")) for v in self._vehicle_rows().values()} - {""}
            except Exception:
                others = set()
            self._ship_families = others
        words = re.findall(r"[a-z0-9]+", n)
        return fam in words and any(w in others and w != fam for w in words)

    def fleet_liveries(self, uid):
        """Paints available for a ship in My Fleet, and the one on the loadout being shown."""
        f = self._ship(uid)
        if not f:
            return {"ok": False, "error": "That ship isn't in your fleet"}
        v = self._vehicle_rows().get(f["vehicle_id"], {})
        lo = self._loadout_of(f)
        items = self._livery_options(v, f.get("name"))
        return {"ok": True, "current": (lo or {}).get("livery"), "items": items,
                "note": None if items else "No paints listed for this ship yet (UEX or the Star Citizen Wiki)"}

    def fleet_set_livery(self, uid, livery=None):
        """Put a paint on the loadout being shown (None: back to the stock paint)."""
        f = self._ship(uid)
        if not f:
            return {"ok": False, "error": "That ship isn't in your fleet"}
        lo = self._loadout_of(f)
        if livery:
            lv = livery if isinstance(livery, dict) else {"name": str(livery)}
            lo["livery"] = {k: lv.get(k) for k in ("id", "name", "source", "wiki", "image", "file") if lv.get(k)}
        else:
            lo.pop("livery", None)
        self._save_settings()
        v = self._vehicle_rows().get(f["vehicle_id"], {})
        stock = self._vehicle_photo(v)
        return {"ok": True, "current": lo.get("livery"), "photo": self._livery_photo(lo.get("livery"), v) or stock,
                "stock_photo": stock}

    @staticmethod
    def _clean_livery(lv):
        """A paint from a backup, only the fields a loadout keeps for it (or None)."""
        if not isinstance(lv, dict) or not isinstance(lv.get("name"), str) or not lv["name"].strip():
            return None
        return {k: str(lv[k])[:500] for k in ("id", "name", "source", "wiki", "image", "file")
                if isinstance(lv.get(k), (str, int)) and str(lv[k]).strip()}

    def _livery_photo(self, livery, v=None, cached_only=False):
        """The picture of a ship in a paint, or None when there's none yet (the stock picture is shown then):
        one you put in place or an approved Quantum user's, else the paint's picture on the ship's own wiki
        pages (its page and its series' Paints page: "Intrepid_Oblivion_in_space_-_Isometric.jpg"), else the
        paint's own wiki page. Looked up once per ship and paint, and kept. cached_only: don't go to the
        network, just say what's known (a background lookup is started for the rest)."""
        if not livery:
            return None
        lv = livery if isinstance(livery, dict) else {"name": str(livery)}
        name = (lv.get("name") or "").strip()
        if not name:
            return None
        v = v or {}
        cache = self.__dict__.setdefault("_livery_pics", {})
        key = f"{(v.get('name') or '').lower()}|{name.lower()}"
        if key in cache:
            return cache[key] or None
        if cached_only:
            def warm():
                try:
                    self._livery_photo(lv, v)
                except Exception:
                    pass
            threading.Thread(target=warm, daemon=True).start()
            return None
        url = None
        try:                                              # one you or an approved Quantum user put in place
            k = self._pic_key(name)
            url = self._community.photo_overrides().get(k) or self._community.photos().get(k)
        except Exception:
            url = None
        if not url and lv.get("file"):
            try:
                url = self._wikiapi.file_urls([lv["file"]]).get(lv["file"])
            except Exception:
                url = None
        if not url and v:
            url = self._wiki_paint_picture(name, v)
        if not url:
            fam = self._paint_family(v.get("name") or "") if v else ""
            # a bare paint name ("Nocturne") can be some other page's title: only names with the ship's in them
            for ref in [lv.get("wiki")] + ([name, f"{name} Livery", f"{name} Paint"] if not fam or fam in name.lower() else []):
                if not ref:
                    continue
                try:
                    url = self._wiki_image(ref)
                except Exception:
                    url = None
                if url and fam and not self._paint_fits_mark(urllib.parse.unquote(url.rsplit("/", 1)[-1]).replace("_", " "),
                                                             v.get("name") or "", fam):
                    url = None                            # another generation's picture (a Mk IV's for a Mk V)
                if url:
                    break
        img = lv.get("image")
        if img and v and not self._paint_fits_mark(urllib.parse.unquote(str(img).rsplit("/", 1)[-1]).replace("_", " "),
                                                    v.get("name") or "", self._paint_family(v.get("name") or "")):
            img = None
        url = url or img
        cache[key] = url or ""
        return url

    def _wiki_paint_picture(self, paint, v):
        """The paint's picture from the ship's wiki pages, or None."""
        ship = v.get("name") or ""
        fam = self._paint_family(ship)
        Fam = next((w for w in re.findall(r"[A-Za-z0-9\-]+", ship) if w.lower() == fam), fam.title())
        pages = [v.get("wiki_page"), ship, v.get("name_full"), f"{Fam} series/Paints", f"{ship} series/Paints",
                 f"{ship}/Paints"]
        try:
            files = self._wikiapi.page_files([p for p in pages if p])
            # the series' Paints page pictures every generation: a Mk V's paint only from a Mk V's picture
            files = [fl for fl in files if self._paint_fits_mark(fl.split(":", 1)[-1].replace("_", " "), ship, fam)]
            ship_words = set(re.findall(r"[a-z0-9]+", f"{ship} {fam}".lower())) - {"mk", "series"}
            fl = self._wikiapi.paint_file(paint, ship_words, files)
            return self._wikiapi.file_urls([fl]).get(fl) if fl else None
        except Exception as e:
            print("paint picture:", e, flush=True)
            return None

    # ------------------------------------------------------------ flight blades
    # A ship's flight controller is a flight blade in game; ships that have aftermarket ones (Speed and
    # Handling blades) can swap it. The game files list them by class name next to the stock one:
    # controller_flight_aegs_gladius -> controller_flight_aegs_gladius_blade_spd / _blade_hnd.
    def _blades_for(self, stock):
        """[(uuid, name, class)] of the flight blades that fit the ship whose stock controller is `stock`."""
        cls = ((stock or {}).get("class_name") or "").lower()
        if not cls:
            g = self._game.find((stock or {}).get("uuid"), None, None)
            cls = (g or {}).get("name", "").lower() if g and str(g.get("name", "")).startswith("controller_flight") else ""
        if not cls:
            return []
        base = re.sub(r"_(?:flight_)?blade_(spd|hnd)$", "", cls)
        out = []
        for g in self._game.of_kind("FlightController", None):
            n = (g.get("name") or "").lower()
            if re.fullmatch(re.escape(base) + r"_(?:flight_)?blade_(spd|hnd)", n):
                out.append((g["uuid"], n))
        if not out:                                    # not in the game files yet: the wiki's list
            for d in self._wiki_parts("FlightController", r"_blade_(spd|hnd)$"):
                c = (self._wikiapi_class(d) or "").lower()
                if c and re.fullmatch(re.escape(base) + r"_(?:flight_)?blade_(spd|hnd)", c):
                    out.append((d["uuid"], c))
        return [(u, self._blade_label(c), c) for u, c in out]

    def _wikiapi_class(self, part):
        try:
            return next((d.get("class_name") for d in self._wikiapi.items_of_type("FlightController")
                         if d.get("uuid") == part.get("uuid")), None)
        except Exception:
            return None

    def _blade_label(self, cls):
        ship, kind = self._blade_ship(cls)
        return f"{ship.split(' ', 1)[-1]} {kind} Flight Blade" if ship else cls

    def _blade_option(self, uuid, name, cls):
        rec = self._wikiapi.item(uuid, None) if uuid else None
        scm, mx = fleet.flight_speeds(rec)
        st = {k: v for k, v in (("scm", scm), ("max", mx)) if v}
        return {"id": uuid, "uuid": uuid, "name": name, "maker": ((rec or {}).get("manufacturer") or {}).get("name") or "",
                "size": (rec or {}).get("size") or 1, "grade": (rec or {}).get("grade"), "stats": st, "price": None, "buy": [],
                "extra": fleet.Wiki.stat_rows(rec) if rec else [], "class_name": cls}

    def _flight_options(self, uid):
        f = self._ship(uid) if uid else None
        if not f:
            return {"ok": False, "error": "Pick a ship first"}
        lo = self.fleet_loadout(uid)
        slot = next((x for x in (lo.get("slots") or []) if x.get("type") == "FlightController"), None) if lo.get("ok") else None
        if not slot:
            return {"ok": True, "items": [], "key": "scm"}
        st = slot.get("stock") or {}
        items = [dict(self._blade_option(st.get("uuid"), (st.get("name") or "Flight Blade") + " (stock)", st.get("class_name")),
                      stock=True)]
        from concurrent.futures import ThreadPoolExecutor
        with ThreadPoolExecutor(max_workers=4) as ex:
            items += list(ex.map(lambda b: self._blade_option(*b), self._blades_for(st)))
        return {"ok": True, "items": items, "key": "scm", "source": "game"}

    def _wiki_options(self, slot_type, size, have):
        """Parts of a slot's kind and size that only the Star Citizen Wiki has (Helix mining lasers, new RSI
        parts), with their numbers, for My Fleet's options."""
        kind = next(((t, test) for _, t, test in self.WIKI_KINDS if t == slot_type), None)
        if not kind or slot_type == "FlightController":
            return []
        names = {(x.get("name") or "").lower() for x in have} | {(x.get("uuid") or "").lower() for x in have}
        add = [w for w in self._wiki_parts(*kind) if (not size or str(w.get("size")) == str(size))
               and w["name"].lower() not in names and (w.get("uuid") or "").lower() not in names]
        from concurrent.futures import ThreadPoolExecutor
        with ThreadPoolExecutor(max_workers=8) as ex:
            recs = list(ex.map(lambda w: self._wikiapi.item(w.get("uuid"), w["name"]), add))
        return [{"id": w["id"], "uuid": w.get("uuid"), "name": w["name"], "maker": w["maker"], "size": w["size"],
                 "grade": w["grade"], "stats": fleet.item_stats(rec) if rec else {}, "extra": w.get("extra") or [],
                 "price": w["buy"][0]["price"] if w["buy"] else None, "buy": w["buy"][:6], "wiki_only": True}
                for w, rec in zip(add, recs)]

    def fleet_options(self, slot_type, size, uid=None):
        """Components that fit a slot (same kind and size), with where to buy them. From the game files
        when they cover this kind of slot (every part, exact numbers), else UEX's lists."""
        if slot_type == "FlightController":
            return self._flight_options(uid)
        if slot_type == "MissileLauncher":
            return self._uex_call(lambda: self._rack_options(size, uid))
        f = next((x for x in self._fleet() if x["uid"] == uid), None) if uid else None
        ground = bool(self._vehicle_rows().get(f["vehicle_id"], {}).get("is_ground_vehicle")) if f else False
        game = self._game.of_kind(slot_type, size, ground)
        if game:
            def with_wiki():
                r = self._game_options(slot_type, game)
                if r.get("ok") and not ground:
                    r["items"] += self._wiki_options(slot_type, size, r["items"])
                return r
            return self._uex_call(with_wiki)
        def run():
            words = fleet.SLOT_TYPES.get(slot_type, ("", ()))[1]
            cats = [c for c in self._uex.get("categories")[0] if (c.get("type") or "item") == "item"
                    and any(w == (c.get("name") or "").lower().rstrip("s") or w in (c.get("name") or "").lower()
                            for w in words)
                    and not any(k in f"{c.get('section') or ''} {c.get('name') or ''}".lower()
                                for k in self.COMPONENT_SKIP + ("fps", "personal"))]
            spots = self._item_spots()
            out = []
            for c in cats[:3]:
                for i in self._uex.get("items", {"id_category": int(c["id"])})[0]:
                    if size and str(i.get("size") or "") not in (str(size), ""):
                        continue
                    buy = spots.get(i["id"], [])
                    out.append({"id": i["id"], "name": i.get("name"), "maker": i.get("company_name") or "",
                                "size": i.get("size"), "grade": i.get("quality"), "wiki": i.get("wiki"),
                                "uuid": i.get("uuid"), "price": buy[0]["price"] if buy else None, "buy": buy[:6]})
            out.sort(key=lambda x: (x["price"] is None, x["price"] or 0, x["name"] or ""))
            out = out[:40]
            # Each option's numbers from the wiki (cached a week), fetched side by side.
            from concurrent.futures import ThreadPoolExecutor
            with ThreadPoolExecutor(max_workers=8) as ex:
                recs = list(ex.map(lambda i: self._wikiapi.item(i["uuid"], i["name"]), out))
            for i, rec in zip(out, recs):
                i["stats"] = fleet.item_stats(rec) if rec else {}
            out += self._wiki_options(slot_type, size, out)          # ones UEX doesn't list (the Helix lasers)
            return {"ok": True, "items": out, "key": fleet.KEY_STAT.get(slot_type)}
        return self._uex_call(run)

    # Racks only made for one ship (the Sabre Firebird's, the MOTH's) aren't offered for other ships
    def _rack_options(self, size, uid=None):
        """Missile racks for a missile hardpoint of this size: UEX's (with shop prices) and the wiki's, each
        with how many missiles it holds and their size."""
        out, seen = [], set()
        stock_names = set()
        if uid:
            f = self._ship(uid)
            v = self._vehicle_rows().get(f["vehicle_id"], {}) if f else {}
            name = v.get("name") or (f or {}).get("name") or ""
            try:
                data = self._wikiapi.vehicle([v.get("uuid"), name, v.get("slug"), name.lower().replace(" ", "-"),
                                              v.get("name_full"), v.get("wiki_page")]) if f else None
            except Exception:
                data = None
            if data:
                stock_names = {((s.get("stock") or {}).get("name") or "").lower()
                               for s in fleet.Wiki.loadout(data)["slots"] if s["type"] == "MissileLauncher"}

        def generic(name, class_name=""):
            # Behring's MSD racks fit any missile hardpoint of their size; named ship racks only their ship
            return bool(re.search(r"\bMSD-\d{3}\b", name or "", re.I) or re.search(r"_BEHR_", class_name or "", re.I))
        try:
            spots = self._item_spots()
            cats = [c for c in self._uex.get("categories")[0] if (c.get("type") or "item") == "item"
                    and self._slot_type_for(c.get("name")) == "MissileLauncher"]
            for c in cats:
                for i in self._uex.get("items", {"id_category": int(c["id"])})[0]:
                    nm = i.get("name") or ""
                    if not nm or (size and str(i.get("size") or "") not in (str(size), "")):
                        continue
                    buy = spots.get(i["id"], [])
                    if not buy and not generic(nm) and nm.lower() not in stock_names:
                        continue
                    seen.add(nm.lower())
                    if i.get("uuid"):
                        seen.add(i["uuid"].lower())
                    out.append({"id": i["id"], "uuid": i.get("uuid"), "name": nm, "maker": i.get("company_name") or "",
                                "size": i.get("size"), "grade": i.get("quality"),
                                "stats": {}, "price": buy[0]["price"] if buy else None, "buy": buy[:6]})
        except uex.UexError:
            pass
        try:
            wiki = self._wikiapi.items_of_type("MissileLauncher")
        except Exception:
            wiki = []
        for w in wiki:
            nm = w.get("name") or ""
            if not nm or nm.lower() in seen or (w.get("uuid") or "").lower() in seen:
                continue
            if size and str(w.get("size") or "") != str(size):
                continue
            if re.search(r"(?i)\b(test|template|placeholder)\b|_ai_|_npc|derelict", f"{w.get('class_name')} {nm}"):
                continue
            if not generic(nm, w.get("class_name")) and nm.lower() not in stock_names:
                continue
            seen.add(nm.lower())
            spec = fleet.rack_spec(nm, w.get("class_name"))
            out.append({"id": w.get("uuid") or nm, "uuid": w.get("uuid"), "name": nm, "maker": w.get("maker") or "",
                        "size": w.get("size"), "grade": w.get("grade"),
                        "stats": {k: spec[k] for k in ("missiles", "missile_size") if k in spec},
                        "price": None, "buy": []})
        for i in out:
            if not i["stats"].get("missiles"):
                i["stats"] = self._rack_spec_for(i["name"], i.get("uuid"))
        out.sort(key=lambda x: (x["price"] is None, x["price"] or 0, x["name"] or ""))
        return {"ok": True, "items": out, "key": "missiles", "source": "rack"}

    def _game_options(self, slot_type, game):
        """Game-file components joined with UEX shop prices (by UUID, else name)."""
        prices, by_name = {}, {}
        if self._uex.token or (HERE / "uex_cache" / "items_prices_all.json").exists():
            try:
                spots = self._item_spots()
                words = fleet.SLOT_TYPES.get(slot_type, ("", ()))[1]
                for c in self._uex.get("categories")[0]:
                    nm = (c.get("name") or "").lower()
                    if (c.get("type") or "item") == "item" and any(w in nm for w in words) and \
                            not any(k in f"{c.get('section') or ''} {nm}".lower() for k in self.COMPONENT_SKIP):
                        for i in self._uex.get("items", {"id_category": int(c["id"])})[0]:
                            buy = spots.get(i["id"], [])
                            if i.get("uuid"):
                                prices[i["uuid"]] = buy
                            by_name.setdefault((i.get("name") or "").lower(), buy)
            except uex.UexError:
                pass
        out, seen = [], set()
        for g in game:
            sig = (g.get("name"), g.get("grade"), json.dumps(g.get("stats"), sort_keys=True))
            if sig in seen:                                  # the game files hold some parts twice
                continue
            seen.add(sig)
            buy = prices.get(g["uuid"]) or by_name.get((g.get("name") or "").lower()) or []
            out.append({"id": g["uuid"], "uuid": g["uuid"], "name": g["name"], "maker": g.get("maker") or "",
                        "size": g.get("size"), "grade": g.get("grade"), "class": g.get("class"),
                        "stats": dict(g.get("stats") or {}), "price": buy[0]["price"] if buy else None, "buy": buy[:6]})
        if slot_type == "Cooler":                            # cooling rate: from the wiki
            from concurrent.futures import ThreadPoolExecutor
            with ThreadPoolExecutor(max_workers=8) as ex:
                recs = list(ex.map(lambda i: self._wikiapi.item(i["uuid"], i["name"]), out))
            for i, rec in zip(out, recs):
                i["stats"].update({k: v for k, v in (fleet.item_stats(rec) if rec else {}).items() if k not in i["stats"]})
        out.sort(key=lambda x: (x["price"] is None, x["price"] or 0, x["name"] or ""))
        return {"ok": True, "items": out, "key": fleet.KEY_STAT.get(slot_type), "source": "game"}

    def fleet_set_part_power(self, uid, port, pips):
        f = next((x for x in self._fleet() if x["uid"] == uid), None)
        if not f:
            return {"ok": False, "error": "That ship isn't in your fleet"}
        pw = f.setdefault("power", {})
        parts = pw.setdefault("parts", {}).setdefault(pw.get("mode", "scm"), {})
        if pips is None:
            parts.pop(port, None)
        else:
            parts[port] = max(0, int(pips))
        self._save_settings()
        return {"ok": True}

    def fleet_set_power(self, uid, pips=None, mode=None, cooling=None, auto=False):
        """Power settings for a ship's EM/IR: pips in use (None = all), SCM/NAV, cooling in use %."""
        f = next((x for x in self._fleet() if x["uid"] == uid), None)
        if not f:
            return {"ok": False, "error": "That ship isn't in your fleet"}
        pw = f.setdefault("power", {})
        if auto:                                         
            pw.pop("parts", None)
            pw.pop("pips", None)
            pw.pop("cooling", None)
        if pips is not None:
            pw["pips"] = None if pips == "all" else int(pips)
        if mode in ("scm", "nav"):
            pw["mode"] = mode
        if cooling == "auto":
            pw.pop("cooling", None)
        elif cooling is not None:
            pw["cooling"] = max(0, min(100, int(cooling)))
        self._save_settings()
        return {"ok": True}

    def fleet_set_slot(self, uid, port, item_name, uuid=None, loadout=None):
        """Fit a part to a slot (or back to stock with no item_name), in the loadout shown in My Fleet, or
        another one: loadout="primary" (the Components tab) or a loadout's id."""
        f = next((x for x in self._fleet() if x["uid"] == uid), None)
        if not f:
            return {"ok": False, "error": "That ship isn't in your fleet"}
        lo = (self._loadout_of(f, loadout) or self._loadout_of(f))["loadout"]
        if item_name and str(item_name).endswith(" (stock)"):    # the stock flight blade: no swap
            item_name = None
        old = lo.get(port)
        old = (old.get("name") if isinstance(old, dict) else old) or None
        if (old or None) != (item_name or None):
            # A different missile rack holds different missiles: the ones fitted on the old rack go with it
            for k in [k for k in lo if k.startswith(f"{port}/") and "missile" in k.lower()]:
                lo.pop(k, None)
        if item_name:
            lo[port] = {"name": item_name, "uuid": uuid}
        else:
            lo.pop(port, None)
        self._save_settings()
        return {"ok": True}
