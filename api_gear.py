"""Api, part of: Personal gear: your gear loadouts, and weapons, armor and blueprints from the wiki.

A mixin of app.py's Api (class Api(... GearMixin ...)): the methods are the Api's, `self` is the one Api.
Module-level names come from qbase.py."""
from qbase import *  # noqa: F401,F403


class GearMixin:
    # ------------------------------------------------------------ personal gear loadouts
    # What you wear and carry for a kind of job ("Bunker run", "Cave mining", "EVA salvage"): a piece of armor
    # per slot, weapons, gadgets, utility items and consumables with how many. Kept in settings, backed up
    # with the rest, and shown in Gear › Loadouts and on your profile.
    GL_SLOTS = {"helmet": "armor", "core": "armor", "arms": "armor", "legs": "armor", "backpack": "armor",
                "undersuit": "armor", "primary": "weapons", "secondary": "weapons", "sidearm": "weapons",
                "melee": "weapons", "gadget1": "gadgets", "gadget2": "gadgets", "utility1": "utility",
                "utility2": "utility", "hat": "clothing", "torso": "clothing", "jacket": "clothing",
                "pants": "clothing", "shoes": "clothing", "gloves": "clothing", "bag": "clothing"}
    GL_MAX = 60

    def _gl_item(self, x, kind):
        if not isinstance(x, dict) or not str(x.get("name") or "").strip():
            return None
        out = {"name": str(x["name"]).strip()[:120], "kind": kind,
               "uuid": str(x.get("uuid") or "")[:64] or None, "class_name": str(x.get("class_name") or "")[:120] or None}
        q = x.get("qty")
        if isinstance(q, (int, float)) and not isinstance(q, bool):
            out["qty"] = max(1, min(99, int(q)))
        return out

    def _gl_clean(self, lo):
        """A loadout as the page sent it, checked and trimmed to what's kept (None if it isn't one)."""
        if not isinstance(lo, dict):
            return None
        name = str(lo.get("name") or "").strip()[:60]
        if not name:
            return None
        slots = {}
        for k, v in (lo.get("slots") or {}).items() if isinstance(lo.get("slots"), dict) else []:
            if k in self.GL_SLOTS:
                it = self._gl_item(v, self.GL_SLOTS[k])
                if it:
                    it.pop("qty", None)
                    slots[k] = it
        cons = [c for c in (self._gl_item(x, "consumables") for x in (lo.get("consumables") or [])[:20]) if c]
        for c in cons:
            c.setdefault("qty", 1)
        lid = str(lo.get("id") or "") or "g" + secrets.token_hex(5)
        return {"id": re.sub(r"[^A-Za-z0-9_-]", "", lid)[:20] or "g" + secrets.token_hex(5), "name": name,
                "scenario": str(lo.get("scenario") or "").strip()[:60], "notes": str(lo.get("notes") or "").strip()[:500],
                "slots": slots, "consumables": cons, "main": bool(lo.get("main")),
                "created": lo.get("created") if isinstance(lo.get("created"), (int, float)) else int(time.time()),
                "updated": int(time.time())}

    def gear_loadouts(self):
        return {"ok": True, "loadouts": self._settings.get("gear_loadouts") or []}

    def gear_loadout_save(self, lo):
        """Add or change one loadout (matched by id). {ok, loadout, loadouts}"""
        c = self._gl_clean(lo)
        if not c:
            return {"ok": False, "error": "Give the loadout a name first"}
        L = self._settings.setdefault("gear_loadouts", [])
        old = next((x for x in L if x.get("id") == c["id"]), None)
        if old:
            c["created"] = old.get("created") or c["created"]
            L[L.index(old)] = c
        else:
            if len(L) >= self.GL_MAX:
                return {"ok": False, "error": f"That's {self.GL_MAX} loadouts already. Delete one first"}
            L.append(c)
        if c["main"]:
            for x in L:
                x["main"] = x is c
        elif not any(x.get("main") for x in L):
            L[0]["main"] = True
        self._save_settings()
        return {"ok": True, "loadout": c, "loadouts": L}

    def gear_loadout_delete(self, lid):
        L = self._settings.setdefault("gear_loadouts", [])
        self._settings["gear_loadouts"] = L = [x for x in L if x.get("id") != lid]
        if L and not any(x.get("main") for x in L):
            L[0]["main"] = True
        self._save_settings()
        return {"ok": True, "loadouts": L}

    def backup_status(self):
        st = self._settings.get("backup") or {}
        note, self._backup_note = getattr(self, "_backup_note", None), None
        return {"has_key": bool(self._settings.get("uex_token")), "on": bool(self._community.url),
                "at": st.get("at"), "status": st.get("status"), "note": note, "off": bool(self._settings.get("backup_off"))}

    def backup_delete(self):
        """Remove your backup from the server and stop backing up until turned back on."""
        token = self._backup_creds()
        if not token:
            return {"ok": False, "error": "No UEX Bearer Token saved"}
        k = backup.keys(token)
        r = self._community.backup_get(k["slot"], k["auth"], delete=True)
        if r.get("status") in ("deleted", "no_backup"):
            self._settings.pop("backup", None)
            self._settings["backup_off"] = True
            self._save_settings()
            return {"ok": True}
        return {"ok": False, "error": "The Quantum server couldn't be reached. Try again in a minute"}

    def backup_enable(self):
        self._settings.pop("backup_off", None)
        self._save_settings()
        threading.Thread(target=self.backup_now, kwargs={"force": True}, daemon=True).start()
        return self.backup_status()

    BACKUP_SOON = 5          # s after a change to your waypoints (several changes in a row send once)

    def _backup_quietly(self):
        try:
            if not self._settings.get("backup_off"):
                self.backup_now()
        except Exception as e:
            print("backup:", e, flush=True)

    def _backup_soon(self):
        """Upload the backup a few seconds after a change, rather than at the next minute's check (or the
        next start, if Quantum is closed before then)."""
        old = getattr(self, "_backup_timer", None)
        if old:
            old.cancel()
        self._backup_timer = threading.Timer(self.BACKUP_SOON, self._backup_quietly)
        self._backup_timer.daemon = True
        self._backup_timer.start()

    def _backup_loop(self):
        time.sleep(20)
        self._backup_restore_if_empty()
        while True:
            try:
                if not self._settings.get("backup_off"):
                    self.backup_now()
            except Exception as e:
                print("backup:", e, flush=True)
            time.sleep(self.BACKUP_EVERY)

    def place_result(self, name):
        """What the server said about the station position you just sent: live for everyone (trusted, or a
        second reading agreed), waiting for a second reading, still sending, or unreachable."""
        return self._community.place_results.get(gateways.learn_key(name)) or {"state": "none"}

    PLACES_SYNC_EVERY = 10 * 60          # s: how often shared station positions are fetched again

    SERVER_CHECK_DOWN = 20               # s between health checks while the Quantum server is down
    SERVER_CHECK_UP = 120                # s between health checks while it's up

    def _watch_server(self):
        """Background: keep checking the Quantum server, often while it's down. When it comes back, pick
        everything up again at once (prices, pictures, shared stations, sign-in, backup) instead of the app
        staying "offline" until it's restarted."""
        time.sleep(5)
        while True:
            try:
                h = self._community.health() if self._community.url else {"ok": False, "error": "off"}
            except Exception as e:
                h = {"ok": False, "error": str(e)}
            was = getattr(self, "_server_ok", None)
            self._server_ok, self._server_checked = bool(h.get("ok")), time.time()
            self._server_error = None if h.get("ok") else h.get("error")
            if self._server_ok and was is False:
                self._server_back_at = time.time()
                self._sender._event("Quantum server is back online")
                threading.Thread(target=self._server_back, daemon=True).start()
            elif was and not self._server_ok:
                self._sender._event(f"Quantum server unreachable: {self._server_error}")
            time.sleep(self.SERVER_CHECK_UP if self._server_ok or not self._community.url else self.SERVER_CHECK_DOWN)

    def _server_back(self):
        """The server is reachable again: refresh what was missed while it was down."""
        steps = (("keys", self._load_account_keys),
                 ("sign-in", lambda: self._dr_cfg().get("secret") and not self._session_token() and self._sign_in()),
                 ("prices", lambda: self._community.prices(fresh=True)),
                 ("photos", lambda: self._community.photos(fresh=True)),
                 ("places", self._sync_places_once),
                 ("backup", lambda: self._backup_creds() and not self._settings.get("backup_off") and self.backup_now()))
        for name, fn in steps:
            try:
                fn()
            except Exception as e:
                print(f"server back ({name}):", e, flush=True)

    def _sync_places(self):
        """Background: fetch the shared station positions at start, then every 10 minutes, and put any
        new ones on the map. A station two datarunners just agreed on shows up (and leaves the
        Not on the map yet list and the Jobs) without restarting Quantum."""
        time.sleep(3)                                          # let start-up finish first
        while True:
            try:
                self._resend_places()                          # positions the server didn't get yet
            except Exception as e:
                print("place resend:", e, flush=True)
            try:
                self._resend_alignments()                      # and planet alignments
            except Exception as e:
                print("alignment resend:", e, flush=True)
            try:
                self._sync_places_once()
            except Exception as e:
                print("place sync:", e, flush=True)
            time.sleep(self.PLACES_SYNC_EVERY)

    GAME_CHANNELS = ("EPTU", "PTU", "TECH-PREVIEW", "HOTFIX", "LIVE")

    def _game_env(self, path=None):
        """Which channel the Game.log being read belongs to (LIVE, PTU, EPTU, ...), from its folder."""
        p = (path if path is not None else (self._tracker.log_path or "")).upper().replace("/", "\\")
        return next((c for c in self.GAME_CHANNELS if f"\\{c}\\" in p), "LIVE")

    def _on_live(self):
        """True when the Game.log being read is the LIVE game's. Only LIVE builds count as "the game build":
        logging into the PTU (or EPTU, Tech-Preview, Hotfix) must not look like a game update, start planet
        alignment over, or tag alignments with a test build."""
        return self._game_env() == "LIVE"

    def _game_build(self):
        """The LIVE game build (from Game.log), or the last LIVE one seen when the game isn't running or
        you're playing a test channel (PTU and friends never replace it)."""
        b = str(self._tracker.build or "") if self._on_live() else ""
        old = self._settings.get("last_build")
        if b and b != old:
            self._settings["last_build"] = b
            self._save_settings()
            # An older Quantum saved PTU builds here too. Coming back to LIVE from one of those isn't an
            # update: just take the LIVE build quietly.
            old_label = ((self._settings.get("build_labels") or {}).get(str(old)) or "").upper()
            was_test = any(c in old_label for c in self.GAME_CHANNELS if c != "LIVE")
            if old and not was_test:
                self._on_new_build(old, b)
        return b or self._settings.get("last_build")

    # Caches that hold what a game update changes: ships, parts, paints (the wiki's game-file data and UEX's
    # lists). Dropped when a new game version is seen, so new ships and components (and their stats) come
    # in as soon as the wiki and UEX have them, instead of after the caches run out days later.
    WIKI_UPDATE_CACHES = ("wiki_type_*.json", "wiki_vehicle_*.json", "wiki_item2_*.json")
    UEX_UPDATE_CACHES = ("vehicles.json", "vehicles_*.json", "items_*.json", "categories.json")

    def _on_new_build(self, old, new):
        """Star Citizen was updated (a new build number in Game.log): tell the user, start planet alignment
        over for the new version, and refresh what an update changes."""
        version = self._tracker.branch or ""
        try:
            version = self._dr_game_build()[0] or version
        except Exception:
            pass
        self._game_update = {"build": new, "previous": old, "version": version, "at": time.time()}
        self._settings["game_update"] = self._game_update
        self._save_settings()
        self._sender._event(f"New game version detected: build {new}{f' ({version})' if version else ''}, was {old}")
        removed, d = 0, HERE / "uex_cache"
        if d.exists():
            for pat in self.WIKI_UPDATE_CACHES:            # the wiki's: fetched again when next needed
                for f in d.glob(pat):
                    try:
                        f.unlink()
                        removed += 1
                    except OSError:
                        pass
            for pat in self.UEX_UPDATE_CACHES:             # UEX's: marked out of date, so they're fetched
                for f in d.glob(pat):                      # again, but still used if UEX can't be reached
                    try:
                        c = json.loads(f.read_text(encoding="utf-8"))
                        c["at"] = 0
                        f.write_text(json.dumps(c), encoding="utf-8")
                        removed += 1
                    except Exception:
                        pass
            try:
                self._uex._mem.clear()
            except Exception:
                pass
        self.__dict__.pop("_livery_pics", None)
        self._photo_jobs = None
        self._static_version += 1
        print(f"game update: build {old} -> {new}; {removed} cached files refreshed", flush=True)
        threading.Thread(target=self._apply_community_alignments, daemon=True).start()
        threading.Thread(target=self._refresh_services, kwargs={"force": True}, daemon=True).start()

    SERVICES_MAX_AGE = 2 * 86400      # services.json older than this is downloaded again on start
    SERVICES_RETRY = 6 * 3600         # ...but the wiki is asked at most this often

    def _refresh_services(self, force=False):
        """Download location services again from the Star Citizen Wiki API when services.json is a few
        days old or the game was updated, so the place cards follow the current patch (the shipped file
        is a snapshot of one game version). Runs in the background; the old data stays in use meanwhile
        and if the download fails."""
        if getattr(self, "_svc_refreshing", False):
            return
        now = time.time()
        if not force and now - services.fetched_at(SERVICES_PATH) < self.SERVICES_MAX_AGE:
            return
        if now - float(self._settings.get("services_checked") or 0) < (1800 if force else self.SERVICES_RETRY):
            return
        self._svc_refreshing = True
        try:
            self._settings["services_checked"] = now
            self._save_settings()
            recs = services.fetch_all(log=lambda *a: None, delay=0.6)
            if len(recs) < 0.8 * len(self._service_records or []):    # cut short: keep what we have
                print(f"services: only {len(recs)} records came back; kept the current data", flush=True)
                return
            services.save(recs, SERVICES_PATH)
            self._service_records = recs
            self._services = self._match_services()
            self._static_version += 1                                 # the page reloads the place cards
            versions = sorted({r["version"].split("-")[0] for r in recs if r.get("version")})
            print(f"services: updated from the Star Citizen Wiki API (game {', '.join(versions) or '?'})", flush=True)
        except Exception as e:
            print(f"services: couldn't refresh ({e}); using the saved data", flush=True)
        finally:
            self._svc_refreshing = False

    def js_error(self, where, message):
        """An error in the page (the map's drawing, say), so it shows up in the console and Settings > Log."""
        text = f"Page error ({str(where)[:40]}): {str(message)[:1500]}"
        print(text, flush=True)
        try:
            self._sender._event(text.splitlines()[0][:300])
        except Exception:
            pass
        return {"ok": True}

    def game_update_ack(self):
        """You've seen the "Star Citizen was updated" note."""
        self._settings.pop("game_update", None)
        self._game_update = None
        self._save_settings()
        return {"ok": True}

    def _apply_community_alignments(self):
        """Planet alignments datarunners agree on for this game build go live here: used for every planet
        or moon you haven't lined up yourself in this build (your own always wins)."""
        build = self._game_build()
        r = self._community.alignments(build) if build else None
        if not r:
            return
        self._align_server = dict(r, build=build, at=time.time())
        mine = self._settings.get("cal_build") or {}
        changed = False
        with self._lock:
            for name, a in r["agreed"].items():
                b = self._db.bodies.get(name)
                if not b or not can_align(b) or mine.get(name) == build:
                    continue
                if abs((a.get("period") or 0) - b.rotation_period_h) > 1e-4:
                    continue                                     # different day length in this map data
                if b.calibration_quality == "community" and abs(b.rotation_offset_deg - a["offset"]) < 1e-6:
                    continue
                b.rotation_offset_deg, b.epoch_utc = float(a["offset"]), float(a.get("epoch") or b.epoch_utc)
                b.calibrated, b.calibrated_at = True, float(a.get("at") or time.time())
                b.calibrated_place, b.calibration_quality = "Quantum datarunners", "community"
                changed = True
            if changed:
                self._static_version += 1

    def _sync_places_once(self):
        try:
            self._apply_community_alignments()
        except Exception as e:
            print("alignment sync:", e, flush=True)
        r = self._community.places()
        if r is None:
            return
        got, missing = r["places"], sorted(r["missing"])
        pend = {n: c for n, c in (r.get("pending") or {}).items() if isinstance(n, str)}
        if pend != getattr(self, "_fix_pending", {}):
            self._fix_pending = pend                  # corrections waiting on a second reading: Check a position jobs
            with self._lock:
                self._static_version += 1
        if r.get("pads", {}) != getattr(self, "_community_pads", None):          # pad sizes datarunners agree on
            self._community_pads = r.get("pads", {})
            with self._lock:
                self._static_version += 1
            try:
                saved = json.loads(COMMUNITY_PLACES_PATH.read_text(encoding="utf-8"))
                saved["pads"] = self._community_pads
                COMMUNITY_PLACES_PATH.write_text(json.dumps(saved, indent=1), encoding="utf-8")
            except (OSError, ValueError):
                pass
        # Once per start: re-send positions you set that the server doesn't list yet, in case an earlier
        # send never arrived (it's harmless if it did: the server keeps one reading per person).
        if not getattr(self, "_resent_mine", False):
            self._resent_mine = True
            for name in gateways.load_learned(PLACES_PATH):
                if name not in got and name not in (self._settings.get("places_unsent") or []):
                    self._share_place(name)
        if got == gateways.load_learned(COMMUNITY_PLACES_PATH) and missing == sorted(getattr(self, "_community_missing", ())):
            return
        self._community_missing = set(missing)
        try:
            COMMUNITY_PLACES_PATH.write_text(json.dumps({"places": got, "missing": missing, "pads": r.get("pads", {})},
                                                        indent=1), encoding="utf-8")
        except OSError:
            return
        with self._lock:
            ren, self._unplaced = gateways.apply(self._db, self._learned_places())
            self._renamed.update(ren)
            self._apply_uex_stations(offline=True)
            self._db.save()
            self._db_changed()

    def set_place_here(self, name):
        """You're docked at a gateway station: use your last /showlocation as its position."""
        with self._lock:
            pend = getattr(self, "_uex_pending", {})
            system = gateways.system_of(name) or pend.get(name)
            if not system:
                return {"ok": False, "error": "Only gateways, Wikelo and UEX-only places can be placed this way"}
            if name in pend:
                return self._place_uex_here(name, system)
            if not self._player or time.time() - self._player_t > 900:
                return {"ok": False, "error": "Type /showlocation in game chat while docked there"}
            if self._player_sys != system:
                return {"ok": False, "error": f"Your last reading is in {self._player_sys}, not {system}"}
            body = self._db.body_near(self._player, system)
            jump = name in gateways.JUMP_POINTS
            if jump and (st := gateways.station_of(name)) and (sl := self._db.locations.get(st)) is not None \
                    and sl.pos is not None and dist(sl.pos, self._player) < gateways.SAME_SPOT_M:
                return {"ok": False, "error": f"That reading is at {st}, not at the Gateway. Take it right at the "
                                              "jump point (tens of km from the station), before you fly in"}
            if body and (name in gateways.GATEWAYS or jump):  # gateways are far out; Wikelo's orbit planets
                return {"ok": False, "error": f"That reading is near {body.name}, not at the {'Gateway' if jump else 'station'}. "
                                              + ("Take it right at the jump point, before you fly in" if jump
                                                 else "Take it while docked at the station")}
            key = gateways.learn_key(name)
            gateways.save_learned(PLACES_PATH, key, system, self._player)
            self._share_place(key)
            _, self._unplaced = gateways.apply(self._db, self._learned_places())
            self._apply_uex_stations(offline=True)          # keep the UEX-only places alongside
            self._db.save()
            self._db_changed()
            return {"ok": True, "name": name}

    def _place_uex_here(self, name, system):
        """A place known only from UEX a surface outpost is stored relative to its moon or planet (it
        turns with it), a station by its position."""
        if not self._player or time.time() - self._player_t > 900:
            return {"ok": False, "error": "Type /showlocation in game chat while you're there"}
        if self._player_sys != system:
            return {"ok": False, "error": f"Your last reading is in {self._player_sys}, not {system}"}
        cur = self._unplaced.get(name) or self._db.locations.get(name)
        places = gateways.load_learned(PLACES_PATH)
        if cur and cur.kind == "surface" and cur.body:
            b = self._db.bodies.get(cur.body)
            near = self._db.body_near(self._player, system)
            if not b or not near or near.name != b.name:
                return {"ok": False, "error": f"That reading isn't on {cur.body}. Take it while you're at {name}"}
            # The reading itself is kept too (global position and time): the spot on the planet is worked
            # out from it with the planet's current alignment, so lining the planet up later doesn't move it.
            places[name] = {"system": system, "body": b.name, "local": list(b.to_local(self._player, self._player_t)),
                            "offset": b.rotation_offset_deg, "reading": {"pos": list(self._player), "t": self._player_t},
                            "at": time.time()}
        else:
            places[name] = {"system": system, "pos": list(self._player), "at": time.time()}
        PLACES_PATH.write_text(json.dumps({"places": places}, indent=1), encoding="utf-8")
        self._share_place(name)
        self._db.locations.pop(name, None)
        self._unplaced.pop(name, None)
        self._apply_uex_stations(offline=True)
        self._db_changed()
        return {"ok": True, "name": name}

    def update_location(self, name, pad=None, notes=None):
        with self._lock:
            loc = self._db.locations.get(name)
            if not loc:
                return {"ok": False}
            if pad is not None and pad != loc.pad:
                loc.pad = pad
                # Shared: shows for everyone once a second datarunner agrees (or a trusted one says so).
                # "unknown" takes your report back.
                if pad in ("unknown", "none", "vehicle", "small", "medium", "large", "xl", "hangar") and loc.source != "user":
                    self._community.post_pad(name, pad, self._dr_cfg().get("username"))
            if notes is not None:
                loc.notes = notes
            self._db.save()
            self._static_version += 1
            if loc.source == "user":
                self._backup_soon()
            return {"ok": True}

    def rename_location(self, old, new):
        with self._lock:
            new = (new or "").strip()
            loc = self._db.locations.get(old)
            if not loc or not new:
                return {"ok": False, "error": "Enter a name"}
            if new != old and new in self._db.locations:
                return {"ok": False, "error": f"A place called {new} already exists"}
            self._db.locations.pop(old)
            loc.name = new
            self._db.locations[new] = loc
            for t in self._route:
                if t["place"] == old:
                    t["place"] = new
            if self._guide == old:
                self._guide = new
            self._db.save()
            self._db_changed()
            return {"ok": True}

    def set_pinned(self, name, pinned):
        with self._lock:
            if name in self._db.locations:
                self._db.locations[name].pinned = bool(pinned)
                self._db.save()
                self._static_version += 1
                self._backup_soon()
            return {"ok": True}

    def delete_location(self, name):
        with self._lock:
            if self._db.locations.pop(name, None):
                if self._guide == name:                        # don't keep guiding to a place that's gone
                    self._guide = None
                before = len(self._route)
                self._route = [t for t in self._route if t.get("place") != name]
                if len(self._route) != before or self._guide is None:
                    self._save_settings()
                self._db.save()
                self._db_changed()
            return {"ok": True}

    def set_guide(self, name):
        with self._lock:
            self._guide = name if name in self._db.locations else None
            self._save_settings()
            return {"ok": True}

    def calibrate_at(self, name):
        """The player is standing at `name`: fix that planet's rotation offset."""
        with self._lock:
            loc = self._db.locations.get(name)
            if not self._player:
                return {"ok": False, "error": "Type /showlocation in game chat while standing there"}
            if not loc or loc.kind != "surface":
                return {"ok": False, "error": "Calibration needs a place on a planet or moon"}
            if loc.system != self._player_sys:
                return {"ok": False, "error": f"You're in {self._player_sys}, not {loc.system}"}
            if not can_align(self._db.bodies.get(loc.body)):
                return {"ok": False, "error": f"{loc.body} has no landable surface to line up"}
            res = self._db.calibrate(loc.body, loc, self._player, self._player_t)
            if res["ok"]:
                self._record_cal("manual", loc.body, loc.name, res["correction"])
                self._static_version += 1
            return res

    def set_autoloc(self, hotkey=None, interval=None, open_chat=None, loc_hotkey=None, chat_key=None, *_ignored):
        """hotkey: show/hide Quantum. loc_hotkey: type /showlocation. chat_key: the game's chat show/hide
        key, watched so /showlocation isn't typed while chat is hidden ("" = off). (interval is ignored:
        no automatic /showlocation any more.)"""
        self._sender.configure(hotkey, 0, open_chat, None, True, loc_hotkey, False, chat_key=chat_key)
        st = self._sender.status()
        self._settings["autoloc"] = {k: st[k] for k in ("hotkey", "loc_hotkey", "open_chat", "chat_key")}
        self._settings.setdefault("datarunner", {})["shot_hotkey"] = st["shot_hotkey"]   # may have lost a clash
        self._save_settings()
        return st

    def set_antiafk(self, hotkey=None, action=None, focus=None, on=None):
        """Anti-AFK (Settings > Hotkeys): its on/off key, what it sends, whether to bring the game to the front,
        and on/off now. Everything but on/off is remembered."""
        st = self._sender.configure_afk(hotkey, on, action, focus)
        a = st["afk"]
        self._settings["antiafk"] = {"hotkey": a["hotkey"], "action": a["action"], "focus": a["focus"]}
        self._save_settings()
        return st

    def send_bug_report(self, message, contact=""):
        """Settings > Report a bug: sent to the Quantum server with your UEX name (if you've added your
        Secret Key), the Quantum and game versions, and how to reach you if you chose to say."""
        message, contact = str(message or "").strip(), str(contact or "").strip()
        if len(message) < 5:
            return {"ok": False, "error": "Describe the bug first"}
        try:
            game = " ".join(x for x in self._dr_game_build()[:2] if x) or None
        except Exception:
            game = None
        if self._tracker.build:
            game = f"{game or '?'} (build {self._tracker.build})"
        user = self._dr_cfg().get("username") or (self._dr_cfg().get("uex_user") or {}).get("username")
        r = self._community.post_bug({"message": message[:5000], "contact": contact[:200] or None, "username": user,
                                      "app_version": updater.VERSION, "game_version": game})
        if r.get("status") == "ok":
            return {"ok": True}
        return {"ok": False, "error": {"off": "Community features are turned off, so there's nowhere to send it",
                                       "requests_limit_reached": "Too many bug reports from this connection. Try again in an hour",
                                       "banned": "This UEX account can't send reports to Quantum"}.get(
            r.get("status"), "The Quantum server couldn't be reached. Try again in a minute")}

    # ------------------------------------------------------------ personal weapons, armor, blueprints
    def _wiki_spots(self, prices, terms=None, places=None):
        """The wiki's copy of UEX shop prices as "where to buy" rows, with Quantum's place for each terminal."""
        if terms is None:
            try:
                terms, places = self._uex.terminals(), self._uex.place_map(self._db.locations)
            except Exception:
                terms, places = {}, {}
        out = []
        for p in prices or []:
            t = terms.get(p.get("terminal_id")) if terms else None
            place = (places or {}).get(p.get("terminal_id"))
            where = uex.where(t) if t else (p.get("where") or p.get("terminal") or "")
            out.append({"where": where, "shop": self._shop_name(p.get("terminal") or (t or {}).get("name"), where),
                        "place": place, "system": p.get("system") or (t or {}).get("star_system_name"),
                        "price": p["price"], "dist": self._dist_from_you(place), "updated": p.get("updated")})
        out.sort(key=lambda x: x["price"])
        return out

    GEAR_KINDS = ("weapons", "armor", "blueprints", "gadgets", "clothing", "consumables", "utility")
    # A shopping-list entry's kind -> the tab whose list knows its shops
    SHOP_GEAR = {"weapon": "weapons", "armor": "armor", "gadget": "gadgets", "clothing": "clothing",
                 "consumable": "consumables", "utility": "utility"}

    def gear_list(self, kind, fresh=False):
        """Everything of one kind from the Star Citizen Wiki for the Weapons, Armor and Blueprints tabs, with
        where to buy it (UEX's prices, as the wiki has them)."""
        if kind not in self.GEAR_KINDS:
            return {"ok": False, "error": "Unknown kind"}
        try:
            data = self._gear.items(kind, fresh=bool(fresh))
        except Exception as e:
            return {"ok": False, "error": f"Couldn't reach the Star Citizen Wiki ({e}). Try again in a minute"}
        items = data.get("items") or []
        if kind != "blueprints":
            try:
                terms, places = self._uex.terminals(), self._uex.place_map(self._db.locations)
            except Exception:
                terms, places = {}, {}
            out = []
            for i in items:
                i = dict(i)
                i["buy"] = self._wiki_spots(i.pop("prices", None), terms, places)[:10]
                out.append(i)
            items = out
        else:                                   # what a blueprint makes: the part's numbers when the game files have it
            for b in items:
                g = self._game.find(b.get("out_uuid")) if b.get("out_uuid") else None
                if g:
                    b["out_tab"] = "components"
        return {"ok": True, "kind": kind, "items": items, "at": data.get("at"), "stale": bool(data.get("stale"))}

    # Pictures for weapons and armor. These pages sit in the wiki's armor / personal-weapon categories, which
    # the ship-part pictures skip on purpose ("Citadel" is a shield and an armor set), so they're looked up on
    # their own, with the page's main picture first and else the picture on the page that best fits the name
    # (many armor pages keep theirs in a gallery: "ADP Core Black" -> File:Adp_core_black_02.png).
    @staticmethod
    def _gear_title(name):
        return re.sub(r"[“”„″]", '"', re.sub(r"[‘’]", "'", str(name or ""))).strip()

    def _gear_file_pick(self, name, files):
        words = [w for w in re.findall(r"[a-z0-9]+", name.lower()) if len(w) > 1]
        best, score = None, 0
        for f in files:
            fl = f.lower()
            if re.search(r"icon|logo|brand|badge|placeholder|no[_ ]?image|\.svg$", fl):
                continue
            sc = sum(1 for w in words if w in fl)
            if sc > score:
                best, score = f, sc
        return best if score >= max(1, min(2, len(words))) else None

    def gear_images(self, refs, size=480):
        """{name: picture url} for weapon and armor pages (and blueprints' products)."""
        refs = [r for r in dict.fromkeys(refs or []) if r]
        titles = {r: self._gear_title(r) for r in refs}
        try:
            got = self._wikiapi.pictures(list(set(titles.values())), size=size, any_page=True)
        except Exception:
            got = {}
        out, tries = {}, 0
        fb = getattr(self, "_gear_pic_fb", None)
        if fb is None:
            fb = self._gear_pic_fb = {}
        for r in refs:
            t = titles[r]
            url = got.get(t)
            if not url and tries < 12:              # no main picture: the best match among the page's files
                if (t, size) in fb:
                    url = fb[(t, size)]
                else:
                    tries += 1
                    try:
                        f = self._gear_file_pick(t, self._wikiapi.page_files([t]))
                        url = self._wikiapi.file_urls([f], size).get(f) if f else None
                    except Exception:
                        url = None
                    fb[(t, size)] = url
            over, mine = self._community.photo_overrides(), self._community.photos()
            k = self._pic_key(r)
            out[r] = over.get(k) or url or mine.get(k)
        return out

    def gear_image(self, ref):
        return self.gear_images([ref], size=720).get(ref)

    def gear_photo(self, ref, url=None):
        """A piece of gear's picture as a data: URL, for a marketplace listing's photo when the seller links
        the item from Gear (the page can't copy a picture off another site into an upload itself).
        url: the picture the Gear tab already has; else it's looked up by name. -> {ok, data} or {ok: False}."""
        if not (isinstance(url, str) and url.startswith("https://")):
            url = self.gear_image(ref)
        if not (isinstance(url, str) and url.startswith("https://")):
            return {"ok": False, "error": "No picture of it on the wiki"}
        try:
            req = urllib.request.Request(url, headers={"User-Agent": "Mozilla/5.0 Quantum", "Accept": "image/*"})
            with urllib.request.urlopen(req, timeout=15) as r:
                kind = (r.headers.get("Content-Type") or "").split(";")[0].strip()
                body = r.read(8_000_001)
        except Exception as e:
            return {"ok": False, "error": f"Couldn't download its picture ({e})"}
        if not kind.startswith("image/") or not body or len(body) > 8_000_000:
            return {"ok": False, "error": "Its picture couldn't be used"}
        return {"ok": True, "data": f"data:{kind};base64,{base64.b64encode(body).decode('ascii')}"}

    def blueprint_detail(self, uuid):
        """One blueprint with the missions that unlock it, and the numbers of what it makes."""
        try:
            b = self._gear.blueprint(uuid)
        except Exception as e:
            return {"ok": False, "error": f"Couldn't reach the Star Citizen Wiki ({e})"}
        out = dict(b)
        out["unlocks"] = self._fill_unlocks(b.get("unlocks") or [])
        gv = self._game_view(b.get("out_uuid"), b.get("name"), None) if b.get("out_uuid") else None
        if gv:
            out["out_game"] = gv
        return {"ok": True, "blueprint": out}

    def vehicle_carry(self):
        """{ok, carries: {carrier: [vehicle, ...]}}: snubs and rovers that dock on or ride in a ship
        (vehicle_carry.json, kept by hand: no data source has it)."""
        for base in (HERE, RES):
            try:
                d = json.loads((base / "vehicle_carry.json").read_text(encoding="utf-8"))
                return {"ok": True, "carries": {k: list(v) for k, v in (d.get("carries") or {}).items()}}
            except Exception:
                continue
        return {"ok": True, "carries": {}}

    def resource_catalog(self):
        """What can be mined or harvested, and where: {ok, kinds: {ship|roc|hand|harvest: {resource:
        [{body, system, caves}]}}}, from the planets' and moons' own pages on the wiki (services.json)."""
        c = getattr(self, "_res_cat", None)
        if c is None or c[0] is not self._service_records:
            c = self._res_cat = (self._service_records, services.resources(self._service_records))
        return {"ok": True, "kinds": c[1]}

    def known_sources(self, name):
        """Where players have found an item or commodity no shop sells (gear.KNOWN_SOURCES)."""
        return {"ok": True, "notes": gear.known_sources(name)}

    def gear_obtain(self, uuid=None, name=None):
        """How to get a piece of gear no shop sells: the blueprint that makes it (and the missions that unlock
        that blueprint), whether it's loot, and where players have found it. {ok, blueprint, notes}."""
        out = {"ok": True, "blueprint": None, "notes": gear.known_sources(name)}
        try:
            bps = self._gear.items("blueprints").get("items") or []
        except Exception:
            bps = []
        u, n = str(uuid or "").lower(), str(name or "").strip().lower()
        b = next((x for x in bps if u and str(x.get("out_uuid") or "").lower() == u), None) \
            or next((x for x in bps if n and (x.get("name") or "").strip().lower() == n), None)
        if b:
            try:
                d = self._gear.blueprint(b["uuid"])
            except Exception:
                d = {}
            out["blueprint"] = {"uuid": b.get("uuid"), "name": b.get("name"), "default": b.get("default"),
                                "missions": b.get("missions"), "unlocks": self._fill_unlocks((d or {}).get("unlocks") or []),
                                "time_label": b.get("time_label"),
                                "ingredients": [x.get("name") for x in b.get("ingredients") or []][:6]}
        out["loot"] = self._loot_places()
        return out

    # Mission titles on the wiki come from the game's templates: "Verified Bounty: ~mission(TargetName) at
    # ~mission(Location)". The game fills those in per contract (the target is a random name each time), so
    # Quantum can't know the name, but it can say what the gaps are and list the places the mission can use.
    RE_MISSION_VAR = re.compile(r"~mission\(([^)|]*)[^)]*\)|\[([A-Za-z][A-Za-z0-9_ ]{1,40})\]")

    def _mission_vars(self, text, info=None, below=False):
        """Fill the template gaps in a mission title or briefing with what's known."""
        if not text:
            return text
        info = info or {}
        dest = ((info.get("destinations") or {}).get("names") or []) + ((info.get("pickups") or {}).get("names") or [])
        dest = list(dict.fromkeys(dest))

        def sub(m):
            raw = (m.group(1) or m.group(2) or "").strip()
            k = re.sub(r"[^a-z]", "", raw.lower())
            if not k:
                return "…"
            if re.search(r"target|name|bounty|criminal|person|npc|boss", k) and not re.search(r"loc|place|ship", k):
                return "a wanted target (named when you accept)"
            if re.search(r"ship|vehicle", k):
                return "a target ship"
            if re.search(r"location|destination|place|site|outpost|planet|moon|area|poi|loc", k):
                if len(dest) == 1:
                    return dest[0]
                if dest:
                    return f"one of {len(dest)} places{' (listed below)' if below else ''}"
                return "the place named in the contract"
            if re.search(r"system", k):
                sy = info.get("systems") or []
                return " or ".join(sy) if sy else "the system named in the contract"
            if re.search(r"cargo|item|commodity|good", k):
                return "the cargo named in the contract"
            words = re.sub(r"(?<=[a-z])(?=[A-Z])|_", " ", raw).strip().lower()
            return f"the {words} named in the contract"
        return self.RE_MISSION_VAR.sub(sub, text)

    def _fill_unlocks(self, unlocks):
        """Blueprint-unlocking missions with their template gaps filled, and the places they can send you."""
        out = []
        for i, m in enumerate(unlocks or []):
            m = dict(m)
            t = m.get("title") or ""
            m["raw_title"] = t                         # what the wiki is searched by when the mission is opened
            if self.RE_MISSION_VAR.search(t) and i < 8:
                info = None
                try:
                    info = self._missions.page(m.get("ref"), m.get("code"), t)
                except Exception:
                    pass
                m["title"] = self._mission_vars(t, info)
                if info:
                    rows = self._place_rows(info.get("destinations")) or self._place_rows(info.get("pickups"))
                    m["places"] = [r for r in rows if r.get("place") or r.get("body")][:5]
                    m["places_more"] = max(0, len(rows) - 5) + ((info.get("destinations") or {}).get("more") or 0)
            elif self.RE_MISSION_VAR.search(t):
                m["title"] = self._mission_vars(t)
            out.append(m)
        return out

    # Where loot turns up, as kinds of place on the map (the wiki marks gear as lootable but doesn't say where
    # it spawns): the nearest few of each kind to you, so there's somewhere to set a route to.
    LOOT_KINDS = (
        ("Contested Zones", r"^(ruin station|checkmate station|orbituary)$", "Ruin Station",
         "High-tier armor and weapons in the reward rooms and on the guards"),
        ("Bunkers and security posts", r"security post|security depot|colonial bunker|\bbunker\b|\bugf\b", "Security Post",
         "Weapon and armor crates, and the gear the guards drop"),
        ("Distribution Centres", r"distribution cent", "Distribution",
         "Crates on the floors and in the security rooms"),
        ("Derelict outposts and wrecks", r"derelict|abandoned outpost|wreck|graveyard", "Derelict",
         "Loot boxes in the wrecks and outposts, and on whoever is guarding them"),
    )

    def _loot_places(self):
        with self._lock:
            t = time.time()
            here, here_sys = self._player, self._player_sys
            groups = []
            for label, rx, search, why in self.LOOT_KINDS:
                r = re.compile(rx, re.I)
                found = []
                for n, L in self._db.locations.items():
                    if L.source != "db" or L.pos is None or not r.search(n):
                        continue
                    d = None
                    if here and here_sys == L.system:
                        try:
                            d = dist(here, self._db.global_pos(L, t))
                        except Exception:
                            d = None
                    found.append({"name": n, "system": L.system, "body": L.body, "dist": d})
                if not found:
                    continue
                found.sort(key=lambda x: (x["dist"] is None, x["dist"] or 0, x["system"] != (here_sys or "Stanton"), x["name"]))
                groups.append({"label": label, "why": why, "search": search, "count": len(found), "places": found[:3]})
            return groups
