"""Api, part of: The shopping list (Cart).

A mixin of app.py's Api (class Api(... ShoppingMixin ...)): the methods are the Api's, `self` is the one Api.
Module-level names come from qbase.py."""
from qbase import *  # noqa: F401,F403


class ShoppingMixin:
    # ------------------------------------------------------------ shopping list
    # The parts and gear you want to buy, and the trip that buys them all: fewest stops (or cheapest), in the
    # shortest order from where you are. Steps tick off as you buy (Game.log shows shop purchases), or by hand.
    def _shop(self):
        sh = self._settings.setdefault("shopping", {})
        sh.setdefault("items", [])
        sh.setdefault("mode", "fewest")
        return sh

    def _shop_changed(self, note=None):
        self._shop_ver = getattr(self, "_shop_ver", 0) + 1
        if note:
            self._shop_note = {"text": note, "n": self._shop_ver}
        self._save_settings()

    def _uex_part_id(self, uuid, name):
        """UEX's item id for a ship component (by uuid, else name), for its shop prices."""
        if time.time() - getattr(self, "_part_ids_at", 0) > 3600 or not getattr(self, "_part_ids", None):
            ids = {}
            try:
                ix = self.uex_component_index()
                for r in ix.get("items") or [] if ix.get("ok") else []:
                    if isinstance(r.get("id"), int):
                        if r.get("uuid"):
                            ids.setdefault(str(r["uuid"]).lower(), r["id"])
                        ids.setdefault(str(r.get("name") or "").lower(), r["id"])
            except Exception as e:
                print("part ids:", e, flush=True)
            self._part_ids, self._part_ids_at = ids, time.time()
        return self._part_ids.get(str(uuid or "").lower()) or self._part_ids.get(str(name or "").lower())

    def _gear_by_uuid(self, kind):
        try:
            data = self._gear.items(kind)
        except Exception:
            return {}
        out = {}
        for i in data.get("items") or []:            # an item merged with its copies answers to their uuids too
            for u in [i.get("uuid"), *(i.get("alias_uuids") or [])]:
                if u:
                    out.setdefault(str(u).lower(), i)
        return out

    def _shop_spots(self, e, cache):
        """Where one shopping-list entry is sold: [spot]."""
        if e["id"] in cache:
            return cache[e["id"]]
        spots = []
        if e.get("kind") in self.SHOP_GEAR:
            ix = cache.setdefault("_" + e["kind"], self._gear_by_uuid(self.SHOP_GEAR[e["kind"]]))
            g = ix.get(str(e.get("uuid") or "").lower())
            if g:
                spots = self._wiki_spots(g.get("prices"))
        else:
            iid = e.get("uex_id") if isinstance(e.get("uex_id"), int) else self._uex_part_id(e.get("uuid"), e.get("name"))
            if iid:
                if "_spots" not in cache:
                    try:
                        cache["_spots"] = self._item_spots()
                    except Exception:
                        cache["_spots"] = {}
                spots = cache["_spots"].get(iid, [])
                e["uex_id"] = iid
            if not spots:                       # parts only the wiki prices (new ones UEX doesn't list yet)
                for w in self._wiki_parts_any(e.get("uuid"), e.get("name"), cache):
                    spots = w.get("buy") or []
                    if spots:
                        break
        cache[e["id"]] = spots
        return spots

    def _wiki_parts_any(self, uuid, name, cache):
        out = []
        for words, wtype, test in self.WIKI_KINDS:
            rows = cache.setdefault("_w" + wtype, None)
            if rows is None:
                try:
                    rows = cache["_w" + wtype] = self._wiki_parts(wtype, test)
                except Exception:
                    rows = cache["_w" + wtype] = []
            out += [w for w in rows if (uuid and str(w.get("uuid") or "").lower() == str(uuid).lower())
                    or (name and w["name"].lower() == str(name).lower())]
        return out

    def shop_list(self):
        """Your shopping list: each item with its cheapest price and how many shops sell it, and the plan."""
        sh = self._shop()
        cache = {}
        items = []
        for e in sh["items"]:
            spots = self._shop_spots(e, cache)
            best = spots[0] if spots else None
            items.append(dict(e, price=best["price"] if best else None, where=best["where"] if best else None,
                              shops=len(spots), on_map=sum(1 for x in spots if x.get("place"))))
        here = (self._tracker.cur or {}).get("place")
        left = sum(max(0, (e.get("qty") or 1) - (e.get("bought") or 0)) for e in sh["items"])
        return {"ok": True, "items": items, "mode": sh["mode"], "plan": sh.get("plan"), "here": here,
                "left": left, "step": self._shop_step(sh), "ver": getattr(self, "_shop_ver", 0)}

    def _shop_step(self, sh):
        """Index of the first plan stop with something still to buy (None when done or no plan)."""
        plan = sh.get("plan") or {}
        byid = {e["id"]: e for e in sh["items"]}
        for i, st in enumerate(plan.get("steps") or []):
            if any(it["id"] in byid and (byid[it["id"]].get("bought") or 0) < (byid[it["id"]].get("qty") or 1)
                   for it in st["items"]):
                return i
        return None

    def shop_add(self, entries):
        """Add items: [{name, kind ("component" | "weapon" | "armor" | "gadget" | "clothing" | "consumable" | "utility"), uuid, uex_id, class_name, qty, source}].
        One already on the list gets its count raised instead."""
        sh = self._shop()
        n = 0
        for x in entries or []:
            if not isinstance(x, dict) or not (x.get("name") or "").strip():
                continue
            e = shopping.new_entry(x["name"].strip(), x.get("kind") or "component", x.get("uuid"), x.get("uex_id"),
                                   x.get("class_name"), x.get("qty") or 1, x.get("source"))
            have = next((h for h in sh["items"] if shopping.same_item(h, e)), None)
            if have:
                have["qty"] = (have.get("qty") or 1) + e["qty"]
            else:
                sh["items"].append(e)
            n += e["qty"]
        if n:
            sh["plan"] = None                   # the list changed: plan again
            self._shop_changed()
        left = sum(max(0, (e.get("qty") or 1) - (e.get("bought") or 0)) for e in sh["items"])
        return {"ok": True, "added": n, "count": len(sh["items"]), "left": left}

    def shop_add_loadout(self, uid):
        """Every part you've swapped into the ship's loadout shown in My Fleet (not its stock parts)."""
        lo = self.fleet_loadout(uid)
        if not lo.get("ok"):
            return lo
        want = {}
        for s_ in lo["slots"]:
            if not s_.get("fitted") or str(s_["fitted"]).endswith(" (stock)"):
                continue
            fit = ((self._ship(uid) or {}).get("loadout") or {}).get(s_["port"])
            uuid = fit.get("uuid") if isinstance(fit, dict) else None
            k = (s_["fitted"].lower(), uuid)
            w = want.setdefault(k, {"name": s_["fitted"], "kind": "component", "uuid": uuid, "qty": 0,
                                    "source": lo["ship"].get("full")})
            w["qty"] += 1
        if not want:
            return {"ok": False, "error": "This loadout has no swapped parts yet. Change some slots first"}
        r = self.shop_add(list(want.values()))
        return dict(r, parts=len(want))

    def shop_set(self, item_id, qty=None, bought=None):
        sh = self._shop()
        e = next((x for x in sh["items"] if x["id"] == item_id), None)
        if not e:
            return {"ok": False, "error": "That item isn't on your list"}
        if qty is not None:
            e["qty"] = max(1, int(qty))
            e["bought"] = min(e.get("bought") or 0, e["qty"])
            sh["plan"] = None
        if bought is not None:
            e["bought"] = max(0, min(e.get("qty") or 1, int(bought)))
        self._shop_changed()
        return {"ok": True}

    def shop_step_done(self, index):
        """Mark everything at one stop of the plan as bought."""
        sh = self._shop()
        steps = (sh.get("plan") or {}).get("steps") or []
        if not 0 <= int(index) < len(steps):
            return {"ok": False, "error": "No such stop"}
        byid = {e["id"]: e for e in sh["items"]}
        for it in steps[int(index)]["items"]:
            e = byid.get(it["id"])
            if e:
                e["bought"] = e.get("qty") or 1
        self._shop_changed()
        return {"ok": True}

    def shop_remove(self, item_id=None, bought_only=False, everything=False):
        sh = self._shop()
        before = len(sh["items"])
        if everything:
            sh["items"] = []
        elif bought_only:
            sh["items"] = [e for e in sh["items"] if (e.get("bought") or 0) < (e.get("qty") or 1)]
        else:
            sh["items"] = [e for e in sh["items"] if e["id"] != item_id]
        if len(sh["items"]) != before:
            sh["plan"] = None if not sh["items"] or not bought_only else sh.get("plan")
            self._shop_changed()
        return {"ok": True}

    def shop_plan(self, mode=None):
        """Work out the trip: which shops, and in what order from where you are."""
        sh = self._shop()
        if mode in shopping.MODES:
            sh["mode"] = mode
        if not sh["items"]:
            return {"ok": False, "error": "Your shopping list is empty"}
        cache = {}
        for e in sh["items"]:                   # shop prices first (network), so the map isn't held up meanwhile
            self._shop_spots(e, cache)
        t = time.time()
        with self._lock:
            p, psys = self._player, self._player_sys
            locs = self._db.locations

            def dist_of(place):
                L = locs.get(place)
                if not L or not p or L.system != psys or not L.pos:
                    return None
                return dist(self._db.global_pos(L, t), p)

            def system_of(place):
                L = locs.get(place)
                return L.system if L else None

            def order(places):
                ok = [x for x in places if x in locs]
                start_sys = psys or (locs[ok[0]].system if ok else None)
                return self._db.optimize(p, start_sys, ok, t) + [x for x in places if x not in locs] if ok else places

            plan = shopping.plan(sh["items"], lambda e: self._shop_spots(e, cache), dist_of, system_of,
                                 psys, sh["mode"], order)
            legs = self._db.route_length(p, psys, [s["place"] for s in plan["steps"] if s["place"] in locs], t) \
                if plan["steps"] else []
        plan["distance"] = sum(d for d in legs if d)
        plan["from_you"] = bool(p)
        sh["plan"] = plan
        self._shop_changed()
        return {"ok": True, "plan": plan}

    def shop_to_route(self, replace=False):
        """Put the plan's stops on your route, in order (after what's there, or in place of it)."""
        plan = self._shop().get("plan") or {}
        sh = self._shop()
        i = self._shop_step(sh) or 0
        names = [s["place"] for s in (plan.get("steps") or [])[i:] if s.get("place")]
        if not names:
            return {"ok": False, "error": "Plan the trip first"}
        if replace:
            self.set_route(names)
            return {"ok": True, "added": names}
        return self.add_stops(names, repeat=False)

    PURCHASE_NOISE = {"cooler", "power", "plant", "shield", "generator", "quantum", "drive", "radar", "cannon",
                      "repeater", "gatling", "missile", "rack", "rifle", "pistol", "shotgun", "smg", "lmg", "sniper",
                      "helmet", "core", "arms", "legs", "backpack", "undersuit", "armor"}

    def _shop_check_purchases(self):
        """Purchases in Game.log tick items off the list (once the list was planned or the item added)."""
        n = getattr(self._tracker, "purchase_n", 0)
        if n == getattr(self, "_shop_seen_n", None):
            return
        first = not hasattr(self, "_shop_seen_n")
        self._shop_seen_n = n
        sh = self._settings.get("shopping") or {}
        items = [e for e in sh.get("items") or [] if (e.get("bought") or 0) < (e.get("qty") or 1)]
        if first or not items:
            # what was bought before Quantum started is in the log too: only count what comes after
            self._shop_seen_at = time.time() if first else getattr(self, "_shop_seen_at", 0)
            if first:
                return
        since = max(getattr(self, "_shop_seen_at", 0), (sh.get("plan") or {}).get("made") or 0)
        got = []
        for b in self._tracker.purchases:
            if b["n"] <= getattr(self, "_shop_done_n", 0) or (b.get("at") or 0) < since - 5:
                continue
            self._shop_done_n = b["n"]
            e = shopping.match_purchase(items, b["item"], self.PURCHASE_NOISE)
            if e and (e.get("added") or 0) <= (b.get("at") or time.time()) + 5:
                was = e.get("bought") or 0
                e["bought"] = min(e.get("qty") or 1, was + max(1, int(b.get("qty") or 1)))   # 32 missiles in one go count as 32
                n_ = e["bought"] - was
                got.append(f"{e['name']} × {n_}" if n_ > 1 else e["name"])
                items = [x for x in items if (x.get("bought") or 0) < (x.get("qty") or 1)]
        if got:
            self._shop_changed(f"Purchased {', '.join(got)}: marked bought in your cart")
