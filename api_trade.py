"""Api, part of: UEX trade data: commodities, markets and place stock, shared routes, and your trade runs.

A mixin of app.py's Api (class Api(... TradeMixin ...)): the methods are the Api's, `self` is the one Api.
Module-level names come from qbase.py."""
from qbase import *  # noqa: F401,F403


class TradeMixin:
    # ------------------------------------------------------------ UEX: trade data
    def _uex_call(self, fn):
        try:
            return fn()
        except uex.UexError as e:
            return {"ok": False, "error": str(e)}

    def _dist_from_you(self, place):
        L = self._db.locations.get(place) if place else None
        if not L or not L.pos or not self._player or L.system != self._player_sys:
            return None
        return dist(self._db.global_pos(L, time.time()), self._player)

    def _fuel_at(self, place):
        if not self._uex.token:
            return None
        try:
            places = self._uex.place_map(self._db.locations)
            rows, _ = self._uex.get("fuel_prices_all")
        except uex.UexError:
            return None
        return [{"what": r["commodity_name"], "price": r["price_buy"]} for r in rows
                if places.get(r["id_terminal"]) == place and r.get("price_buy")] or None

    def set_uex_token(self, token, _from_account=False):
        token = (token or "").strip()
        if not token:
            self._uex.token = ""
            self._settings.pop("uex_token", None)
            self._save_settings()
            return {"ok": True, "cleared": True}
        try:
            self._uex.test(token)               # a wrong token is reported and dropped, never kept
        except uex.UexError as e:
            return {"ok": False, "error": str(e) + (". Your saved token is still in use" if self._uex.token else "")}
        old = (self._settings.get("uex_token") or "").strip()
        self._uex.token = token
        self._settings["uex_token"] = token
        self._save_settings()
        self._refresh_uex_places()
        if not _from_account and token != old:
            self._account_keys_push_soon()
        if old and old != token and self._community.url:
            threading.Thread(target=self._backup_move, args=(old,), daemon=True).start()   # a new token
        else:
            threading.Thread(target=self._backup_restore_if_empty, daemon=True).start()   # a fresh install
        return {"ok": True}

    def _backup_move(self, old):
        """You replaced your UEX Bearer Token (a new UEX app, or the old one regenerated). Backups are
        locked with the token, so bring in what the old token's backup has, save it all again under the
        new token, and remove the old one: the backup follows you to the new token instead of being lost."""
        try:
            r = self.backup_restore(token=old)
            if r.get("ok") and r.get("added"):
                self._backup_note = f"Brought in from your previous backup: {r['summary']}"
            if self._settings.get("backup_off"):
                return
            if self.backup_now(force=True).get("ok") and (r.get("ok") or "no backup" in (r.get("error") or "")):
                k = backup.keys(old)
                self._community.backup_get(k["slot"], k["auth"], delete=True)
            elif not r.get("ok"):
                self._backup_restore_if_empty()
        except Exception as e:
            print("backup move:", e, flush=True)

    def _refresh_uex_places(self):
        """Fetch UEX's station list and add the stations Quantum lacks (renames carry into the route)."""
        with self._lock:
            ren = self._apply_uex_stations(offline=False)
            if ren:
                for t in self._route:
                    t["place"] = ren.get(t["place"], t["place"])
                if self._guide in ren:
                    self._guide = ren[self._guide]
                self._save_settings()
            self._db_changed()

    def uex_status(self):
        if not self._uex.token:
            return {"ok": False, "token": False}
        if not (HERE / "uex_cache" / "space_stations.json").exists():
            try:
                self._refresh_uex_places()        # token from before stations were added: fetch them once
            except Exception:
                pass
        st = dict(self._uex.status(self._db.locations), token=True)
        if st.get("ok"):
            # Places reported as not existing in the game (by you, or agreed by datarunners) aren't
            # "not on the map": they're left out, and only counted.
            hk = self._hidden_keys()
            gone = [n for n in st["unmatched"] if _place_key(n) in hk]
            st["terminals"] -= sum(st.get("unmatched_terms", {}).get(n, 1) for n in gone)   # not in the game: not counted
            st["unmatched"] = [n for n in st["unmatched"] if _place_key(n) not in hk]
            st.pop("unmatched_terms", None)
            # Ones Quantum knows but can't place yet: they're "Map a station" jobs, waiting for a /showlocation
            pending = {services._key(n): n for n in self._unplaced}
            st["needs_position"] = sorted(pending[services._key(n)] for n in st["unmatched"] if services._key(n) in pending)
            st["unmatched"] = [n for n in st["unmatched"] if services._key(n) not in pending]
        return st

    def uex_commodities(self):
        def run():
            rows, at = self._uex.get("commodities")
            out = [{"id": c["id"], "name": c["name"], "code": c["code"], "kind": c.get("kind"), "wiki": c.get("wiki"),
                    "raw": bool(c.get("is_raw")), "mineral": bool(c.get("is_mineral")),
                    "harvestable": bool(c.get("is_harvestable")), "volatile": bool(c.get("is_volatile_qt")),
                    "illegal": bool(c.get("is_illegal")), "buy": c.get("price_buy"), "sell": c.get("price_sell")}
                   for c in rows if c.get("is_available_live", 1) and (c.get("is_buyable") or c.get("is_sellable"))]
            return {"ok": True, "items": sorted(out, key=lambda c: c["name"]), "at": at}
        return self._uex_call(run)

    def uex_market(self, id_commodity):
        """Where to buy and sell one commodity, best price first."""
        def run():
            terms = self._uex.terminals()
            places = self._uex.place_map(self._db.locations)
            rows, at = self._uex.get("commodities_prices_all")
            rows = self._community.overlay(rows)              # newer datarunner reports from Quantum users
            buy, sell = [], []
            for r in rows:
                t = terms.get(r["id_terminal"])
                if r["id_commodity"] != id_commodity or not t:
                    continue
                place = places.get(r["id_terminal"])
                base = {"terminal": t.get("name"), "where": uex.where(t), "system": t.get("star_system_name"),
                        "place": place, "dist": self._dist_from_you(place), "updated": r.get("date_modified"),
                        "max_box": t.get("max_container_size"), "containers": r.get("container_sizes")}
                if r.get("price_buy"):
                    buy.append(dict(base, price=r["price_buy"], avg=r.get("price_buy_avg"), scu=r.get("scu_buy"),
                                    status=r.get("status_buy"), community=r.get("community_buy")))
                if r.get("price_sell"):
                    sell.append(dict(base, price=r["price_sell"], avg=r.get("price_sell_avg"),
                                     scu=r.get("scu_sell_stock"), status=r.get("status_sell"), community=r.get("community_sell")))
            buy.sort(key=lambda x: x["price"])
            sell.sort(key=lambda x: -x["price"])
            return {"ok": True, "buy": buy, "sell": sell, "at": at}
        return self._uex_call(run)

    def uex_trade_places(self):
        """The map places that have a commodity terminal (for the Commodities button on a place's card).
        From the cached terminal list, so it's quick; {ok, places: [name]}."""
        def run():
            terms = self._uex.terminals()
            places = self._uex.place_map(self._db.locations)
            have = {places.get(tid) for tid, t in terms.items() if t.get("type") == "commodity" and uex.is_live(t)}
            have.discard(None)
            return {"ok": True, "places": sorted(have)}
        return self._uex_call(run)

    def uex_place_stock(self, place):
        """What a place's commodity terminals buy and sell: price, stock (SCU and level) and when each was last
        reported, for the Commodities view on its card. Quantum datarunners' newer reports are laid over UEX's.
        -> {ok, place, terminals: [{name, id, updated, oldest, rows: [{name, buy?, sell?}]}], at}."""
        def run():
            terms = self._uex.terminals()
            places = self._uex.place_map(self._db.locations)
            tids = {tid for tid, t in terms.items()
                    if t.get("type") == "commodity" and uex.is_live(t) and places.get(tid) == place}
            if not tids:
                return {"ok": True, "place": place, "terminals": [], "at": None}
            rows, at = self._uex.get("commodities_prices_all")
            rows = self._community.overlay(rows)
            names = {c["id"]: c["name"] for c in self._uex.get("commodities")[0]}
            out = {tid: [] for tid in tids}
            for r in rows:
                tid = r.get("id_terminal")
                if tid not in out:
                    continue
                item = {"name": names.get(r.get("id_commodity")) or r.get("commodity_name") or f"#{r.get('id_commodity')}",
                        "id_commodity": r.get("id_commodity")}
                if (r.get("price_buy") or 0) > 0:
                    item["buy"] = {"price": r["price_buy"], "scu": r.get("scu_buy"), "status": r.get("status_buy"),
                                   "status_name": datarunner.STATUS.get(r.get("status_buy")),
                                   "at": self._side_at(r, "buy") or None, "community": bool(r.get("community_buy"))}
                if (r.get("price_sell") or 0) > 0:
                    item["sell"] = {"price": r["price_sell"], "scu": r.get("scu_sell_stock") or r.get("scu_sell"),
                                    "status": r.get("status_sell"), "status_name": datarunner.STATUS.get(r.get("status_sell")),
                                    "at": self._side_at(r, "sell") or None, "community": bool(r.get("community_sell"))}
                if "buy" in item or "sell" in item:
                    out[tid].append(item)
            res = []
            for tid, items in out.items():
                t = terms[tid]
                dates = [s["at"] for i in items for s in (i.get("buy"), i.get("sell")) if s and s.get("at")]
                items.sort(key=lambda i: i["name"].lower())
                res.append({"id": tid, "name": t.get("name") or t.get("nickname") or str(tid), "where": uex.where(t),
                            "updated": max(dates) if dates else None, "oldest": min(dates) if dates else None,
                            "autoload": bool(t.get("is_auto_load")), "max_box": t.get("max_container_size"),
                            "rows": items})
            res.sort(key=lambda x: x["name"].lower())
            return {"ok": True, "place": place, "terminals": res, "at": at}
        return self._uex_call(run)

    # ---- trade routes Quantum users share
    def shared_routes(self, origin=None):
        """Routes from other Quantum users' Planned Routes, with profit per SCU. origin: the Find Routes
        "From" place; a route is kept if it starts there (its planet, or the place itself)."""
        out = []
        for r in self._community.routes():
            loc = self._db.locations.get(r["from_place"])
            planet = getattr(loc, "body", None) or getattr(loc, "parent", None)
            if origin and origin not in (r["from_place"], r.get("from_terminal"), planet, getattr(loc, "system", None)):
                continue
            out.append(dict(r, per_scu=round(r["sell"] - r["buy"], 2),
                            profit=round((r["sell"] - r["buy"]) * r["units"]) if r.get("units") else None))
        return {"ok": True, "routes": out}

    def share_route(self, rid):
        """Share one of your Planned Routes with Quantum users."""
        x = next((r for r in self._runs() if r["id"] == rid), None)
        if not x:
            return {"ok": False, "error": "Route not found"}
        user = self._dr_cfg().get("username") or (self._dr_cfg().get("uex_user") or {}).get("username")
        if not user:
            return {"ok": False, "error": "Add your UEX Secret Key in Settings, so the route is credited to your UEX name"}
        buy, sell = x.get("buy_price") or x.get("plan_buy"), x.get("sell_price") or x.get("plan_sell")
        if not (x.get("commodity") and x.get("from_place") and x.get("to_place") and buy and sell):
            return {"ok": False, "error": "A route needs a commodity, both places, and buy and sell prices to share"}
        return self._community.share_route({"commodity": x["commodity"], "from_place": x["from_place"], "to_place": x["to_place"],
                                            "from_terminal": x.get("from_terminal"), "to_terminal": x.get("to_terminal"),
                                            "buy": buy, "sell": sell, "units": x.get("units"), "notes": x.get("notes")}, user)

    # ------------------------------------------------------------ my trade runs
    # A run's steps. "bought" is shown as Purchased (the key is kept so saved runs still work); loading is
    # after buying, off loading (unloading) after arriving, before it's sold.
    TRADE_STAGES = ("planned", "bought", "loading", "transit", "unloading", "sold")

    def _runs(self):
        return self._settings.setdefault("trade_runs", [])

    def trade_runs(self):
        return {"ok": True, "runs": sorted(self._runs(), key=lambda r: -r.get("created", 0))}

    def trade_run_save(self, run):
        """Create or update one of your trade runs (from a found route or entered yourself)."""
        run = dict(run or {})
        if not (run.get("commodity") or "").strip():
            return {"ok": False, "error": "Enter the commodity"}
        for k in ("units", "buy_price", "sell_price", "plan_buy", "plan_sell", "handling", "load_fee", "unload_fee"):
            v = run.get(k)
            run[k] = float(v) if v not in (None, "") else None
        runs = self._runs()
        old = next((r for r in runs if r["id"] == run.get("id")), None)
        if old:
            old.update({k: v for k, v in run.items() if k not in ("id", "created", "times", "tracking_no")})
        else:
            used = {r.get("tracking_no") for r in runs}
            while True:
                tn = "1SC" + "".join(secrets.choice("0123456789") for _ in range(15))
                if tn not in used:
                    break
            run.update({"id": f"t{int(time.time() * 1000)}", "created": time.time(), "stage": "planned",
                        "times": {"planned": time.time()}, "tracking_no": tn})
            runs.append(run)
        self._save_settings()
        return {"ok": True, "id": (old or run)["id"]}

    def trade_run_stage(self, rid, stage, price=None, fee=None):
        """Move a run along: planned > purchased > loading > in transit > off loading > sold. Buying or
        selling can record the price you actually got (per SCU) and what auto loading / unloading cost."""
        r = next((x for x in self._runs() if x["id"] == rid), None)
        if not r or stage not in self.TRADE_STAGES:
            return {"ok": False, "error": "Run not found"}
        r["stage"] = stage
        r.setdefault("times", {})[stage] = time.time()
        for later in self.TRADE_STAGES[self.TRADE_STAGES.index(stage) + 1:]:
            r["times"].pop(later, None)             # stepping back clears what came after
        if price not in (None, "") and stage in ("bought", "sold"):       # not when stepping back
            r["buy_price" if stage == "bought" else "sell_price"] = float(price)
        if fee not in (None, "") and stage in ("bought", "sold"):
            r["load_fee" if stage == "bought" else "unload_fee"] = float(fee)
        self._save_settings()
        return {"ok": True}

    def _auto_trade_transit(self):
        """Smart departure for trade runs, like contracts: setting your in-game route (quantum
        destination) to a purchased (or loading) run's sell place, or its planet/moon, puts the run in transit."""
        q = self._tracker.qt or {}
        sel, dest = q.get("selected"), q.get("place") or q.get("dest")
        if not sel or not dest or sel == getattr(self, "_trade_qt_seen", None):
            return
        self._trade_qt_seen = sel
        comp = lambda x: "".join(ch for ch in (x or "").lower() if ch.isalnum())
        L = self._db.locations.get(dest)
        names = {comp(dest)} | ({comp(L.name), comp(L.body)} if L else set())
        names.discard("")
        changed = False
        for r in self._runs():
            if r.get("stage") not in ("bought", "loading") or (r.get("times") or {}).get("bought", 0) > sel + 5:
                continue
            targets = {comp(r.get("to_place")), comp(r.get("to_terminal"))} - {""}
            if any(n == t or (len(n) > 5 and (n in t or t in n)) for n in names for t in targets):
                r["stage"] = "transit"
                r.setdefault("times", {})["transit"] = sel
                r["transit_how"] = "route"
                changed = True
        if changed:
            self._save_settings()
            self._trade_changed = getattr(self, "_trade_changed", 0) + 1

    def trade_run_delete(self, rid):
        self._settings["trade_runs"] = [x for x in self._runs() if x["id"] != rid]
        self._save_settings()
        return {"ok": True}

    def uex_origins(self):
        """Starting points for trade routes: every planet (or orbit, where UEX has no planet) that has
        a commodity terminal, with its terminals (to start from one place, like Baijini Point), plus the
        one nearest you."""
        def run():
            terms = self._uex.terminals()
            places = self._uex.place_map(self._db.locations)
            opts, near, at = {}, None, {}
            for tid, t in terms.items():
                if t.get("type") != "commodity":
                    continue
                key = ("planet", t["id_planet"], t.get("planet_name")) if t.get("id_planet") else \
                      ("orbit", t["id_orbit"], t.get("orbit_name"))
                if key[1] and key[2]:
                    opts[key] = t.get("star_system_name")
                    at.setdefault(key, []).append({"id": tid, "name": t.get("name") or places.get(tid) or str(tid),
                                                   "place": places.get(tid)})
                d = self._dist_from_you(places.get(tid))
                if d is not None and (near is None or d < near[0]):
                    near = (d, key)
            items = [{"kind": k[0], "id": k[1], "name": k[2], "system": sysn,
                      "terminals": sorted(at.get(k, []), key=lambda x: x["name"].lower())} for k, sysn in opts.items()]
            items.sort(key=lambda o: (SYSTEM_ORDER.get(o["system"], 9), o["name"]))
            here = {"kind": near[1][0], "id": near[1][1], "name": near[1][2]} if near else None
            return {"ok": True, "items": items, "here": here}
        return self._uex_call(run)

    ROUTES_PER_COMMODITY = 4      # wide searches: at most this many runs of one commodity in the list
    # Trade routes only use prices reported in the last day: older ones are too often wrong (emptied
    # stock, changed prices) to plan a run on. A run is as fresh as the older of its two prices.
    ROUTE_MAX_AGE_H = 24

    @staticmethod
    def _side_at(p, side):
        """When one side ("buy" or "sell") of a price row was last reported: a Quantum datarunner's report
        when there's a newer one, else UEX's date for the row. 0 when unknown."""
        if not p:
            return 0
        c = p.get(f"community_{side}")
        if c and c.get("at"):
            return c["at"]
        return p.get("uex_modified", p.get("date_modified")) or 0

    def _route_age_h(self, max_age_h=None):
        """How old a price may be for a route: what was asked for (Price age), never more than ROUTE_MAX_AGE_H."""
        try:
            h = float(max_age_h) if max_age_h not in (None, "", 0, "0") else self.ROUTE_MAX_AGE_H
        except (TypeError, ValueError):
            h = self.ROUTE_MAX_AGE_H
        return max(0.25, min(h, self.ROUTE_MAX_AGE_H))

    def _route_cutoff(self, max_age_h=None):
        return time.time() - self._route_age_h(max_age_h) * 3600

    def _price_routes(self, system=None, stay="", avoid=None, one_system=False, per_origin=6, max_age_h=None):
        """UEX-style route rows worked out from every terminal's prices (one cached request), for searches
        wider than one planet: the whole game, or one whole system. UEX's own routes endpoint only takes a
        single starting planet, orbit or terminal. system: only runs that start there (None: anywhere).
        Prices over ROUTE_MAX_AGE_H old aren't used at all, so the runs found are among fresh prices."""
        terms = self._uex.terminals()
        rows, at = self._uex.get("commodities_prices_all")
        rows = self._community.overlay(rows)
        names = {c["id"]: c["name"] for c in self._uex.get("commodities")[0]}
        cut = self._route_cutoff(max_age_h)
        buys, sells = {}, {}
        for r in rows:
            t = terms.get(r.get("id_terminal"))
            if not t or not uex.is_live(t):
                continue
            if (r.get("price_buy") or 0) > 0 and (not system or t.get("star_system_name") == system) \
                    and self._side_at(r, "buy") >= cut:
                buys.setdefault(r["id_commodity"], []).append((r, t))
            if (r.get("price_sell") or 0) > 0 and self._side_at(r, "sell") >= cut:
                sells.setdefault(r["id_commodity"], []).append((r, t))
        avoid = set(avoid or ())

        def allowed(so, sd):
            return not ((stay and (so != stay or sd != stay)) or so in avoid or sd in avoid or (one_system and so != sd))
        out = []
        for cid, B in buys.items():
            S_ = sorted(sells.get(cid) or (), key=lambda x: -x[0]["price_sell"])
            if not S_:
                continue
            for rb, tb in B:
                pb, n = rb["price_buy"], 0
                for rs, ts in S_:
                    ps = rs["price_sell"]
                    if ps <= pb or n >= per_origin:
                        break
                    if tb is ts or not allowed(tb.get("star_system_name"), ts.get("star_system_name")):
                        continue
                    n += 1
                    out.append({
                        "commodity_name": names.get(cid) or rb.get("commodity_name") or str(cid), "id_commodity": cid,
                        "code": None, "price_origin": pb, "price_destination": ps,
                        "price_margin": ps - pb, "price_roi": (ps - pb) / pb * 100,
                        "id_terminal_origin": tb["id"], "id_terminal_destination": ts["id"],
                        "origin_terminal_name": tb.get("name"), "destination_terminal_name": ts.get("name"),
                        "origin_star_system_name": tb.get("star_system_name"),
                        "destination_star_system_name": ts.get("star_system_name"),
                        "origin_orbit_name": tb.get("orbit_name") or tb.get("planet_name"),
                        "destination_orbit_name": ts.get("orbit_name") or ts.get("planet_name"),
                        "scu_origin": rb.get("scu_buy"), "scu_destination": None,
                        "status_origin": rb.get("status_buy"), "status_destination": rs.get("status_sell"),
                        "container_sizes_origin": rb.get("container_sizes") or tb.get("container_sizes"),
                        "container_sizes_destination": rs.get("container_sizes") or ts.get("container_sizes"),
                        "date_origin": self._side_at(rb, "buy"), "date_destination": self._side_at(rs, "sell"),
                        "date_added": min(self._side_at(rb, "buy"), self._side_at(rs, "sell")) or None,
                        "community_origin": rb.get("community_buy"), "community_destination": rs.get("community_sell"),
                        "faction_origin": tb.get("faction_name"), "faction_destination": ts.get("faction_name"),
                        **{f"{flag}_{side}": t.get(flag) for side, t in (("origin", tb), ("destination", ts))
                           for flag in ("has_freight_elevator", "has_loading_dock", "has_refuel", "has_docking_port",
                                        "is_space_station", "is_on_ground", "is_monitored")}})
        return out, at

    def _routes_with_quantum(self, rows, kind, origin_id, stay="", avoid=None, one_system=False, max_age_h=None):
        """UEX's routes from one planet, orbit or terminal, with Quantum users' newer price reports laid over
        them (the same overlay the wide searches use): a terminal UEX still lists with 240 SCU that a Quantum
        datarunner saw at 146 ten minutes ago is planned with 146, and its profit and place in the list
        follow. Runs only Quantum's newer prices make profitable are added from the price table too."""
        try:
            prices, _ = self._uex.get("commodities_prices_all")
            prices = self._community.overlay(prices)
        except Exception:
            return rows
        idx = {(p.get("id_terminal"), p.get("id_commodity")): p for p in prices}
        out = []
        for r in rows or []:
            r = dict(r)
            cid = r.get("id_commodity")
            pb = idx.get((r.get("id_terminal_origin"), cid))
            if pb and pb.get("community_buy"):
                r["price_origin"], r["scu_origin"] = pb.get("price_buy") or 0, pb.get("scu_buy")
                r["status_origin"], r["community_origin"] = pb.get("status_buy"), pb["community_buy"]
            ps = idx.get((r.get("id_terminal_destination"), cid))
            if ps and ps.get("community_sell"):
                r["price_destination"], r["status_destination"] = ps.get("price_sell") or 0, ps.get("status_sell")
                r["community_destination"] = ps["community_sell"]
            if r.get("community_origin") or r.get("community_destination"):
                po, pd = r.get("price_origin") or 0, r.get("price_destination") or 0
                r["price_margin"] = pd - po
                r["price_roi"] = (pd - po) / po * 100 if po else 0
            # Each end's own report time, from the price table (UEX's route row only has when the route
            # was worked out, which says nothing about how old its prices are)
            r["date_origin"], r["date_destination"] = self._side_at(pb, "buy"), self._side_at(ps, "sell")
            out.append(r)
        # runs from here UEX doesn't list (yet): worked out from the overlaid price table
        try:
            terms = self._uex.terminals()
            want = {"planet": "id_planet", "orbit": "id_orbit", "terminal": "id"}[kind]
            have = {(r.get("id_commodity"), r.get("id_terminal_origin"), r.get("id_terminal_destination")) for r in out}
            extra, _ = self._price_routes(None, stay, avoid, one_system, max_age_h=max_age_h)
            for x in extra:
                t = terms.get(x["id_terminal_origin"]) or {}
                if str(t.get(want)) != str(origin_id):
                    continue
                k = (x["id_commodity"], x["id_terminal_origin"], x["id_terminal_destination"])
                if k in have:
                    continue
                pb = idx.get((x["id_terminal_origin"], x["id_commodity"])) or {}
                ps = idx.get((x["id_terminal_destination"], x["id_commodity"])) or {}
                if not (pb.get("community_buy") or ps.get("community_sell")):
                    continue                               # UEX left it out for its own reasons
                x = dict(x, community_origin=pb.get("community_buy"), community_destination=ps.get("community_sell"))
                out.append(x)
        except Exception:
            pass
        return out

    # ---- How long a run takes, roughly, so runs can be ranked by aUEC per hour instead of only by the
    # profit of one trip. Deliberately simple: quantum travel at ~0.2 c plus spool/align per leg, time to
    # land or dock at each end, loading and unloading (much quicker where the terminal auto-loads), and a
    # gateway crossing per system jump. Used to compare runs, not as a promise.
    QT_SPEED = 0.2 * 299_792_458        # m/s
    QT_LEG_S = 60                       # spool, align, accelerate and slow down
    DOCK_S = {"station": 180, "ground": 420, "other": 300}
    JUMP_S = 600                        # fly to the gateway, through it, and on
    LOAD_S_PER_SCU, LOAD_MIN_S, AUTOLOAD_S = 1.5, 120, 90

    def _run_minutes(self, x, units, start_dist=None):
        legs = 0.0
        if start_dist:
            legs += self.QT_LEG_S + start_dist / self.QT_SPEED
        d = x.get("dist") or 0
        legs += self.QT_LEG_S + (d / self.QT_SPEED if d and d < 5e12 else 600)
        if x.get("cross_system"):
            legs += self.JUMP_S
        dock = lambda st, gr: self.DOCK_S["station" if st else "ground" if gr else "other"]
        legs += dock(x.get("from_station"), x.get("from_ground")) + dock(x.get("to_station"), x.get("to_ground"))
        handle = lambda auto: self.AUTOLOAD_S if auto else max(self.LOAD_MIN_S, units * self.LOAD_S_PER_SCU)
        legs += handle(x.get("autoload_from")) + handle(x.get("autoload_to"))
        return legs / 60

    @staticmethod
    def _price_trust(x, now):
        """0.55..1: how far to trust a run's prices. Fresh reports (or a Quantum datarunner's) count fully;
        prices hours old (anything over ROUTE_MAX_AGE_H is left out before this), or with few reports behind
        them, less: they're the runs that turn out empty."""
        upd = x.get("updated") or 0             # the older of the run's two prices (all under a day old)
        age_h = (now - upd) / 3600 if upd else 24
        t = 1.0 if age_h <= 2 else max(0.7, 1.0 - (age_h - 2) / 22 * 0.3)
        if x.get("quantum_from") or x.get("quantum_to"):
            t = max(t, 0.95)
        rep = min(x.get("reports_from") or 0, x.get("reports_to") or 0)
        if upd and rep and rep < 2:
            t *= 0.9
        if x.get("units") and x.get("scu_from") and x["scu_from"] < x["units"] * 1.05:
            t *= 0.92                   # you'd empty the terminal: the next one there finds less
        return round(max(0.55, t), 3)

    def uex_routes(self, kind, origin_id, scu=0, budget=0, stay="", avoid=None, one_system=False, autoload="", sort="profit",
                   min_profit=0, max_age_h=None):
        """Best runs from a planet/orbit/terminal for your cargo space and budget, most profit first.
        min_profit: runs that would make less than this (aUEC, for the units you'd carry) aren't listed: a
        200 aUEC margin or a 1 SCU haul isn't worth the trip. How many were left out is returned.
        max_age_h: only prices reported this recently (Price age; at most ROUTE_MAX_AGE_H).
        sort "fresh": the runs with the most recent prices first (by the older of each run's two prices).
        kind "all" searches every system at once, kind "system" one whole system (origin_id is its name).
        autoload: "" any terminal, "buy" only where the buy terminal loads your ship for you, "both" only
        where both ends do (UEX's is_auto_load on the terminal)."""
        def run():
            terms = self._uex.terminals()
            auto = lambda tid: bool((terms.get(tid) or {}).get("is_auto_load"))
            wide = kind in ("all", "system")
            if wide:
                rows, at = self._price_routes(str(origin_id) if kind == "system" else None, stay, avoid, one_system,
                                              max_age_h=max_age_h)
            else:
                key = {"planet": "id_planet_origin", "orbit": "id_orbit_origin", "terminal": "id_terminal_origin"}[kind]
                rows, at = self._uex.get("commodities_routes", {key: int(origin_id)})
                rows = self._routes_with_quantum(rows, kind, origin_id, stay, avoid, one_system, max_age_h=max_age_h)
            places = self._uex.place_map(self._db.locations)
            age_h = self._route_age_h(max_age_h)
            out, cut, old, small = [], self._route_cutoff(age_h), 0, 0
            try:
                floor = max(0.0, float(min_profit or 0))      # a new name: assigning min_profit here would hide the argument
            except (TypeError, ValueError):
                floor = 0.0
            for r in rows:
                # Only prices from the last day: a run is as fresh as the older of its two prices. Rows
                # without a date of each end (the price table couldn't be read) fall back to the route's own.
                d_from, d_to = r.get("date_origin"), r.get("date_destination")
                if d_from is None:
                    d_from = r.get("date_added") or 0
                if d_to is None:
                    d_to = r.get("date_added") or 0
                if min(d_from, d_to) < cut:
                    old += 1
                    continue
                so, sd = r.get("origin_star_system_name"), r.get("destination_star_system_name")
                if so not in uex.SYSTEMS or sd not in uex.SYSTEMS:
                    continue
                if (stay and (so != stay or sd != stay)) or (avoid and (so in avoid or sd in avoid)) or \
                        (one_system and so != sd):
                    continue
                pb, ps = r.get("price_origin") or 0, r.get("price_destination") or 0
                if pb <= 0 or ps <= pb:
                    continue
                al_from, al_to = auto(r.get("id_terminal_origin")), auto(r.get("id_terminal_destination"))
                if (autoload == "buy" and not al_from) or (autoload == "both" and not (al_from and al_to)):
                    continue
                cap = [x for x in (scu, r.get("scu_origin"), r.get("scu_destination")) if x and x > 0]
                if budget and budget > 0:
                    cap.append(int(budget // pb))
                units = int(min(cap)) if cap else 0
                if units <= 0:
                    continue
                if floor and units * (ps - pb) < floor:
                    small += 1                     # too small to be worth flying
                    continue
                po, pd = places.get(r["id_terminal_origin"]), places.get(r["id_terminal_destination"])
                L1, L2 = self._db.locations.get(po), self._db.locations.get(pd)
                qd = dist(self._db.global_pos(L1, time.time()), self._db.global_pos(L2, time.time())) \
                    if L1 and L2 and L1.pos and L2.pos and L1.system == L2.system else None
                out.append({
                    "commodity": r["commodity_name"], "code": r.get("code"), "units": units,
                    "buy": pb, "sell": ps, "profit": units * (ps - pb), "cost": units * pb,
                    "margin": r.get("price_margin"), "roi": r.get("price_roi"), "score": r.get("score"),
                    "from": r.get("origin_terminal_name"), "to": r.get("destination_terminal_name"),
                    "from_place": po, "to_place": pd,
                    "from_where": ", ".join(x for x in (r.get("origin_orbit_name"), r.get("origin_star_system_name")) if x),
                    "to_where": ", ".join(x for x in (r.get("destination_orbit_name"), r.get("destination_star_system_name")) if x),
                    "cross_system": r.get("origin_star_system_name") != r.get("destination_star_system_name"),
                    "dist": qd if qd is not None else (r.get("distance") or 0) * 1e9,
                    "stock_from": r.get("status_origin"), "stock_to": r.get("status_destination"),
                    "boxes_from": r.get("container_sizes_origin"), "boxes_to": r.get("container_sizes_destination"),
                    "elevator_to": bool(r.get("has_freight_elevator_destination") or r.get("has_loading_dock_destination")),
                    "url": f"https://uexcorp.space/trade/route?code={r['code']}" if r.get("code") else None,
                    "id_commodity": r.get("id_commodity"), "updated": min(d_from, d_to),
                    "updated_from": d_from, "updated_to": d_to,
                    "scu_from": r.get("scu_origin"), "scu_to": r.get("scu_destination"),
                    "reports_from": r.get("price_origin_users_rows"), "reports_to": r.get("price_destination_users_rows"),
                    "from_station": bool(r.get("is_space_station_origin")), "to_station": bool(r.get("is_space_station_destination")),
                    "from_ground": bool(r.get("is_on_ground_origin")), "to_ground": bool(r.get("is_on_ground_destination")),
                    "from_monitored": r.get("is_monitored_origin"), "to_monitored": r.get("is_monitored_destination"),
                    "refuel_to": bool(r.get("has_refuel_destination")), "dock_from": bool(r.get("has_docking_port_origin")),
                    "refuel_from": bool(r.get("has_refuel_origin")), "dock_to": bool(r.get("has_docking_port_destination")),
                    "elevator_from": bool(r.get("has_freight_elevator_origin") or r.get("has_loading_dock_origin")),
                    "autoload_from": al_from, "autoload_to": al_to,
                    "quantum_from": r.get("community_origin"), "quantum_to": r.get("community_destination"),
                    "faction_from": r.get("origin_faction_name") or r.get("faction_origin"),
                    "faction_to": r.get("destination_faction_name") or r.get("faction_destination"),
                    "id_from": r.get("id_terminal_origin"), "id_to": r.get("id_terminal_destination")})
            # Time, aUEC per hour and how far to trust the prices, for the smarter sorts
            now = time.time()
            with self._lock:
                me, me_sys = self._player, self._player_sys
            for x in out:
                L1 = self._db.locations.get(x["from_place"]) if x["from_place"] else None
                start = None
                if me and L1 is not None and L1.pos is not None and L1.system == me_sys:
                    try:
                        start = dist(me, self._db.global_pos(L1, now))
                    except Exception:
                        start = None
                mins = self._run_minutes(x, x["units"], start)
                x["minutes"] = round(mins, 1)
                x["start_dist"] = start
                x["per_hour"] = round(x["profit"] / max(mins, 5) * 60)
                x["trust"] = self._price_trust(x, now)
                x["best"] = round(x["per_hour"] * x["trust"])
            key = {"hour": lambda x: -x["per_hour"], "best": lambda x: -x["best"],
                   "fresh": lambda x: (-(x["updated"] or 0), -x["profit"])}.get(sort, lambda x: -x["profit"])
            out.sort(key=key)
            # Where to go next: the best run that starts where this one sells (a loop instead of flying back empty)
            by_start = {}
            for x in out:
                b = by_start.get(x["id_from"])
                if x["id_from"] and (b is None or x["profit"] > b["profit"]):
                    by_start[x["id_from"]] = x
            for x in out:
                nx = by_start.get(x["id_to"])
                if nx and nx is not x:
                    x["then"] = {"commodity": nx["commodity"], "profit": nx["profit"], "to": nx["to"], "to_place": nx["to_place"]}
            if wide:                       # one commodity shouldn't fill the whole list
                seen, kept = {}, []
                for x in out:
                    n = seen.get(x["commodity"], 0)
                    if n < self.ROUTES_PER_COMMODITY:
                        seen[x["commodity"]] = n + 1
                        kept.append(x)
                total, out = len(out), kept
            else:
                total = len(out)
            return {"ok": True, "routes": out[:60], "at": at, "total": total, "wide": wide,
                    "old_left_out": old, "max_age_h": age_h,
                    "small_left_out": small, "min_profit": floor}
        return self._uex_call(run)

    def journey(self, a, b):
        """The places a run from a to b goes through: a, then for each jump the gateway you fly to and the
        one you come out at, then b. Just [a, b] in one system or when no way through is known."""
        La, Lb = self._db.locations.get(a), self._db.locations.get(b)
        if not La or not Lb or La.system == Lb.system:
            return {"ok": True, "places": [a, b]}
        path, cur = [a], La.system
        for g in gateways.gate_path(self._db, cur, Lb.system) or []:
            path.append(g)
            came = gateways.arrival(self._db, g, cur)
            if came:
                path.append(came)
            cur = gateways.leads_to(g)
        path.append(b)
        return {"ok": True, "places": path}

    def open_url(self, url):
        if isinstance(url, str) and url.startswith("https://"):
            webbrowser.open(url)
        return {"ok": True}
