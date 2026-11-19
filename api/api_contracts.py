"""Api, part of: Contracts and objectives the game log can't place.

A mixin of app.py's Api (class Api(... ContractsMixin ...)): the methods are the Api's, `self` is the one Api.
Module-level names come from qbase.py."""
from qbase import *  # noqa: F401,F403


class ContractsMixin:
    # ------------------------------------------------------------ contracts
    # ------------------------------------------------------------ objectives the log can't place
    # A delivery "to Nyx System" whose marker is inside a building (a hangar or a cargo deck) has no place the
    # log can name: Dead Saints' cargo runs to Levski, say. The Star Citizen Wiki lists the places each kind
    # of contract can send you; the ones in the objective's system that are on the map are the candidates.
    # One candidate: it's used (shown as "from the Star Citizen Wiki"). Several: they're offered as buttons.
    RE_OBJ_SYSTEM = re.compile(r"\b(?:to|in|at)\s+(?:the\s+)?(Stanton|Pyro|Nyx)(?:\s+system)?\b", re.I)

    def _wiki_place_loop(self):
        time.sleep(20)
        while True:
            try:
                self._wiki_fill_places()
            except Exception:
                watcher_mod.log_error("wiki places")
            time.sleep(30)

    def _wiki_fill_places(self):
        todo = []
        with self._lock:
            for c in list(self._tracker.contracts.values()):
                if c.status != "active":
                    continue
                need = [o for o in c.objectives if o.status == "active" and o.kind in ("pickup", "dropoff")
                        and not o.location and not o.marker and o.found != "manual" and not need_item(o.text)]
                need = [o for o in need if time.time() - self._wiki_tried.get((c.id, o.id), 0) > 1800]
                if need:
                    todo.append((c.id, c.code, c.name, c.system, [(o.id, o.kind, o.text) for o in need]))
        for cid, code, name, csys, objs in todo:
            for oid, _, _ in objs:
                self._wiki_tried[(cid, oid)] = time.time()
            try:
                info = self._missions.lookup(code, name, csys) or {}
            except Exception:
                info = {}
            for oid, kind, text in objs:
                names = ((info.get("destinations" if kind == "dropoff" else "pickups") or {}).get("names") or [])
                m = self.RE_OBJ_SYSTEM.search(text or "")
                want_sys = m.group(1).capitalize() if m else None
                cands = []
                with self._lock:
                    for n in names:
                        place, body = self._named_place(n, want_sys)
                        place = place if place in self._db.locations else None
                        if place and (not want_sys or self._db.locations[place].system == want_sys) and place not in cands:
                            cands.append(place)
                    c = self._tracker.contracts.get(cid)
                    o = next((x for x in c.objectives if x.id == oid), None) if c else None
                    if not o or o.location or o.found == "manual":
                        continue
                    if len(cands) == 1:
                        with self._tracker.lock:
                            o.location, o.found = cands[0], "wiki"
                            self._tracker._changed()
                        self._obj_suggest.pop((cid, oid), None)
                    elif cands:
                        self._obj_suggest[(cid, oid)] = cands[:8]
                    elif want_sys:
                        # Nothing on the wiki: the system's cities and stations, the places a cargo run delivers to
                        # inside a building (one click sets it, and contracts like this one remember it)
                        big = [(n, L) for n, L in self._db.locations.items() if L.system == want_sys and L.source == "db"
                               and L.pos is not None and classify(n, L.category) in ("city", "station")
                               and not gateways.system_of(n)]
                        big.sort(key=lambda x: (classify(x[0], x[1].category) != "city", "gateway" in x[0].lower(), x[0]))
                        if big:
                            self._obj_suggest[(cid, oid)] = [n for n, _ in big[:8]]

    def _objective_place(self, c, o):
        """A route-able place for an objective: its matched place, or a stop at its exact marker."""
        if o.location and o.location in self._db.locations:
            return o.location
        if not o.marker:
            return None
        for loc in self._db.locations.values():   # reuse an existing mission stop
            if loc.source == "mission" and loc.body == o.marker["body"] and dist(loc.pos, o.marker["pos"]) < 50:
                return loc.name
        cargo = contract_cargo(c.code)
        # Pickups and drop-offs say what they are; any other objective is named after its contract
        # ("Eliminate Specific Target (near Baijini Point, ArcCorp)"), not a bare "Objective"
        title = re.sub(r"\s+", " ", str(getattr(c, "name", "") or "")).strip()
        if len(title) > 48:
            title = title[:47].rstrip() + "…"
        label = {"pickup": "Pickup", "dropoff": "Drop-off"}.get(o.kind) or title or "Objective"
        where = (f"near {o.marker['near_place']}, {o.marker['body']}" if o.marker.get("near_place") and o.marker.get("body")
                 else o.marker.get("body") or o.marker.get("lpoint") or (f"near {o.marker['near']}" if o.marker.get("near") else "space"))
        name = self._db.unique_name(f"{label}{' ' + cargo if cargo and o.kind in ('pickup', 'dropoff') else ''} ({where})")
        self._db.locations[name] = Location(name, "surface" if o.marker.get("body") else "space",
                                            tuple(o.marker["pos"]), o.marker.get("body"),
                                            notes=f"Contract: {c.name}", source="mission",
                                            system=o.marker["system"], created=time.time(),
                                            # its own category: classify() reads the name, and "Objective (near
                                            # Seraphim Station)" made a contract stop look like a station
                                            category="mission")
        self._db.save()
        self._static_version += 1
        return name

    def add_contract_stops(self, cid, oid=None):
        with self._lock:
            c = self._tracker.get(cid)
            if not c:
                return {"ok": False, "error": "Contract not found"}
            self._assign_turn_ins(self._player, self._player_sys, time.time())
            added = self._add_contract_tasks(c, oid)
            self._save_settings()
            if not added and not any(t["task"].startswith(cid + "|") for t in self._route):
                return {"ok": False, "error": "The log didn't give a map position for this"}
            return {"ok": True, "added": added}

    def guide_objective(self, cid, oid):
        with self._lock:
            c = self._tracker.get(cid)
            o = next((o for o in c.objectives if o.id == oid), None) if c else None
            n = self._objective_place(c, o) if o else None
            if not n:
                return {"ok": False, "error": "The log didn't give a map position for this"}
            self._guide = n
            self._save_settings()
            # Guiding to the drop-off with the cargo on board: you're on your way.
            if o.kind == "dropoff" and self._tracker._collected(c):
                self._tracker.mark_departed(cid, time.time(), "route")
            return {"ok": True, "name": n}

    def contract_out_for_delivery(self, cid, on=True):
        """The "Out for delivery" button on a contract's tracker (and its undo)."""
        with self._lock:
            ok = self._tracker.mark_departed(cid, time.time(), "manual") if on else self._tracker.unmark_departed(cid)
            return {"ok": ok} if ok else {"ok": False, "error": "Nothing to change for that contract"}

    def set_objective_place(self, cid, oid, place):
        with self._lock:
            if place not in self._db.locations:
                return {"ok": False, "error": "Pick a place from the list"}
            c = self._tracker.get(cid)
            o = next((o for o in c.objectives if o.id == oid), None) if c else None
            if o and need_item(o.text):             # an item to collect: that's where you get it
                return self.set_item_source(cid, oid, place)
            ok = self._tracker.set_objective_place(cid, oid, place)
            return {"ok": ok} if ok else {"ok": False, "error": "Contract not found"}

    def objective_place_here(self, cid, oid):
        """Use the nearest known place to your last /showlocation."""
        with self._lock:
            if not self._player:
                return {"ok": False, "error": "Type /showlocation in game chat while you're there"}
            t = self._player_t
            best, bd = None, 5000.0
            for l in self._db.locations.values():
                if l.source == "db" and l.system == self._player_sys:
                    d = dist(self._db.global_pos(l, t), self._player)
                    if d < bd:
                        best, bd = l.name, d
            if not best:
                return {"ok": False, "error": "No known place within 5 km of you. Save a waypoint instead"}
            self._tracker.set_objective_place(cid, oid, best)
            return {"ok": True, "name": best}

    def mark_collected(self, cid, oid=None):
        """Mark a pickup collected when the game didn't log it, then type /showlocation in game (after
        giving it focus) so Quantum knows where you are and can tell when you leave with the cargo."""
        with self._lock:
            if not self._tracker.mark_collected(cid, oid):
                return {"ok": False, "error": "That pickup isn't open any more"}
            self._prune_finished_tasks()
            self._save_settings()
        if not overlay.AVAILABLE:
            return {"ok": True, "sending": False, "note": "Type /showlocation in game for your position."}

        def send():
            time.sleep(0.3)                       # let the click finish before the focus change
            if overlay.focus_game():
                time.sleep(0.5)                   # the game needs a moment before it takes keystrokes
                self._sender.send("collected")
        threading.Thread(target=send, daemon=True).start()
        return {"ok": True, "sending": True}

    def dismiss_contract(self, cid):
        self._tracker.dismiss(cid)

    def assets_base(self):
        """Where the map loads server-hosted data files from (a local server that checks them)."""
        try:
            return self._assets.base_url()
        except Exception:
            watcher_mod.log_error("asset server")
            return ""

    def assets_progress(self):
        return self._assets.progress()

    def assets_status(self):
        try:
            return self._assets.status()
        except Exception as e:
            return {"ok": False, "error": str(e), "files": 0, "cached": 0, "groups": {}, "cities": []}

    def close_out_contract(self, cid):
        self._tracker.close_out(cid)

    def clear_finished_contracts(self):
        self._tracker.clear_finished()

    def set_log_path(self, path):
        path = (path or "").strip().strip('"')
        if not Path(path).is_file():
            return {"ok": False, "error": "File not found"}
        self._settings["log_path"] = path
        self._save_settings()
        self._tracker.set_log_path(path)
        return {"ok": True}

    def browse_log(self):
        res = webview.windows[0].create_file_dialog(webview.OPEN_DIALOG,
                                                    file_types=("Game log (*.log)", "All files (*.*)"))
        return self.set_log_path(res[0]) if res else {"ok": False, "error": "cancelled"}
