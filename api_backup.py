"""Api, part of: Encrypted backups of your fleet, loadouts, waypoints, trade runs and mapped stations.

A mixin of app.py's Api (class Api(... BackupMixin ...)): the methods are the Api's, `self` is the one Api.
Module-level names come from qbase.py."""
from qbase import *  # noqa: F401,F403


class BackupMixin:
    # ------------------------------------------------------------ encrypted backups
    # Fleet and swaps, waypoints, planned trade routes and mapped stations, encrypted on this PC with
    # keys made from your UEX Bearer Token (see backup.py) and kept on the Quantum server. Uploaded
    # within a minute of a change; brought back automatically on a fresh install once the token is
    # entered. Restoring only adds what's missing here, it never removes or overwrites anything.
    BACKUP_EVERY = 60

    def _backup_creds(self):
        token = (self._settings.get("uex_token") or "").strip()
        return token if token and self._community.url else None

    def _backup_payload(self):
        with self._lock:
            way = [asdict(l) for l in self._db.locations.values() if l.source == "user"]
        return {"v": 1, "fleet": self._settings.get("fleet") or [], "trade_runs": self._settings.get("trade_runs") or [],
                "waypoints": way, "places": gateways.load_learned(PLACES_PATH),
                "gear_loadouts": self._settings.get("gear_loadouts") or [],
                "profile_prefs": self._settings.get("profile_prefs") or {}}

    def _backup_state(self, **kw):
        st = self._settings.setdefault("backup", {})
        st.update(kw)
        self._save_settings()

    def backup_now(self, force=False):
        """Upload the backup if anything changed since the last one (or always, with force)."""
        token = self._backup_creds()
        if not token:
            return {"ok": False, "status": "no_key"}
        payload = self._backup_payload()
        fp = backup.fingerprint(payload)
        st = self._settings.get("backup") or {}
        k = backup.keys(token)
        if not force and st.get("hash") == fp and st.get("status") == "ok" and st.get("slot") == k["slot"]:
            return {"ok": True, "status": "unchanged"}
        try:
            blob = backup.encrypt(token, payload)
        except ValueError as e:
            self._backup_state(status="too_large", tried=int(time.time()))
            return {"ok": False, "status": "too_large", "error": str(e)}
        r = self._community.backup_put(k["slot"], k["auth"], blob)
        if r.get("status") == "ok":
            self._backup_state(hash=fp, at=int(time.time()), status="ok", slot=k["slot"])
            return {"ok": True, "status": "saved"}
        self._backup_state(status=r.get("status"), tried=int(time.time()))
        return {"ok": False, "status": r.get("status"), "error": r.get("detail")}

    def _local_empty(self):
        with self._lock:
            way = any(l.source == "user" for l in self._db.locations.values())
        return not (self._settings.get("fleet") or self._settings.get("trade_runs") or self._settings.get("gear_loadouts") or way)

    def _backup_restore_if_empty(self):
        try:
            if self._local_empty():
                r = self.backup_restore()
                if r.get("ok") and r.get("added"):
                    self._backup_note = f"Restored from your backup: {r['summary']}"
        except Exception as e:
            print("backup restore:", e, flush=True)

    def backup_restore(self, token=None):
        """Fetch, decrypt and merge the backup: adds missing ships, routes, waypoints and stations.
        token: an older UEX Bearer Token's backup to bring in (see _backup_move); default the current one."""
        token = token or self._backup_creds()
        if not token:
            return {"ok": False, "error": "Add your UEX Bearer Token first: backups are locked with it"}
        k = backup.keys(token)
        r = self._community.backup_get(k["slot"], k["auth"])
        st = r.get("status")
        if st == "no_backup":
            return {"ok": False, "error": "There's no backup for this UEX Bearer Token yet"}
        if st != "ok":
            return {"ok": False, "error": "The Quantum server couldn't be reached. Try again in a minute"}
        try:
            data = backup.decrypt(token, r["blob"])
        except Exception as e:
            return {"ok": False, "error": f"The backup couldn't be opened: {e}"}
        added = {"ships": 0, "loadouts": 0, "routes": 0, "waypoints": 0, "stations": 0, "gear loadouts": 0}
        fleet = self._fleet()
        have = {f["uid"]: f for f in fleet}
        for f in data.get("fleet") or []:
            if not f.get("uid"):
                continue
            if f["uid"] not in have:
                fleet.append(dict(f, main=False)); added["ships"] += 1
                self._loadouts(fleet[-1])
                continue
            # A ship already here gets any loadout it's missing (by name), up to MAX_LOADOUTS; its own stay as they are
            mine = self._loadouts(have[f["uid"]])
            for lo in f.get("loadouts") or []:
                if not isinstance(lo, dict):
                    continue
                name = str(lo.get("name") or "").strip()
                lv = self._clean_livery(lo.get("livery"))
                same = next((x for x in mine if name and x["name"].lower() == name.lower()), None)
                if same is not None:
                    if lv and not same.get("livery"):          # the paint is missing here: bring it back
                        same["livery"] = lv
                        added["loadouts"] += 1
                    continue
                if not name or len(mine) >= self.MAX_LOADOUTS:
                    continue
                n = 1
                while f"l{n}" in {x["id"] for x in mine}:
                    n += 1
                mine.append({"id": f"l{n}", "name": name[:40], "loadout": lo.get("loadout") if isinstance(lo.get("loadout"), dict) else {},
                             "power": lo.get("power") if isinstance(lo.get("power"), dict) else {},
                             **({"livery": lv} if lv else {})})
                added["loadouts"] += 1
        if fleet and not any(f.get("main") for f in fleet):
            fleet[0]["main"] = True
        runs = self._settings.setdefault("trade_runs", [])
        have = {x.get("id") for x in runs}
        for x in data.get("trade_runs") or []:
            if x.get("id") and x["id"] not in have:
                runs.append(x); added["routes"] += 1
        if data.get("profile_prefs") and not self._settings.get("profile_prefs"):     # how your profile is laid out
            self._settings["profile_prefs"] = self.profile_prefs_set(data["profile_prefs"])["prefs"]
        gl = self._settings.setdefault("gear_loadouts", [])
        have = {x.get("id") for x in gl}
        for x in data.get("gear_loadouts") or []:
            c = self._gl_clean(x)
            if c and c["id"] not in have:
                gl.append(c); added["gear loadouts"] += 1
        self._save_settings()
        with self._lock:
            for d in data.get("waypoints") or []:
                if isinstance(d.get("name"), str) and d["name"] and d["name"] not in self._db.locations:
                    try:
                        loc = _from_dict(Location, d)
                        if loc.kind not in ("space", "surface") or len(loc.pos) != 3 or \
                                not all(isinstance(c, (int, float)) for c in loc.pos):
                            continue
                        loc.source = "user"                   # a backup only ever holds your own waypoints
                    except (TypeError, ValueError):
                        continue
                    self._db.locations[d["name"]] = loc; added["waypoints"] += 1
            places = gateways.load_learned(PLACES_PATH)
            for name, v in (data.get("places") or {}).items():
                if name not in places and isinstance(v.get("system"), str):
                    places[name] = v; added["stations"] += 1
            if added["stations"]:
                PLACES_PATH.write_text(json.dumps({"places": places}, indent=1), encoding="utf-8")
                _, self._unplaced = gateways.apply(self._db, self._learned_places())
                self._apply_uex_stations(offline=True)
            if added["waypoints"] or added["stations"]:
                self._db.save()
                self._db_changed()
        n = sum(added.values())
        words = [f"{v} {k if v != 1 else k[:-1]}" for k, v in added.items() if v]
        return {"ok": True, "added": n, "detail": added, "updated": r.get("updated"),
                "summary": ", ".join(words) if words else "nothing was missing"}
