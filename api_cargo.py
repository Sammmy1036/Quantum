"""Api, part of: the cargo load planner (Trade > Planned Routes > Load plan).

A mixin of app.py's Api (class Api(... CargoMixin ...)): the methods are the Api's, `self` is the one Api.
Module-level names come from qbase.py.

A ship's cargo grids (their size in metres, how much they take, the biggest box each takes, inside or outside the
hull) come from the Star Citizen Wiki's vehicle data, which is read from the game files each patch:
https://api.star-citizen.wiki/api/vehicles/<uuid>. They're kept in uex_cache/wiki_cargo_grids.json for a week.
The packing itself is cargo.py.
"""
from qbase import *  # noqa: F401,F403
import cargo
import fleet as fleet_mod

WIKI_VEHICLE = "https://api.star-citizen.wiki/api/vehicles/"
GRIDS_KEEP = 7 * 86400


class CargoMixin:
    # ---------------------------------------------------------------- ships' cargo grids
    def _cargo_cache(self):
        c = self.__dict__.get("_cg")
        if c is None:
            try:
                c = json.loads((self._wikiapi.dir / "wiki_cargo_grids.json").read_text(encoding="utf-8"))
            except Exception:
                c = {}
            self._cg = c
        return c

    def _cargo_cache_save(self):
        try:
            self._wikiapi.dir.mkdir(exist_ok=True)
            (self._wikiapi.dir / "wiki_cargo_grids.json").write_text(json.dumps(self._cargo_cache()), encoding="utf-8")
        except OSError:
            pass

    @staticmethod
    def _cargo_norm(x):
        return "".join(ch for ch in str(x or "").lower() if ch.isalnum())

    def _cargo_names(self, v):
        """Ways the wiki may know this ship, best first: its uuid (from the wiki's own vehicle list, then UEX's),
        then its name ("Cutlass Black"), its full name ("Drake Cutlass Black") and the full name without the maker.
        The wiki's /api/vehicles/<x> takes a uuid or a name."""
        out = []
        try:
            wiki = self._wikiapi.vehicle_summary() or {}
        except Exception:
            wiki = {}
        for k in (v.get("uuid"), v.get("name_full"), v.get("name"), v.get("slug")):
            rec = wiki.get(str(k).lower()) if k else None
            if rec and rec.get("uuid"):
                out.append(rec["uuid"])
        full, maker = (v.get("name_full") or "").strip(), (v.get("company_name") or "").strip()
        short = full[len(maker):].strip() if maker and full.lower().startswith(maker.lower()) else None
        out += [v.get("uuid"), v.get("name"), full, short]
        seen = []
        for x in out:
            x = str(x or "").strip()
            if x and x not in seen:
                seen.append(x)
        return seen

    def _cargo_same(self, v, d):
        """Is the wiki's record this ship? (A name lookup must never hand back another ship's hold.)"""
        n = self._cargo_norm
        mine = {n(v.get("name")), n(v.get("name_full"))} - {""}
        theirs = {n(d.get("name")), n(d.get("game_name"))} - {""}
        if mine & theirs or (v.get("uuid") and v.get("uuid") == d.get("uuid")):
            return True
        # same hold size and a shared word in the name (UEX and the wiki spell some ships differently)
        words = lambda *xs: {w for x in xs for w in str(x or "").lower().replace("-", " ").split() if len(w) > 2}
        cap = d.get("cargo_capacity")
        return bool(cap and v.get("scu") and abs(float(cap) - float(v["scu"])) < 1
                    and words(v.get("name"), v.get("name_full")) & words(d.get("name"), d.get("game_name")))

    def _cargo_grids(self, v, refresh=False):
        """-> (the wiki's cargo grids [raw], error or None). Kept a week per ship; a ship the wiki has no grid for
        is asked about again after a day. A stale copy beats nothing when the wiki can't be reached."""
        cache, key, now = self._cargo_cache(), f"v{v.get('id')}", time.time()
        hit = cache.get(key)
        if hit and not refresh:
            if hit.get("miss") and now - hit.get("at", 0) < 86400:
                return None, f"The Star Citizen Wiki doesn't list a cargo grid for the {v.get('name_full') or v.get('name')}"
            if not hit.get("miss") and now - hit.get("at", 0) < GRIDS_KEEP:
                return hit.get("grids") or [], None
        err = None
        for name in self._cargo_names(v):
            try:
                r = fleet_mod._get(WIKI_VEHICLE + urllib.parse.quote(name, safe=""), timeout=30)
            except Exception as e:
                if "404" not in str(e):
                    err = "Couldn't reach the Star Citizen Wiki. Try again in a minute"
                continue
            d = r.get("data") if isinstance(r, dict) and isinstance(r.get("data"), dict) else r
            if not isinstance(d, dict) or not self._cargo_same(v, d):
                continue
            grids = [g for g in (d.get("cargo_grids") or []) if isinstance(g, dict)]
            ver = next((p.get("equipped_item", {}).get("version") for p in (d.get("ports") or [])
                        if isinstance(p, dict) and isinstance(p.get("equipped_item"), dict) and p["equipped_item"].get("version")), None)
            cache[key] = {"at": now, "name": d.get("game_name") or d.get("name"), "uuid": d.get("uuid"), "grids": grids,
                          "capacity": d.get("cargo_capacity"), "version": ver, "miss": not grids}
            self._cargo_cache_save()
            if grids:
                return grids, None
            return None, f"The Star Citizen Wiki lists no cargo grid for the {d.get('game_name') or d.get('name')}"
        if hit and not hit.get("miss") and hit.get("grids"):
            return hit["grids"], None                      # offline: last week's copy
        if not err:                                        # the wiki answered: it just doesn't have this ship
            cache[key] = {"at": now, "miss": True}
            self._cargo_cache_save()
        return None, err or f"The Star Citizen Wiki doesn't list a cargo grid for the {v.get('name_full') or v.get('name')}"

    # ---------------------------------------------------------------- what the page calls
    def cargo_ships(self):
        """Ships to plan for: yours (My Fleet) first, your main ship marked, then every ship with a cargo hold."""
        try:
            rows = self._vehicle_rows()
        except Exception as e:
            return {"ok": False, "error": str(e)}
        mine, seen = [], set()
        for f in self._fleet():
            v = rows.get(f.get("vehicle_id"), {})
            if (v.get("scu") or 0) > 0 and f.get("vehicle_id") not in seen:
                seen.add(f["vehicle_id"])
                mine.append({"vehicle_id": f["vehicle_id"], "name": v.get("name_full") or f.get("name"), "scu": v.get("scu"),
                             "main": bool(f.get("main"))})
        mine.sort(key=lambda x: (not x["main"], x["name"].lower()))
        others = sorted(({"vehicle_id": vid, "name": v.get("name_full") or v.get("name"), "scu": v.get("scu")}
                         for vid, v in rows.items() if (v.get("scu") or 0) > 0 and vid not in seen and not v.get("is_ground_vehicle")),
                        key=lambda x: x["name"].lower())
        return {"ok": True, "mine": mine, "others": others}

    def _cargo_box_limit(self, run):
        """Biggest box the buying terminal hands out: what the route said, else UEX's terminal record."""
        sizes = [int(s) for s in str(run.get("boxes_from") or "").replace(";", ",").split(",") if s.strip().isdigit()]
        if sizes:
            return max(sizes), sizes
        name = (run.get("from_terminal") or "").strip().lower()
        if name:
            try:
                for t in self._uex.terminals(offline=True).values():
                    if name in ((t.get("name") or "").lower(), (t.get("nickname") or "").lower()):
                        mb = t.get("max_container_size")
                        if isinstance(mb, (int, float)) and mb > 0:
                            return int(mb), None
            except Exception:
                pass
        return 32, None

    def cargo_plan(self, vehicle_id, run_ids=None, extra=None, refresh=False, box_limit="hold"):
        """Pack these Planned Routes (and extra cargo [{name, scu, max_box, to}]) into this ship's grids.
        box_limit "hold": any box the hold has room for (the default: the wiki's per-grid "biggest box" is often
        wrong, e.g. 1 SCU for the Hermes, which RSI built around 32 SCU containers); "wiki": the wiki's number.
        -> {ok, ship, plan (cargo.pack), runs: [ids used], skipped: [names], source}"""
        try:
            v = self._vehicle_rows().get(int(vehicle_id))
        except (TypeError, ValueError):
            v = None
        if not v:
            return {"ok": False, "error": "Pick a ship"}
        raw, err = self._cargo_grids(v, refresh)
        if not raw:
            return {"ok": False, "error": err, "ship": {"name": v.get("name_full") or v.get("name"), "scu": v.get("scu")}}
        grids = [g for g in (cargo.grid_from_wiki(x, i) for i, x in enumerate(raw)) if g]
        grids.sort(key=lambda g: (g["external"], -(g["X"] * g["Y"] * g["Z"])))     # inside the hull first, biggest first
        wiki_max = max((g["max_box"] for g in grids), default=32)
        for i, g in enumerate(grids):
            g["id"] = i
            if box_limit != "wiki":
                g["max_box"] = 32                          # the hold's own size decides (see box_limit)
        if not grids:
            return {"ok": False, "error": "The wiki's cargo grid for this ship has no size yet"}
        try:
            order = [st["place"] for st in self._stops()]
        except Exception:
            order = []
        items, used, skipped = [], [], []
        runs = {r["id"]: r for r in self._runs()}
        for rid in run_ids or []:
            r = runs.get(rid)
            if not r:
                continue
            if not r.get("units"):
                skipped.append(r.get("commodity") or "?")
                continue
            mb, sizes = self._cargo_box_limit(r)
            items.append({"key": rid, "name": r.get("commodity"), "scu": r["units"], "max_box": mb, "sizes": sizes,
                          "to": r.get("to_place")})
            used.append(rid)
        for i, x in enumerate(extra or []):
            try:
                scu = float(x.get("scu") or 0)
            except (TypeError, ValueError):
                scu = 0
            if scu > 0:
                items.append({"key": f"x{i}", "name": str(x.get("name") or "Cargo")[:60], "scu": scu,
                              "max_box": int(x.get("max_box") or 32), "to": x.get("to")})
        if not items:
            return {"ok": False, "error": "Nothing to load: give the route how many SCU you're buying"}
        # Unloaded first = drop 0. A stop on your route counts in route order; others after, in the order listed.
        dests = []
        for it in items:
            if it.get("to") not in dests:
                dests.append(it.get("to"))
        rank = {d: (order.index(d) if d in order else len(order) + k) for k, d in enumerate(dests)}
        for it in items:
            it["drop"] = rank[it.get("to")]
        plan = cargo.pack(grids, items)
        if box_limit != "wiki" and wiki_max < 32:
            plan["notes"].insert(0, f"The wiki lists {wiki_max} SCU as the biggest box for this ship, which is often wrong, so this "
                                    "plan goes by the size of the hold. If bigger boxes won't go in, set Biggest box to the wiki's limit.")
        hit = self._cargo_cache().get(f"v{v.get('id')}") or {}
        return {"ok": True, "ship": {"vehicle_id": int(vehicle_id), "name": v.get("name_full") or v.get("name"),
                                     "scu": v.get("scu"), "grids": len(grids)},
                "plan": plan, "runs": used, "skipped": skipped, "wiki_max_box": wiki_max, "box_limit": box_limit,
                "source": "Star Citizen Wiki (from the game files)" + (f" · {hit['version']}" if hit.get("version") else "")}
