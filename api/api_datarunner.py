"""Api, part of: The datarunner program: price reports to UEX, your reports, ranks, profile, jobs and alignments.

A mixin of app.py's Api (class Api(... DatarunnerMixin ...)): the methods are the Api's, `self` is the one Api.
Module-level names come from qbase.py."""
from qbase import *  # noqa: F401,F403


class DatarunnerMixin:
    # ------------------------------------------------------------ datarunner (UEX price reports)
    def _dr_cfg(self):
        return self._settings.setdefault("datarunner", {})

    def _dr_log(self, text):
        self._sender._event(f"Screenshot: {text}")       # shows in Settings > Log, for troubleshooting

    def _dr_timed(self, what, fn, timeout=2.0):
        """Run a window call with a time limit. Some of them wait on another program (or on Quantum's own
        window thread), and a call that never returns must not stop the screenshot."""
        box = {}
        th = threading.Thread(target=lambda: box.setdefault("r", fn()), daemon=True)
        th.start()
        th.join(timeout)
        if th.is_alive():
            self._dr_log(f"{what} didn't respond, carrying on")
        return box.get("r")

    def _dr_take_shot(self, from_button=False):
        """Add a screenshot of the game to the report being prepared.
        Quantum minimises itself if it's in the way, the game is brought forward, the shot is taken,
        and Quantum is put back the way it was (on top again, or pinned if it was the F9 overlay).
        Every window call is non-blocking or time-limited, so this always finishes."""
        if os.name != "nt":
            return datarunner.capture()                    # raises: Windows only
        u = overlay.user32
        u.ShowWindowAsync.argtypes = (wintypes_hwnd_type(), ctypes_int_type())
        ASYNC = 0x4000                                     # SWP_ASYNCWINDOWPOS: post it, don't wait
        keep = overlay.SWP_NOMOVE | overlay.SWP_NOSIZE | 0x0010   # + SWP_NOACTIVATE
        # The exact title first: a browser tab about Star Citizen also has "star citizen" in its title.
        wins = datarunner.game_windows()                  # biggest "Star Citizen" window = the game
        self._dr_log("game windows: " + ("; ".join(f"{w}×{h} at {x},{y}" for _, (x, y, w, h) in wins) or "none"))
        game = wins[0][0] if wins else None
        if not game:
            raise datarunner.DatarunnerError("Star Citizen isn't open. Open the terminal in game first")
        me = u.FindWindowW(None, overlay.WINDOW_TITLE)
        showing = bool(me) and bool(u.IsWindowVisible(me)) and not u.IsIconic(me)
        pinned = showing and overlay._is_overlay_up(me)
        hide = showing and (from_button or pinned)
        place = overlay.get_placement(me) if hide else None     # maximised? where? put back exactly so after
        cloaked = False
        try:
            if hide:
                # Cloaked, not minimised: the window keeps its size, place and maximised state, so it comes
                # back exactly as it was (minimise + restore left a maximised Quantum small and off screen).
                cloaked = overlay.cloak(me, True)
                self._dr_log("hiding Quantum" if cloaked else "minimising Quantum")
                if not cloaked:
                    if pinned:
                        u.SetWindowPos(me, overlay.HWND_NOTOPMOST, 0, 0, 0, 0, keep | ASYNC)
                    u.ShowWindowAsync(me, 6)               # SW_MINIMIZE
            if u.IsIconic(game):
                u.ShowWindowAsync(game, 9)                 # SW_RESTORE
            self._dr_log("bringing Star Citizen forward")
            u.SetWindowPos(game, wintypes_hwnd(0), 0, 0, 0, 0, keep | ASYNC)   # HWND_TOP
            u.SetForegroundWindow(game)
            time.sleep(0.35 if cloaked else 0.8 if hide else 0.15)   # the game redraws (minimising also animates)
            self._dr_log("capturing")
            shot = datarunner.capture(game)
        finally:
            if cloaked:
                self._dr_uncloak_me(me, pinned)
            elif hide:
                self._dr_restore_me(me, pinned, place)
        return shot

    def _dr_uncloak_me(self, me, pinned):
        """Show Quantum again after a cloaked screenshot: same size and place it never left."""
        u = overlay.user32
        self._dr_log("bringing Quantum back")
        overlay.cloak(me, False)
        keep = overlay.SWP_NOMOVE | overlay.SWP_NOSIZE | 0x0010 | 0x0040 | 0x4000   # + NOACTIVATE, SHOWWINDOW, ASYNC
        # The game was brought in front: raise Quantum above it again (pin for a moment, then unpin,
        # unless it was up as the F9 overlay, which stays pinned).
        u.SetWindowPos(me, overlay.HWND_TOPMOST, 0, 0, 0, 0, keep)
        if not pinned:
            time.sleep(0.15)
            u.SetWindowPos(me, overlay.HWND_NOTOPMOST, 0, 0, 0, 0, keep)
        self._dr_timed("focusing Quantum", lambda: overlay._force_foreground(me), 1.5)
        self._dr_timed("redrawing", self._nudge_redraw, 1.5)

    def _dr_restore_me(self, me, pinned, place=None):
        """Put Quantum back in view after a screenshot."""
        u = overlay.user32
        self._dr_log("bringing Quantum back")
        # pywebview's own restore tells WebView2 it's visible again (a plain restore can leave it blank)
        self._dr_timed("restoring the window", lambda: webview.windows[0].restore(), 2.0)
        if u.IsIconic(me):
            u.ShowWindowAsync(me, 9)                       # SW_RESTORE
        # restore() also takes a maximised window down to normal size (it shrank and slid off screen):
        # put it back maximised, in the same place.
        self._dr_timed("putting the window back", lambda: overlay.put_back(me, place), 1.5)
        keep = overlay.SWP_NOMOVE | overlay.SWP_NOSIZE | 0x0010 | 0x0040 | 0x4000   # + SHOWWINDOW, ASYNC
        # Raising a window above the game needs no focus rights: pin it for a moment, then unpin
        # (or leave it pinned if it was up as the F9 overlay).
        u.SetWindowPos(me, overlay.HWND_TOPMOST, 0, 0, 0, 0, keep)
        if not pinned:
            time.sleep(0.15)
            u.SetWindowPos(me, overlay.HWND_NOTOPMOST, 0, 0, 0, 0, keep)
        self._dr_timed("focusing Quantum", lambda: overlay._force_foreground(me), 1.5)
        self._dr_timed("redrawing", self._nudge_redraw, 1.5)

    def _dr_start_job(self, from_button=False):
        """Screenshot, then read it, on a thread of its own: the page polls dr_job() and is never left
        waiting on a call that can't return."""
        with self._lock:
            if self._dr_job.get("state") == "shooting" and time.time() - self._dr_job.get("started", 0) < 25:
                return "busy with the last screenshot"
            if not from_button and not self._dr_terminal:
                # The hotkey only works once a terminal is picked in Datarunner (by you, or from the game log when
                # you land there). Pressed by mistake anywhere else, it takes nothing. The page shows why.
                self._dr_job = {"state": "error", "n": self._dr_job.get("n", 0) + 1, "started": time.time(),
                                "from_button": False,
                                "error": "No screenshot taken: pick the terminal in Datarunner first, then press the key at its kiosk"}
                return "ignored: no terminal picked in Datarunner"
            self._dr_job = {"state": "shooting", "n": self._dr_job.get("n", 0) + 1, "started": time.time(),
                            "from_button": from_button}
        threading.Thread(target=self._dr_run_job, args=(from_button,), daemon=True).start()
        return "taking a screenshot"

    def _set_job(self, **kw):
        with self._lock:
            self._dr_job.update(kw)

    def _dr_run_job(self, from_button):
        try:
            shot = self._dr_take_shot(from_button)
        except Exception as e:                            
            self._dr_log(f"failed ({e})")
            return self._set_job(state="error", error=str(e))
        with self._lock:
            self._dr_shots = (self._dr_shots + [shot])[-datarunner.MAX_SHOTS:]
            self._dr_seq += 1
            index = len(self._dr_shots) - 1
        rx, ry = getattr(shot, "rect", (0, 0, 0, 0))[:2]
        self._dr_log(f"saved {shot.w}×{shot.h} ({getattr(shot, 'how', '?')}) from {rx},{ry}")
        self._set_job(state="done", index=index)

    def dr_capture(self, delay=0):
        """Screenshot button (the page counts down first). Returns at once; poll dr_job()."""
        return {"ok": True, "text": self._dr_start_job(from_button=True)}

    def dr_job(self):
        """Where the last screenshot is up to."""
        with self._lock:
            job = dict(self._dr_job)
        if job.get("state") == "shooting" and time.time() - job.get("started", 0) > 25:
            job.update(state="error", error="The screenshot took too long. Settings > Log shows the step it stopped at")
        return job

    def dr_status(self):
        c = self._dr_cfg()
        return {"live": self._dr.live, "has_secret": bool(c.get("secret")), "shot_hotkey": self._sender.shot_hotkey,
                "folder": str(self._dr.test_dir), "shots": len(self._dr_shots), "shot_policy": self._dr_shot_policy()}

    # UEX wants a screenshot with every report during a new datarunner's 90-day evaluation. Its API has
    # no field saying whether that's over, but a report sent without one during evaluation is refused
    # with "screenshot_required" (and nothing is stored), so UEX's own answer is the test.
    EVAL_DAYS, RECHECK_DAYS = 90, 7

    def _dr_shot_policy(self):
        """{optional: UEX has accepted a report from you without a screenshot, can_try: it's been 90
        days since your first report and UEX hasn't said no in the last week}."""
        st = self._dr_cfg().get("shot") or {}
        first = self._dr_first_report()
        now = time.time()
        if st.get("optional"):
            return {"optional": True, "can_try": True, "first": first}
        old_enough = bool(first) and now - first >= self.EVAL_DAYS * 86400
        recent_no = st.get("required_at") and now - st["required_at"] < self.RECHECK_DAYS * 86400
        return {"optional": False, "can_try": old_enough and not recent_no, "first": first,
                "days_left": max(0, int(self.EVAL_DAYS - (now - first) / 86400)) if first else None,
                "refused_at": st.get("required_at")}

    def _dr_first_report(self):
        """When you first reported: the earliest of this PC's log and what the Quantum server knows."""
        times = [e.get("at") for e in self._dr_report_log() if not e.get("test") and e.get("at")]
        if self._dr_cfg().get("first_seen"):
            times.append(self._dr_cfg()["first_seen"])
        return min(times) if times else None

    def dr_set_secret(self, secret, _from_account=False):
        secret = (secret or "").strip()
        if secret and not self._uex.token:
            # The Secret Key is checked through UEX with the Bearer Token, so it can't work without one
            return {"ok": False, "need": "token", "has_secret": bool(self._dr_cfg().get("secret")),
                    "error": "Enter your UEX Bearer Token first, then your Secret Key"}
        cfg = self._dr_cfg()
        changed = secret != (cfg.get("secret") or "")
        if secret:
            cfg["secret"] = secret
        else:
            cfg.pop("secret", None)
        old = cfg.pop("session", None) if changed else None
        if changed:
            cfg.pop("uex_user", None)                     # whose key it is gets asked of UEX again
            if cfg.get("username") and secret:
                cfg.pop("username", None)                 # filled in again from the new key's UEX account
        self._save_settings()
        if changed:
            def swap():                   # sign out of the old key's account, then in with the new key
                if old:
                    self._community.logout(old.get("token"))
                if secret:
                    self._sign_in()
                    self._account_link()
            threading.Thread(target=swap, daemon=True).start()
            if secret and not _from_account:
                self._account_keys_push_soon()
        return {"ok": True, "has_secret": bool(secret)}

    def dr_set_hotkey(self, key):
        self._sender.configure(shot_hotkey=key or "")
        self._dr_cfg()["shot_hotkey"] = self._sender.shot_hotkey
        self._save_settings()
        return {"ok": True, "shot_hotkey": self._sender.shot_hotkey}

    def dr_shot_image(self, index):
        try:
            sh = self._dr_shots[int(index)]
        except (IndexError, ValueError, TypeError):
            return {"ok": False}
        return {"ok": True, "src": datarunner.thumbnail(sh, 1600), "w": sh.w, "h": sh.h}

    def dr_shot_view(self, shot_id):
        """The exact 1920x1080 image a shot goes to UEX as (its own report), to check before sending."""
        with self._lock:
            sh = next((x for x in self._dr_shots if x.id == shot_id), None)
        if not sh:
            return {"ok": False, "error": "That screenshot is gone"}
        try:
            return dict(datarunner.shot_url(sh), ok=True, id=sh.id, shot_w=sh.w, shot_h=sh.h)
        except Exception as e:
            watcher_mod.log_error("shot view")
            return {"ok": False, "error": str(e)}

    def _dr_shot(self, shot_id=None):
        """The shot a report goes with: the one asked for, or the only one."""
        if shot_id is not None:
            return next((x for x in self._dr_shots if x.id == shot_id), None)
        return self._dr_shots[0] if len(self._dr_shots) == 1 else None

    def dr_shots(self):
        return {"shots": [{"id": s.id, "thumb": datarunner.thumbnail(s), "w": s.w, "h": s.h, "at": s.at} for s in self._dr_shots],
                "seq": self._dr_seq}

    def _dr_drop_shot(self, shot_id):
        """A report went out: its screenshot is done (all of them if the report didn't name one)."""
        with self._lock:
            if shot_id is None:
                self._dr_shots = []
            else:
                self._dr_shots = [x for x in self._dr_shots if x.id != shot_id]
            self._dr_seq += 1

    def dr_clear_shots(self, index=None):
        with self._lock:
            if index is None:
                self._dr_shots = []
            elif 0 <= int(index) < len(self._dr_shots):
                self._dr_shots.pop(int(index))
            self._dr_seq += 1
        return self.dr_shots()

    def _dr_terminals(self):
        return {i: t for i, t in self._uex.terminals().items() if t.get("type", "commodity") == "commodity"}

    def _dr_game_build(self):
        running = self._game_on()
        path = self._tracker.log_path or ""
        env = self._game_env(path)
        # The log knows the release (Branch: sc-alpha-4.10.0, FileVersion: 4.10.193.11644) but not
        # which patch of it: a 4.10.1 hotfix still says 4.10.0 / 4.10.193. So the log gives major.minor,
        # and UEX's own version list (the numbering the community uses) gives the patch, as long as
        # both agree on the release. If they don't (a new release UEX hasn't listed), the log wins.
        logged = None
        try:
            with open(path, "r", encoding="utf-8", errors="replace") as fh:
                head = fh.read(200_000)
            m = (re.search(r"Branch:\s*sc-alpha-(\d+\.\d+(?:\.\d+)?)", head)
                 or re.search(r"(?:File|Product)Version:\s*(\d+\.\d+)\.", head)
                 or re.search(r"sc-alpha-(\d+\.\d+(?:\.\d+)?)", head))
            logged = m.group(1) if m else None
        except OSError:
            pass
        version = logged
        if logged:
            release = ".".join(logged.split(".")[:2])
            try:
                rows, _ = self._uex.get("game_versions")
                listed = (rows[0] if rows else {}).get("ptu" if "PTU" in env else "live") or ""
            except uex.UexError:
                listed = ""
            if listed == release or listed.startswith(release + "."):
                version = listed
        return version, env, running

    def _game_version_label(self, build=None):
        """'4.10.2 LIVE' for the game build Quantum is tagging things with, instead of the raw build number
        (12913470) the log keys everything on. Remembered per build, so it still reads right once the game
        is closed."""
        build = str(build or self._game_build() or "")
        if not build:
            return ""
        labels = self._settings.get("build_labels") or {}
        if str(self._tracker.build or "") == build:
            try:
                version, env, _ = self._dr_game_build()
            except Exception:
                version, env = None, ""
            if version:
                label = f"{version} {env}".strip()
                if labels.get(build) != label:
                    labels = dict(list(labels.items())[-9:], **{build: label})
                    self._settings["build_labels"] = labels
                    self._save_settings()
                return label
        return labels.get(build, "")

    def dr_game_status(self):
        """Just the game-version line of the report form, so the page can refresh it when the game starts."""
        try:
            version, env, running = self._dr_game_build()
            return {"ok": True, "game_running": running, "game_version": version, "env": env}
        except Exception as e:
            return {"ok": False, "error": str(e)}

    def _dr_game_version(self):
        """LIVE or PTU version for the report: from UEX's version list, picked by which Game.log is read."""
        ptu = "ptu" in (self._tracker.log_path or "").lower().replace("/", "\\").split("\\")
        try:
            rows, _ = self._uex.get("game_versions")
            v = rows[0] if rows else {}
        except uex.UexError:
            v = {}
        return (v.get("ptu") if ptu else v.get("live")) or "", "PTU" if ptu else "LIVE"

    def _dr_params(self):
        try:
            rows, _ = self._uex.get("data_parameters")
            p = rows[0] if rows else {}
        except uex.UexError:
            return {}
        com = p.get("commodity") if isinstance(p.get("commodity"), dict) else p
        glob = p.get("global") if isinstance(p.get("global"), dict) else p
        return {"accepting": glob.get("is_accepting_reports", 1), "accepting_ptu": glob.get("is_accepting_ptu_reports"),
                "commodity_accepted": com.get("is_accepted", 1), "price_variation": com.get("price_variation")}

    def dr_prefill(self, id_terminal=None):
        """Everything the report form can fill in by itself: the terminal where the game log puts you,
        what it trades with UEX's current numbers, the game version and UEX's limits."""
        def run():
            terms = self._dr_terminals()
            places = self._uex.place_map(self._db.locations)
            spot, _, how = self._log_spot(self._tracker.cur or {}) if self._game_on() else (None, 0, None)
            here = {i for i, p in places.items() if p and p == spot and i in terms}
            tid = int(id_terminal) if id_terminal else (min(here) if here else None)
            self._dr_terminal = tid
            listing = sorted(({"id": i, "name": t.get("name"), "where": uex.where(t), "system": t.get("star_system_name"),
                               "here": i in here} for i, t in terms.items()),
                             key=lambda x: (not x["here"], x["system"] or "", x["where"] or "", x["name"] or ""))
            rows, at = self._uex.get("commodities_prices_all")
            rows = self._community.overlay(rows)
            coms, _ = self._uex.get("commodities")
            names = {c["id"]: c["name"] for c in coms}
            out, boxes = [], set()
            for r in rows:
                if r.get("id_terminal") != tid:
                    continue
                for side, scu_key in (("buy", "scu_buy"), ("sell", "scu_sell_stock")):
                    if r.get(f"price_{side}"):
                        out.append({"id_commodity": r["id_commodity"], "name": names.get(r["id_commodity"], r.get("commodity_name")),
                                    "side": side, "price": r[f"price_{side}"], "scu": r.get(scu_key) or r.get(f"scu_{side}"),
                                    "status": r.get(f"status_{side}"), "avg": r.get(f"price_{side}_avg"),
                                    "updated": (r.get(f"community_{side}") or {}).get("at") or r.get("date_modified"),
                                    "community": r.get(f"community_{side}")})
                for b in str(r.get("container_sizes") or "").replace(";", ",").split(","):
                    if b.strip().isdigit() and int(b) in datarunner.CONTAINER_SIZES:
                        boxes.add(int(b))
            out.sort(key=lambda x: (x["side"] != "buy", x["name"] or ""))
            version, env, running = self._dr_game_build()
            t = terms.get(tid) or {}
            return {"ok": True, "terminals": listing, "id_terminal": tid, "terminal": t.get("name"),
                    "where": uex.where(t) if t else None, "you_are_at": spot, "how": how,
                    "rows": out, "commodities": sorted(({"id": i, "name": n} for i, n in names.items()), key=lambda c: c["name"]),
                    "uex_sizes": sorted(boxes), "game_running": running, "game_version": version, "env": env,
                    "params": self._dr_params(), "status_names": datarunner.STATUS, "at": at,
                    "stats": self.dr_stats(), "cooldown": self._dr_cooldowns(tid),
                    "ack": bool(self._dr_cfg().get("ack")), "reports_count": sum(1 for e in self._dr_report_log() if not (self._dr.live and e.get("test"))), **self.dr_status()}
        return self._uex_call(run)

    def _dr_build(self, form):
        """One report: the rows in the form, with the screenshot form["shot_id"] names (UEX takes one
        screenshot per report, with only the items it shows). Checking the whole list before it's split
        up (no shot_id, several shots), any shot stands in, so "no screenshot" isn't flagged."""
        version, env, running = self._dr_game_build()
        form = dict(form, game_version=version or "")      # from Game.log only, never typed in
        terms = self._dr_terminals()
        coms = {c["id"] for c in self._uex.get("commodities")[0]}
        with self._lock:
            sh = self._dr_shot(form.get("shot_id")) or (self._dr_shots[0] if self._dr_shots and form.get("shot_id") is None else None)
        shot = datarunner.shot_b64(sh)["b64"] if sh else None
        body = datarunner.build_payload(form, shot, production=self._dr.live)
        pol = self._dr_shot_policy()
        no_shot = bool(form.get("no_screenshot")) and not body.get("screenshot") and (pol["optional"] or pol["can_try"])
        errs = datarunner.validate(body, terms, coms, need_screenshot=not no_shot, history=self._dr.history())
        if not running:
            errs.insert(0, "game_not_running")
        elif not version:
            errs.insert(0, "game_version_unknown")
        params = self._dr_params()
        if params and not params.get("accepting"):
            errs.insert(0, "service_unavailable")
        avg = {}
        for r in self._uex.get("commodities_prices_all")[0]:
            if r.get("id_terminal") == body.get("id_terminal"):
                for side in ("buy", "sell"):
                    avg[(r["id_commodity"], side)] = r.get(f"price_{side}_avg") or r.get(f"price_{side}")
        warns = datarunner.price_warnings(body, avg, params.get("price_variation"))
        return body, errs, warns, terms

    def _dr_after_send(self, body, form, t, res):
        """Bookkeeping once UEX has accepted a report. Each step on its own: the report is already at
        UEX, so a problem here must never turn into "not sent" (and a retry UEX refuses as a duplicate)."""
        import traceback
        sides = [r.get("side") for r in form.get("rows") or [] if r.get("include")]
        data = res.get("data") or {}
        for step in (lambda: res.__setitem__("refreshed_days", self._dr_count(body)),
                     lambda: self._dr_log_report(body, form, t, res),
                     lambda: res.__setitem__("community", self._community.post(
                         body, sides, report_ids(data.get("ids_reports")),
                         data.get("username") or self._dr_cfg().get("username"), data.get("date_added"),
                         test=bool(res.get("test")), display=(self._dr_cfg().get("uex_user") or {}).get("username"),
                         avatar=(self._dr_cfg().get("uex_user") or {}).get("avatar"))),
                     lambda: self._dr_drop_shot(form.get("shot_id"))):
            try:
                step()
            except Exception:
                traceback.print_exc()

    def _dr_explain_duplicate(self, body, form, t, res):
        """UEX says it already has these items from the last 5 minutes. Look up what it has from this
        datarunner at this terminal: usually an earlier click that did go through. If so, say so, and
        add it to My Reports so nothing is lost."""
        secret, user = self._dr_cfg().get("secret"), self._dr_cfg().get("username")
        if not secret:
            return
        try:
            params = {"type": "commodity", "id_terminal": body.get("id_terminal"), "limit": 20}
            if user:
                params["username"] = user
            rows = self._uex._fetch("data_info", params, headers={"secret-key": secret}, timeout=15)
        except uex.UexError:
            return
        now = time.time()
        mine = [r for r in rows if r.get("is_owner", 1) and now - (r.get("date_added") or 0) < 900]
        if not mine:
            return
        names = {}
        try:
            names = {c["id"]: c["name"] for c in self._uex.get("commodities", offline=True)[0]}
        except uex.UexError:
            pass
        mins = max(1, round((now - max(r.get("date_added") or now for r in mine)) / 60))
        items = ", ".join(sorted({names.get(r.get("id_commodity"), "#" + str(r.get("id_commodity"))) for r in mine}))
        res["errors"] = [{"code": "duplicated_report",
                          "text": f"Your report of {items} here already reached UEX {mins} min ago "
                                  f"({mine[0].get('status') or 'pending'}), so this one is a repeat. Nothing more to do: "
                                  "it's in My Reports now."}]
        res["already_sent"] = True
        known = {i for e in self._dr_report_log() for i in e.get("ids", [])}
        ids = [str(r.get("id")) for r in mine]
        if not set(ids) & known:
            fake = {"ok": True, "test": False, "data": {"ids_reports": ",".join(ids), "date_added": min(r.get("date_added") or now for r in mine),
                                                         "username": mine[0].get("username")}}
            try:
                self._dr_log_report(body, form, t, fake)
                self._dr_count(body)
                self._dr._sides = [r.get("side") for r in form.get("rows") or [] if r.get("include")]
                self._dr._remember(body, min(r.get("date_added") or now for r in mine), self._dr._sides)
            except Exception:
                pass

    def _dr_dup_text(self, body, form):
        """Which rows Quantum's own 5-minute check holds back, and for how long."""
        now, hist, names = time.time(), self._dr.history(), {}
        try:
            names = {c["id"]: c["name"] for c in self._uex.get("commodities", offline=True)[0]}
        except uex.UexError:
            pass
        sides = [r.get("side") for r in form.get("rows") or [] if r.get("include")]
        out = []
        for i, p in enumerate(body.get("prices") or []):
            side = sides[i] if i < len(sides) else "buy"
            t = hist.get(f"{body.get('id_terminal')}:{p.get('id_commodity')}:{side}")
            if t and now - t < datarunner.DUPLICATE_WINDOW:
                out.append(f"{names.get(p.get('id_commodity'), '#' + str(p.get('id_commodity')))} "
                           f"(again in {max(1, round((datarunner.DUPLICATE_WINDOW - (now - t)) / 60))} min)")
        return ("You sent " + ", ".join(out) + " from here less than 5 minutes ago. "
                "UEX takes each item once every 5 minutes; untick those rows or wait") if out else None

    def dr_check(self, form):
        """Step 6 of the UEX guide, "review one final time": everything the report would send, the
        problems UEX would refuse it for, and prices far enough off to double-check. Nothing is saved."""
        def run():
            body, errs, warns, terms = self._dr_build(form)
            t = terms.get(body.get("id_terminal")) or {}
            return {"ok": True, "live": self._dr.live, "terminal": t.get("name"), "where": uex.where(t) if t else None,
                    "prices": body.get("prices") or [], "shots": len(self._dr_shots),
                    "container_sizes": body.get("container_sizes"), "game_version": body.get("game_version"),
                    "errors": [{"code": c, "text": (self._dr_dup_text(body, form) or datarunner.message(c))
                                if c == "duplicated_report" else datarunner.message(c)} for c in errs], "warnings": warns}
        return self._uex_call(run)

    def dr_submit(self, form):
        """Save the report (test mode) or send it (live). The page reviews it with dr_check first.
        With several screenshots the page sends one report per shot: form["shot_id"] and its rows."""
        def run():
            with self._lock:
                many = len(self._dr_shots) > 1
            if many and not self._dr_shot(form.get("shot_id")):
                return {"ok": False, "status": "shot_unassigned", "errors": [
                    {"code": "shot_unassigned", "text": "Match your items to your screenshots first: UEX takes one screenshot per report"}]}
            body, errs, warns, terms = self._dr_build(form)
            if errs and self._dr.live:         # live: don't send what UEX will refuse anyway
                dup = self._dr_dup_text(body, form) if "duplicated_report" in errs else None
                return {"ok": False, "status": errs[0], "errors": [
                    {"code": c, "text": dup if c == "duplicated_report" and dup else datarunner.message(c)} for c in errs]}
            t = terms.get(body.get("id_terminal")) or {}
            res = self._dr.submit(body, self._uex.token, self._dr_cfg().get("secret", ""),
                                  f"{t.get('name') or ''} {uex.where(t) if t else ''}", errs, warns,
                                  sides=[r.get("side") for r in form.get("rows") or [] if r.get("include")])
            res["warnings"] = warns
            res["rows"] = len(body.get("prices") or [])
            if not body.get("screenshot") and not res.get("test"):     # tried without a screenshot: UEX's answer
                shot = self._dr_cfg().setdefault("shot", {})
                if res.get("ok"):
                    shot.update(optional=True, confirmed_at=int(time.time()))
                    shot.pop("required_at", None)
                elif res.get("status") == "screenshot_required":
                    shot.update(optional=False, required_at=int(time.time()))
                    res["error"] = ("UEX still needs a screenshot from you (you're in its evaluation period). "
                                    "Take one and send again; Quantum will offer to skip it again in a week.")
                self._save_settings()
                res["shot_policy"] = self._dr_shot_policy()
            if res.get("ok"):
                self._dr_after_send(body, form, t, res)
            elif res.get("status") == "duplicated_report" and not res.get("test"):
                self._dr_explain_duplicate(body, form, t, res)
            res["shot_id"] = form.get("shot_id")
            res["stats"] = self.dr_stats()
            return res
        return self._uex_call(run)

    def _dr_count(self, body):
        """A sent report into the stats: this session's and all-time (test reports kept apart).
        Also how stale the data it replaced was, which is the fun number."""
        now, tid = time.time(), body.get("id_terminal")
        ages = {}
        try:
            for r in self._uex.get("commodities_prices_all", offline=True)[0]:
                if r.get("id_terminal") == tid and r.get("date_modified"):
                    ages[r["id_commodity"]] = max(0.0, (now - r["date_modified"]) / 86400)
        except uex.UexError:
            pass
        days = sum(ages.get(p.get("id_commodity"), 0) for p in body.get("prices") or [])
        n = len(body.get("prices") or [])
        ses = self._dr_session
        ses["reports"] += 1
        ses["prices"] += n
        ses["days"] += days
        if tid not in ses["terminals"]:
            ses["terminals"].append(tid)
        key = "stats_test" if not self._dr.live else "stats"
        all_ = self._dr_cfg().setdefault(key, {"reports": 0, "prices": 0, "days": 0.0, "terminals": []})
        all_["reports"] += 1
        all_["prices"] += n
        all_["days"] = round(all_["days"] + days, 1)
        if tid not in all_["terminals"]:
            all_["terminals"].append(tid)
        all_["last"] = now
        self._save_settings()
        return round(days, 1)

    def dr_stats(self):
        ses = self._dr_session
        all_ = self._dr_cfg().get("stats_test" if not self._dr.live else "stats") or {}
        return {"session": {"reports": ses["reports"], "prices": ses["prices"], "terminals": len(ses["terminals"]),
                            "days": round(ses["days"], 1)},
                "all": {"reports": all_.get("reports", 0), "prices": all_.get("prices", 0),
                        "terminals": len(all_.get("terminals", [])), "days": all_.get("days", 0)},
                "test": not self._dr.live, "rating": self._dr_cfg().get("rating")}

    def _dr_cooldowns(self, tid):
        """Rows sent from here in the last 5 minutes, which UEX won't take again yet: {"id:side": seconds left}."""
        now, out = time.time(), {}
        for k, t in self._dr.history().items():
            t_id, cid, side = k.split(":")
            left = datarunner.DUPLICATE_WINDOW - (now - t)
            if str(t_id) == str(tid) and left > 0:
                out[f"{cid}:{side}"] = int(left)
        return out

    # ---- the datarunner's own reports and what UEX did with them
    REPORT_STATUS = ("pending", "under_review", "queued", "approved", "consolidated", "declined", "expired")

    def _dr_report_log(self):
        try:
            log = json.loads((HERE / "datarunner_reports.json").read_text(encoding="utf-8"))
        except Exception:
            return []
        for e in log:
            e["ids"] = report_ids(",".join(map(str, e.get("ids") or [])))
        return log

    def _dr_log_report(self, body, form, term, res):
        """Every report sent (or saved in test mode), newest first, so the "My reports" view can follow
        it through UEX's review. UEX returns its report IDs; their status comes from /data_info."""
        names = {}
        try:
            names = {c["id"]: c["name"] for c in self._uex.get("commodities", offline=True)[0]}
        except uex.UexError:
            pass
        data = res.get("data") or {}
        ids = report_ids(data.get("ids_reports")) if not res.get("test") else []
        sides = [r.get("side") for r in form.get("rows") or [] if r.get("include")]
        rows = []
        for i, p in enumerate(body.get("prices") or []):
            side = sides[i] if i < len(sides) else "buy"
            rows.append({"id_commodity": p.get("id_commodity"), "name": names.get(p.get("id_commodity")), "side": side,
                         "price": p.get(f"price_{side}"), "scu": p.get(f"scu_{side}"), "status": p.get(f"status_{side}"),
                         "missing": bool(p.get("is_missing"))})
        entry = {"at": int(data.get("date_added") or time.time()), "test": bool(res.get("test")), "ids": ids,
                 "username": data.get("username"), "id_terminal": body.get("id_terminal"), "terminal": term.get("name"),
                 "where": uex.where(term) if term else None, "rows": rows}
        try:
            entry["shot"] = self._dr_keep_shot(body.get("screenshot"))
        except Exception:                                  # keeping a copy is a nicety: never stop the log for it
            watcher_mod.log_error("keep report screenshot")
        log = [entry] + self._dr_report_log()
        try:
            (HERE / "datarunner_reports.json").write_text(json.dumps(log[:300], indent=1), encoding="utf-8")
        except OSError:
            pass
        if data.get("username"):
            self._dr_cfg()["username"] = data["username"]
            self._save_settings()

    # The screenshot each report went to UEX with, kept on this PC for SHOT_KEEP_DAYS so My Reports can
    # show what was sent next to UEX's decision. UEX's API doesn't hand its own copy back.
    SHOT_KEEP_DAYS = 14
    _SHOT_NAME = re.compile(r"\d+-[0-9a-f]{8}\.(jpg|png)")

    def _dr_shots_dir(self):
        return HERE / "report_screenshots"

    def _dr_keep_shot(self, b64):
        ext = "jpg" if (b64 or "").startswith("/9j/") else "png" if (b64 or "").startswith("iVBOR") else None
        if not ext:
            return None
        d = self._dr_shots_dir()
        d.mkdir(exist_ok=True)
        name = f"{int(time.time())}-{secrets.token_hex(4)}.{ext}"
        (d / name).write_bytes(base64.b64decode(b64))
        self._dr_prune_shots()
        return name

    def _dr_prune_shots(self):
        """Screenshots older than SHOT_KEEP_DAYS are deleted."""
        cut = time.time() - self.SHOT_KEEP_DAYS * 86400
        try:
            for p in self._dr_shots_dir().iterdir():
                if p.is_file() and self._SHOT_NAME.fullmatch(p.name) and p.stat().st_mtime < cut:
                    p.unlink(missing_ok=True)
        except OSError:
            pass

    def _dr_shot_ok(self, name):
        return bool(name and self._SHOT_NAME.fullmatch(str(name)) and (self._dr_shots_dir() / name).is_file())

    def dr_report_shot(self, name):
        """The screenshot a report was sent with, as a data URL, while it's kept."""
        name = str(name or "")
        if not self._dr_shot_ok(name):
            return {"ok": False, "error": f"That screenshot isn't kept any more (they're deleted after {self.SHOT_KEEP_DAYS} days)"}
        raw = (self._dr_shots_dir() / name).read_bytes()
        mime = "jpeg" if name.endswith(".jpg") else "png"
        return {"ok": True, "src": f"data:image/{mime};base64," + base64.b64encode(raw).decode("ascii")}

    def dr_reports(self, refresh=False):
        try:
            return self._dr_reports(refresh)
        except Exception as e:
            import traceback
            traceback.print_exc()                        # shows in the console window, for troubleshooting
            return {"ok": False, "error": f"{type(e).__name__}: {e}", "reports": [], "summary": {}}

    def _dr_reports(self, refresh=False):
        """The "My reports" view: what was sent, and each report's state at UEX (pending, under review,
        approved, live, declined, expired). Test reports were never sent, so they have none."""
        self._dr_prune_shots()
        log = self._dr_report_log()
        if self._dr.live:                                  # test reports were never sent: not in the live list
            log = [e for e in log if not e.get("test")]
        secret, user = self._dr_cfg().get("secret"), self._dr_cfg().get("username")
        # Reports this PC doesn't know about (a reinstall, another PC) come back from the server.
        prof = self._community.profile(user) if user else None
        if prof and prof.get("history"):
            known = {i for e in log for i in e.get("ids", [])}
            try:
                terms, names = self._uex.terminals(), {c["id"]: c["name"] for c in self._uex.get("commodities", offline=True)[0]}
            except uex.UexError:
                terms, names = {}, {}
            for h in prof["history"]:
                if h.get("test") or set(h.get("ids", [])) & known:
                    continue
                t = terms.get(h["id_terminal"]) or {}
                log.append({"at": h["at"], "test": False, "ids": h["ids"], "username": user, "id_terminal": h["id_terminal"],
                            "terminal": t.get("name"), "where": uex.where(t) if t else None, "from_server": True,
                            "rows": [dict(r, name=names.get(r["id_commodity"])) for r in h["rows"]]})
            log.sort(key=lambda e: -e.get("at", 0))
        # Only reports still waiting on UEX are looked up: ones UEX has decided are kept as they are,
        # and after 14 days without a decision Quantum stops asking (see FOLLOW_FOR).
        now = time.time()
        done = lambda e: e.get("final") and all(s in self.FINAL for s in e.get("states") or ["?"])
        waiting = [e for e in log if not e.get("test") and e.get("ids") and not done(e)
                   and now - e.get("at", 0) <= self.FOLLOW_FOR]
        found, error, asked = {}, None, False
        if waiting and secret and self._uex.token:
            cache = getattr(self, "_dr_info_cache", None)
            if cache and time.time() - cache[0] < (60 if refresh else 300):   # gentle on UEX: 5 min, Refresh 1 min
                found = cache[1]
            else:
                try:
                    params = {"type": "commodity", "limit": 100}
                    if user:
                        params["username"] = user
                    for r in self._uex._fetch("data_info", params, headers={"secret-key": secret}, timeout=15):
                        if r.get("is_owner", 1):
                            found.setdefault(str(r.get("id")), []).append(r)
                    self._dr_info_cache = (time.time(), found)
                    asked = True
                except uex.UexError as e:
                    error = str(e)
        self._dr_backfill(log, prof)
        out, changed = [], False
        for e in log:
            rows = [dict(r) for r in e.get("rows", [])]
            states = []
            if e.get("final") or (not e.get("test") and now - e.get("at", 0) > self.FOLLOW_FOR):
                # decided earlier, or no longer followed: show what UEX last said
                states = list(e.get("states") or [])
                for row in rows:
                    row.setdefault("uex", (e.get("row_states") or {}).get(str(row["id_commodity"])))
                    row.setdefault("reason", (e.get("row_reasons") or {}).get(str(row["id_commodity"])))
                    row.setdefault("uex_id", (e.get("row_ids") or {}).get(str(row["id_commodity"])))
                out.append(self._dr_out(e, rows, states, now))
                continue
            if not e.get("test"):
                for rid in e.get("ids", []):
                    for r in found.get(rid, []):
                        if abs((r.get("date_added") or e["at"]) - e["at"]) > 86400:
                            continue                       # the same ID in another partition of UEX's table
                        states.append(r.get("status"))
                        for row in rows:
                            if row["id_commodity"] == r.get("id_commodity") and "uex" not in row:
                                row["uex"] = r.get("status")
                                row["uex_id"] = rid
                                row["checked"] = r.get("date_checked")
                                if r.get("status") in ("declined", "expired") or r.get("is_contested"):
                                    row["reason"] = uex.decline_reason(r)
                                break
            if not states and e.get("states"):
                states = list(e["states"])                 # nothing new from UEX this time: keep what it said
                for row in rows:
                    row.setdefault("uex", (e.get("row_states") or {}).get(str(row["id_commodity"])))
                    row.setdefault("reason", (e.get("row_reasons") or {}).get(str(row["id_commodity"])))
                    row.setdefault("uex_id", (e.get("row_ids") or {}).get(str(row["id_commodity"])))
            elif states and states != e.get("states"):
                e["states"], changed = states, True
                e["row_states"] = {str(r["id_commodity"]): r.get("uex") for r in rows if r.get("uex")}
                e["row_ids"] = {str(r["id_commodity"]): r["uex_id"] for r in rows if r.get("uex_id")}
                e["row_reasons"] = {str(r["id_commodity"]): r["reason"] for r in rows if r.get("reason")}
                if all(st in self.FINAL for st in states):
                    e["final"] = True                          # UEX is done with it: never asked about again
            out.append(self._dr_out(e, rows, states, now))
        if changed:
            self._dr_save_states(log)
        counted = [s for e in out for s in e["states"] if not e.get("no_decision")]

        summary = {k: counted.count(k) for k in self.REPORT_STATUS if counted.count(k)}
        decided = sum(summary.get(k, 0) for k in ("approved", "consolidated", "declined"))
        ok = summary.get("approved", 0) + summary.get("consolidated", 0)
        return {"ok": True, "reports": out, "summary": summary, "approval": round(ok / decided * 100) if decided else None,

                "error": error, "can_check": bool(secret and self._uex.token), "live": self._dr.live,
                "asked": asked, "waiting": len(waiting),
                "checked_ago": time.time() - getattr(self, "_dr_info_cache", (time.time(),))[0]}

    def _dr_out(self, e, rows, states, now):
        """One report for My Reports: each row with its own UEX report number where known, and whether
        the screenshot it was sent with is still kept on this PC."""
        if e.get("from_server") and len(e.get("ids") or []) == len(rows):
            for row, rid in zip(rows, e["ids"]):            # the server lists them in the same order
                row.setdefault("uex_id", rid)
        for row in rows:
            row["uex_url"] = self._uex_price_url(row.get("id_commodity"), e.get("id_terminal"), row.get("side"))
        return dict(e, rows=rows, states=states, no_decision=self._dr_no_decision(e, states, now),
                    shot=e.get("shot") if self._dr_shot_ok(e.get("shot")) else None)

    def _uex_price_url(self, id_commodity, id_terminal, side):
        """UEX's page for one commodity's price at one terminal (where a report shows up once it's live).
        UEX's API has no page for a single report. side "buy": you bought, so the terminal sells it."""
        if not id_commodity or not id_terminal:
            return None
        slugs = getattr(self, "_com_slugs", None)
        if slugs is None or time.time() - slugs[0] > 3600:
            try:
                rows = self._uex.get("commodities", offline=True)[0]
            except uex.UexError:
                rows = []
            slugs = self._com_slugs = (time.time(), {c["id"]: c.get("slug") or re.sub(r"[^a-z0-9]+", "-", str(c.get("name") or "").lower()).strip("-")
                                                     for c in rows if c.get("id")})
        slug = slugs[1].get(id_commodity)
        if not slug:
            return None
        tab = "locations_selling" if side == "buy" else "locations_buying"
        return (f"https://uexcorp.space/commodities/info/name/{urllib.parse.quote(slug)}/tab/{tab}/"
                f"id_terminal/{int(id_terminal)}/highlight/price_last/")

    def demo_config(self):
        return dict(DEMO)

    def demo_perf_log(self, text):
        """The demo's timing log (slow frames and what was going on), written next to the app as demo_perf.log
        so it can be sent in after a recording that stuttered. Replaced each run."""
        try:
            (HERE / "demo_perf.log").write_text(str(text)[:2_000_000], encoding="utf-8")
            return {"ok": True, "path": str(HERE / "demo_perf.log")}
        except OSError as e:
            return {"ok": False, "error": str(e)}

    def demo_snapshot(self):
        import copy
        with self._lock:
            self._demo_saved = {"route": copy.deepcopy(self._route), "guide": self._guide}
            self._route, self._guide = [], None
        return {"ok": True}

    def demo_restore(self):
        saved = getattr(self, "_demo_saved", None)
        if not saved:
            return {"ok": False}
        with self._lock:
            self._route = [t for t in saved["route"] if t.get("place") in self._db.locations]
            self._guide = saved["guide"] if saved["guide"] in self._db.locations else None
            self._demo_saved = None
        self._save_settings()
        return {"ok": True}

    def community_status(self):
        """The Quantum API server: whether community features are on, and whether it answers."""
        return {"url": self._community.url, "enabled": bool(self._community.url), **self._community.health()}

    def set_community_enabled(self, on):
        """Turn the community features (the Quantum API) on or off from Settings, in place of editing
        "community_url" in settings.json. Off: Quantum uses UEX's data alone. A server address you set
        yourself is kept and comes back when you turn them on again."""
        cur = self._settings.get("community_url")
        if on:
            back = self._settings.pop("community_url_was", None)
            if back and str(back).lower() != "off":
                self._settings["community_url"] = back
            else:
                self._settings.pop("community_url", None)         # the built-in server
        else:
            if cur and str(cur).lower() != "off":
                self._settings["community_url_was"] = cur
            self._settings["community_url"] = "off"
        self._save_settings()
        try:
            self._community.prices(fresh=True)
        except Exception:
            pass
        self._owner_at = None
        if on:
            self._sign_in_soon()
        return self.community_status()

    def uex_key_status(self):
        """Whether the UEX Secret Key works: the UEX name it belongs to (asked of UEX, cached)."""
        cfg = self._dr_cfg()
        if not cfg.get("secret"):
            return {"has_secret": False, "ok": False}
        if not self._uex.token:
            return {"has_secret": True, "ok": False, "error": "Add your UEX Bearer Token too"}
        u = self._dr_uex_user() or {}
        if not u.get("username"):
            return {"has_secret": True, "ok": False, "error": "UEX didn't accept this key, or can't be reached"}
        return {"has_secret": True, "ok": True, "username": u["username"],
                "datarunner": bool(u.get("is_datarunner")), "signed_in": bool(self._session_token())}

    # By approved reports, one per item (each price row, picture, station position, planet alignment):
    # the same table as the server, whose own copy wins when it can be reached.
    RANKS = [(0, "Unranked"), (1, "Trainee"), (50, "Runner"), (250, "Field Analyst"),
             (750, "Trade Analyst"), (2000, "Quantum Analyst")]

    def _dr_rank(self, n):
        name, nxt = self.RANKS[0][1], None
        for i, (at, nm) in enumerate(self.RANKS):
            if n >= at:
                name, nxt = nm, (self.RANKS[i + 1] if i + 1 < len(self.RANKS) else None)
        return {"name": name, "count": n, "next": {"name": nxt[1], "at": nxt[0]} if nxt else None}

    def _dr_rating(self, states):
        """Star rating from what UEX decided: each approved row counts 5 stars, each declined one 1,
        averaged. Nothing decided yet: no rating (0 stars). Same formula as the server; this local
        one is only used when the server can't be reached."""
        good = sum(1 for s in states if s in ("approved", "consolidated"))
        bad = sum(1 for s in states if s == "declined")
        return {"stars": round((5 * good + bad) / (good + bad), 2) if good + bad else 0, "rated": good + bad > 0,
                "approved": good, "declined": bad}

    def _dr_uex_user(self, refresh=False):
        """The datarunner's UEX username and avatar, from UEX's /user (needs the secret key).
        Cached for 6 hours."""
        cfg = self._dr_cfg()
        cached = cfg.get("uex_user")
        if cached and not refresh and time.time() - cached.get("at", 0) < (6 * 3600 if cached.get("avatar") else 600):
            return cached
        if not (cfg.get("secret") and self._uex.token):
            return cached
        try:
            rows = self._uex._fetch("user", {}, headers={"secret-key": cfg["secret"]}, timeout=10)
            u = rows[0] if rows else {}
        except uex.UexError:
            return cached
        if u.get("username"):
            cached = {"username": u["username"], "name": u.get("name"), "avatar": u.get("avatar"), "at": int(time.time()),
                      "is_datarunner": u.get("is_datarunner"), "is_datarunner_banned": u.get("is_datarunner_banned")}
            cfg["uex_user"], cfg["username"] = cached, u["username"]
            self._save_settings()
        return cached

    @staticmethod
    def _dr_avatar_urls(raw):
        raw = str(raw).strip()
        if raw.startswith("//"):
            return ["https:" + raw]
        if raw.startswith(("http://", "https://", "data:")):
            return [raw]
        path = raw.lstrip("/")
        return [f"https://{host}/{path}" for host in ("edge.uexcorp.space", "assets.uexcorp.space", "uexcorp.space")]

    def _dr_avatar(self, raw):
        """The UEX avatar as a data: URL. Downloaded here rather than linked from the page: UEX may
        hand back a path rather than a full address, and its image servers may not serve pictures
        to other sites. Kept on disk, so it's fetched once per avatar."""
        if not raw:
            return None
        import base64
        import hashlib
        raw = str(raw).strip()
        if raw.startswith("data:"):
            return raw
        tries = self._dr_avatar_urls(raw)
        cache = HERE / "uex_cache" / f"avatar_{hashlib.sha1(raw.encode()).hexdigest()[:12]}"
        if raw in getattr(self, "_avatar_direct", set()):
            return None                        # the page loads this one straight from UEX (see below)
        try:
            kind, data = cache.read_text(encoding="utf-8").split("\n", 1)
            return f"data:{kind};base64,{data}"
        except Exception:
            pass
        for url in tries:
            try:
                req = urllib.request.Request(url, headers={"User-Agent": "Mozilla/5.0 Quantum", "Referer": "https://uexcorp.space/",
                                                           "Accept": "image/*"})
                with urllib.request.urlopen(req, timeout=8) as r:
                    kind = (r.headers.get("Content-Type") or "").split(";")[0].strip()
                    body = r.read(3_000_000)
                if not kind.startswith("image/") or not body:
                    continue
                data = base64.b64encode(body).decode("ascii")
                try:
                    cache.parent.mkdir(parents=True, exist_ok=True)
                    cache.write_text(f"{kind}\n{data}", encoding="utf-8")
                except OSError:
                    pass
                return f"data:{kind};base64,{data}"
            except Exception:
                continue
        # UEX's image CDN only serves browsers, which is normal; the page then loads it directly.
        # Remember that so it isn't tried (and reported) on every visit.
        if not hasattr(self, "_avatar_direct"):
            self._avatar_direct = set()
        self._avatar_direct.add(raw)
        return None

    def _dr_share_user(self, user):
        """Send the server your UEX avatar and name when they change (or once a day), so other
        datarunners see your picture on the Top 10. Only what UEX's /user said, nothing else."""
        if not user or not user.get("username"):
            return
        cfg = self._dr_cfg()
        key = [user["username"], user.get("avatar")]
        sent = cfg.get("user_shared") or {}
        if sent.get("key") == key and time.time() - sent.get("at", 0) < 86400:
            return
        if self._community.update_user(user["username"], user["username"], user.get("avatar")):
            cfg["user_shared"] = {"key": key, "at": int(time.time())}
            self._save_settings()

    def dr_leaderboard(self):
        """Top 10 Quantum datarunners from the community server, with their UEX avatars."""
        if not self._community.url:
            return {"ok": False, "error": "Community features are off, so there's no leaderboard"}
        user = self._dr_uex_user() or {}
        me = (user.get("username") or self._dr_cfg().get("username") or "").strip()
        self._dr_share_user(user)
        r = self._community.leaderboard(me or None)
        if not r:
            return {"ok": False, "error": "The Quantum server couldn't be reached. Try again in a minute"}
        rows = list(r.get("top") or []) + ([r["me"]] if r.get("me") else [])
        from concurrent.futures import ThreadPoolExecutor

        def pic(x):
            raw = x.get("avatar")
            if me and x.get("username", "").lower() == me.lower() and user.get("avatar"):
                raw = user["avatar"]                           # yours: straight from UEX, always current
            # Downloaded here when UEX allows it; its image CDN often only serves browsers, so the
            # page also gets the direct link and loads it itself (like the My Reports card does).
            x["avatar_url"] = self._dr_avatar_urls(raw)[0] if raw else None
            try:
                x["avatar"] = self._dr_avatar(raw) if raw else None
            except Exception:
                x["avatar"] = None
        with ThreadPoolExecutor(max_workers=6) as ex:
            list(ex.map(pic, rows))
        return {"ok": True, "top": r.get("top") or [], "me": r.get("me"), "total": r.get("total", 0),
                "you": me.lower() or None, "at": time.time()}

    def dr_profile(self, refresh=False):
        try:
            return self._dr_profile(refresh)
        except Exception as e:
            import traceback
            traceback.print_exc()
            return {"ok": False, "error": f"{type(e).__name__}: {e}"}

    FOLLOW_FOR = 14 * 86400                # stop asking UEX about a report after this long
    DECIDED = ("approved", "consolidated", "declined", "expired")
    # Nothing more will happen to these. "approved" isn't one: UEX approves a row first and merges it
    # into its data (consolidated, "Live on UEX") a little later, so approved reports are still followed.
    FINAL = ("consolidated", "declined", "expired")

    def _dr_no_decision(self, e, states, now):
        """Sent more than 14 days ago and UEX never decided: shown as such, left out of the counts."""
        return (not e.get("test") and bool(e.get("ids")) and now - e.get("at", 0) > self.FOLLOW_FOR
                and not all(s in self.DECIDED for s in states or ["?"]))

    def _dr_save_states(self, log):
        """Keep UEX's latest answer for each report in the log, so decided reports aren't asked about
        again and a report keeps its last known status once Quantum stops following it."""
        full = self._dr_report_log()
        by = {(tuple(e.get("ids") or []), e.get("at")): e for e in log}
        for e in full:
            got = by.get((tuple(e.get("ids") or []), e.get("at")))
            if got:
                for k in ("states", "row_states", "row_reasons", "row_ids", "final"):
                    if k in got:
                        e[k] = got[k]
        try:
            (HERE / "datarunner_reports.json").write_text(json.dumps(full[:300], indent=1), encoding="utf-8")
        except OSError:
            pass

    def _dr_backfill(self, log, prof):
        """Send the community server any recent live report it doesn't have yet (a send that failed,
        or one from before it existed). The server checks each against UEX as usual."""
        if not self._community.url:
            return
        have = {i for h in (prof or {}).get("history", []) for i in h.get("ids", [])}
        for e in log:
            if e.get("test") or not e.get("ids") or e.get("shared") or set(e["ids"]) & have:
                continue
            if time.time() - e.get("at", 0) > 6 * 86400:
                continue
            body = {"id_terminal": e.get("id_terminal"), "prices": []}
            for r in e.get("rows", []):
                p = {"id_commodity": r["id_commodity"]}
                if r.get("missing"):
                    p["is_missing"] = 1
                else:
                    p.update({f"price_{r['side']}": r.get("price"), f"scu_{r['side']}": r.get("scu"),
                              f"status_{r['side']}": r.get("status")})
                body["prices"].append(p)
            got = self._community.post(body, [r.get("side") for r in e.get("rows", [])], e["ids"],
                                       e.get("username") or self._dr_cfg().get("username"), e.get("at"), test=False,
                                       display=(self._dr_cfg().get("uex_user") or {}).get("username"),
                                       avatar=(self._dr_cfg().get("uex_user") or {}).get("avatar"))
            if got and got.get("ok"):
                self._dr_mark_shared(e)

    def _dr_mark_shared(self, entry):
        full = self._dr_report_log()
        for e in full:
            if e.get("ids") == entry.get("ids") and e.get("at") == entry.get("at"):
                e["shared"] = True
        try:
            (HERE / "datarunner_reports.json").write_text(json.dumps(full[:300], indent=1), encoding="utf-8")
        except OSError:
            pass

    def _dr_profile(self, refresh=False):
        """The My Reports header: who you are at UEX, your rank and star rating. The server keeps it
        (so it survives a reinstall); without the server it's worked out from this PC's report log."""
        user = self._dr_uex_user(refresh) or {}
        name = user.get("username") or self._dr_cfg().get("username")
        threading.Thread(target=self._dr_share_user, args=(user,), daemon=True).start()
        prof = self._community.profile(name) if name else None
        if prof:
            out = dict(prof, source="server")
            if prof.get("first_seen") and prof["first_seen"] != self._dr_cfg().get("first_seen"):
                self._dr_cfg()["first_seen"] = prof["first_seen"]       # for the 90-day screenshot rule
                self._save_settings()
            for c in out.get("contrib") or []:                 # pictures: a full link to the server's copy
                if isinstance(c.get("url"), str) and c["url"].startswith("/"):
                    c["url"] = self._community.url + c["url"]
            local_sent = sum(1 for e in self._dr_report_log() if not e.get("test") and e.get("ids"))
            out["reports"] = max(out.get("reports") or 0, local_sent)
        else:
            reps = self._dr_reports()
            states = [s for e in reps["reports"] if not e.get("test") for s in e["states"]]
            r = self._dr_rating(states)
            accepted = r["approved"]                       # one per approved price row, like the server
            out = {"username": name, "stars": r["stars"], "rated": r["rated"], "accepted": accepted,
                   "reports": sum(len(e.get("rows") or []) for e in reps["reports"] if not e.get("test")),
                   "rows": {"approved": r["approved"], "declined": r["declined"]}, "rank": self._dr_rank(accepted),
                   "decided": {"approved": r["approved"], "rejected": r["declined"]},
                   "banned": False, "source": "local"}
        raw = user.get("avatar") or out.get("avatar")
        out.update(ok=True, name=user.get("name"), avatar=self._dr_avatar(raw), avatar_url=self._dr_avatar_urls(raw)[0] if raw else None,
                   avatar_raw=raw, uex_datarunner=user.get("is_datarunner"), uex_banned=user.get("is_datarunner_banned"),
                   has_secret=bool(self._dr_cfg().get("secret")), test=not self._dr.live,
                   ranks=[tuple(x) for x in out.get("ranks") or self.RANKS])
        self._dr_cfg()["rating"] = {"stars": out["stars"], "rated": out["rated"], "rank": out["rank"]["name"]}
        self._save_settings()
        return out

    def _align_target(self, body):
        """For a /showlocation on `body`: the known place you're at, from what the log says (where you
        landed or docked) or else from the reading's latitude and height, which don't depend on the
        planet's rotation. -> (place, mode, lat_tol, alt_tol) or (None, why)."""
        w = self._tracker.where or {}
        anchor_name = self._tracker.place_for_code(w["code"]) if w.get("code") and \
            abs((w.get("at") or 0) - (self._player_t or 0)) < 1800 else None
        anchor = self._db.locations.get(anchor_name) if anchor_name else None
        if anchor is not None and anchor.kind == "surface" and anchor.body == body.name:
            kind = classify(anchor.name, anchor.category)
            if kind == "city" or "spaceport" in anchor.name.lower():
                city = next((c for c in CITY_ANCHOR if c.lower() in anchor.name.lower()
                             or anchor.name == CITY_ANCHOR[c]), None)
                return self._db.locations.get(CITY_ANCHOR.get(city, ""), anchor), "hangar", 0.5, 6_000
            return anchor, "place", 0.3, 15_000
        lat_p, _, alt_p = body.lat_lon_alt(body.to_local(self._player, self._player_t))
        matches = []
        for loc in self._db.locations.values():
            if loc.source != "db" or loc.kind != "surface" or loc.body != body.name or loc.pos is None:
                continue
            lat, _, alt = body.lat_lon_alt(loc.pos)
            score = max(abs(lat - lat_p) / 0.02, abs(alt - alt_p) / (3_000 if alt > 20_000 else 600))
            if score < 1.0:
                matches.append((score, loc))
        if not matches:
            return None, (f"Your reading isn't at any place Quantum knows on {body.name}. Land at an outpost, "
                          "city or landing zone that's on the map, then take another /showlocation")
        matches.sort(key=lambda m: m[0])
        if any(dist(m[1].pos, matches[0][1].pos) > 5_000 for m in matches[1:]):
            names = ", ".join(sorted({m[1].name for m in matches[:4]}))
            return None, (f"That reading fits more than one place ({names}). Open the card of the place you're "
                          "at on the map and use \"I'm here: calibrate\", or land somewhere else")
        return matches[0][1], "place", 0.3, 15_000

    def dr_align_reading(self, body_name, arrived_ms=0):
        """Planet alignment job, steps 3 and 4: a /showlocation taken on that planet or moon after you
        pressed "I've arrived", and the place it's at. -> {ok, place, age} or {ok: False, why}."""
        with self._lock:
            body = self._db.bodies.get(body_name)
            if not body:
                return {"ok": False, "why": "unknown"}
            if not self._player or not self._player_t:
                return {"ok": False, "why": "none"}
            age = time.time() - self._player_t
            if (arrived_ms and self._player_t * 1000 < arrived_ms - 2000) or age > 900:
                return {"ok": False, "why": "old"}
            if self._player_sys != body.system:
                return {"ok": False, "why": f"That reading is in {self._player_sys}, not {body.system}."}
            near = self._db.body_near(self._player, self._player_sys)
            if near is not body:
                return {"ok": False, "why": f"That reading isn't on {body.name}"
                                            f"{f' (it is near {near.name})' if near else ''}. Take it once you've landed there."}
            lat, _, alt = body.lat_lon_alt(body.to_local(self._player, self._player_t))
            if alt > 3_000:
                return {"ok": False, "why": f"You're {alt / 1000:.1f} km up. Land first, then take the /showlocation."}
            tgt = self._align_target(body)
            if tgt[0] is None:
                return {"ok": False, "why": tgt[1]}
            return {"ok": True, "place": tgt[0].name, "age": age}

    def dr_align_submit(self, body_name, arrived_ms=0):
        """Planet alignment job, step 5: line the planet up from your reading and send it, even if it was
        lined up before (an earlier version, or by the community): this is the alignment for this build."""
        with self._lock:
            chk = self.dr_align_reading(body_name, arrived_ms)
            if not chk.get("ok"):
                why = chk.get("why")
                return {"ok": False, "error": {"none": "Type /showlocation in game first", "old": "Take a new /showlocation: "
                        "the last one is from before you arrived"}.get(why, why)}
            if not self._tracker.build:
                return {"ok": False, "error": "Quantum hasn't read the game version from Game.log yet. Give it a moment and try again"}
            body = self._db.bodies[body_name]
            target, mode, lat_tol, alt_tol = self._align_target(body)
            res = self._db.auto_calibrate(body.name, target, self._player, self._player_t, lat_tol, alt_tol, mode)
            if not res.get("ok"):
                return {"ok": False, "error": f"Your reading doesn't line up with {target.name} (latitude or height is off). "
                                              "Stand at the place itself and take another /showlocation"}
            self._record_cal("manual", body.name, target.name, res["correction"])
            self._calibration = {"body": body.name, "place": target.name, "correction": res["correction"],
                                 "at": time.time(), "quality": mode}
            self._settings["last_calibration"] = self._calibration
            self._static_version += 1
            self._save_settings()
            user = self._dr_cfg().get("username") or (self._dr_cfg().get("uex_user") or {}).get("username")
            return {"ok": True, "place": target.name, "correction": res["correction"], "shared": bool(user and self._community.url),
                    "note": None if user else "Saved on your map. Add your UEX Secret Key in Settings so alignments are shared"}

    def dr_align_jobs(self):
        """Planet alignment jobs: every planet and moon you can land on, for this game build: agreed (live for
        everyone), waiting for a second alignment, aligned by you, or still to do."""
        build = self._game_build()
        if not build:
            return {"ok": False, "error": "Start Star Citizen once so Quantum can read the game version from Game.log"}
        r = self._community.alignments(build)
        if r is None:
            r = {"agreed": {}, "waiting": {}}
            offline = True
        else:
            offline = False
            self._align_server = dict(r, build=build, at=time.time())
        hist = [e for e in self._cal_file().get("history", []) if str(e.get("build")) == build
                and (str(e.get("kind", "")).startswith("auto-") or e.get("kind") == "manual")]
        mine = {e["body"]: e for e in hist}
        places = {}
        for L in self._db.locations.values():
            if L.kind == "surface" and L.source == "db" and L.body:
                places.setdefault(L.body, []).append(L.name)
        jobs = []
        for b in sorted(self._db.bodies.values(), key=lambda b: (b.system, b.kind != "planet", b.name)):
            if not can_align(b):
                continue
            a = r["agreed"].get(b.name)
            st = "live" if a else "mine" if b.name in mine else "waiting" if r["waiting"].get(b.name) else "open"
            pl = sorted(places.get(b.name, []))
            jobs.append({"body": b.name, "system": b.system, "kind": b.kind, "status": st,
                         "others": r["waiting"].get(b.name, 0) - (1 if b.name in mine else 0),
                         "reporters": a["reporters"] if a else None, "mine_at": mine[b.name]["reading_utc"] if b.name in mine else None,
                         "places": pl[:4], "place_count": len(pl), "you_here": self._player_sys == b.system and bool(
                             self._player and self._db.body_near(self._player, b.system) is b)})
        return {"ok": True, "build": build, "version": self._game_version_label(build), "jobs": jobs, "offline": offline, "you_in": self._player_sys,
                "systems": sorted({j["system"] for j in jobs})}

    def dr_photo_jobs(self, refresh=False):
        """Picture jobs: ships and vehicles, components and commodities that have no picture yet (none on
        the Star Citizen Wiki, none approved on Quantum). Worked out at most every 10 minutes."""
        c = getattr(self, "_photo_jobs", None)
        if c and not refresh and time.time() - c[0] < 600:
            return c[1]

        def run():
            mine = self._community.photos() or {}
            jobs = []
            vehicles, _ = self._uex.get("vehicles")
            for v in vehicles:
                if is_concept(v) or v.get("is_addon") or v.get("url_photo"):
                    continue
                name = v.get("name_full") or v.get("name")
                if name and self._pic_key(name) not in mine:
                    jobs.append({"kind": "vehicle", "name": name, "label": name, "title": name,
                                 "group": "Ship" if not v.get("is_ground_vehicle") else "Ground vehicle"})
            refs = []
            rows, _ = self._uex.get("commodities")
            for co in rows:
                if co.get("is_available_live", 1) and (co.get("is_buyable") or co.get("is_sellable")):
                    refs.append(("commodity", co.get("wiki") or co.get("name"), co.get("name"), co.get("kind") or "Commodity"))
            cats = self.uex_component_categories()
            for cat in (cats.get("items") or []) if cats.get("ok") else []:
                if str(cat["id"]).startswith("wiki:"):
                    # A kind only the wiki has (mining lasers, flight blades): its parts are the wiki's own
                    # pages, so a picture job is for one whose page has no picture
                    wtype = str(cat["id"])[5:]
                    test = next((t for _, w, t in self.WIKI_KINDS if w == wtype), None)
                    for w in self._wiki_parts(wtype, test):
                        if not w.get("image"):
                            refs.append(("component", w.get("wiki") or w["name"], w["name"], cat.get("name") or "Component"))
                    continue
                try:
                    items, _ = self._uex.get("items", {"id_category": int(cat["id"])})
                except (uex.UexError, ValueError, TypeError):
                    continue
                for i in items:
                    if not i.get("is_commodity") and i.get("name"):
                        refs.append(("component", i.get("wiki") or i.get("name"), i.get("name"), cat.get("name") or "Component"))
            pics = self._wikiapi.pictures([r[1] for r in refs])
            seen = set()
            for kind, ref, label, group in refs:
                key = (kind, self._pic_key(ref))
                if key in seen or pics.get(ref) or self._pic_key(ref) in mine:
                    continue
                seen.add(key)
                # title: the name the server keeps the picture under (and the job's claim is held under)
                jobs.append({"kind": kind, "name": ref, "label": label, "group": group,
                             "title": urllib.parse.unquote(str(ref).rstrip("/").rsplit("/", 1)[-1]).replace("_", " ").strip()})
            jobs.sort(key=lambda j: ({"vehicle": 0, "component": 1, "commodity": 2}[j["kind"]], j["group"], j["label"]))
            out = {"ok": True, "jobs": jobs, "counts": {k: sum(1 for j in jobs if j["kind"] == k) for k in ("vehicle", "component", "commodity")}}
            self._photo_jobs = (time.time(), out)
            return out
        return self._uex_call(run)

    def dr_jobs(self, system=None, sort="oldest"):
        """Datarunner jobs: commodity terminals whose prices are the most out of date, oldest first
        (or nearest first). Uses UEX's data with newer Quantum community reports laid over it, so a
        terminal someone just reported drops down the list for everybody."""
        def run():
            now = time.time()
            terms = self._dr_terminals()
            places = self._uex.place_map(self._db.locations)
            rows, at = self._uex.get("commodities_prices_all")
            rows = self._community.overlay(rows)
            by = {}
            for r in rows:
                if r.get("id_terminal") not in terms:
                    continue
                for side in ("buy", "sell"):
                    if r.get(f"price_{side}"):
                        # None: UEX has never had a report for this price (kept apart from real ages,
                        # so a price that's 400 days old isn't called "never reported")
                        by.setdefault(r["id_terminal"], []).append(
                            max(0.0, (now - r["date_modified"]) / 86400) if r.get("date_modified") else None)
            mine = {}
            for e in self._dr_report_log():
                if not e.get("test") or not self._dr.live:
                    mine[e.get("id_terminal")] = max(mine.get(e.get("id_terminal"), 0), e.get("at", 0))
            spot = None
            if self._game_on():
                spot = self._log_spot(self._tracker.cur or {})[0]
            jobs = []
            hk = self._hidden_keys()
            unplaced = {services._key(n): n for n in self._unplaced}
            NEVER = 100000.0                                     # sorts after every real age
            reported = 0
            for tid, raw in by.items():
                t = terms[tid]
                if system and t.get("star_system_name") != system:
                    continue
                if not uex.is_live(t) or _place_key(uex.place_name(t)) in hk:
                    continue                                 # not in the game: no job to do there
                # Reported by you in the last day: the job's done. Its prices only get newer once UEX approves
                # the report (that can take hours), so until then it used to sit in the list as if nobody had
                # been there. It's left out of your list instead (and counted, so the page can say so).
                if mine.get(tid, 0) > now - 86400:
                    reported += 1
                    continue
                known = sorted(a for a in raw if a is not None)
                never = len(raw) - len(known)
                ages = known + [NEVER] * never
                # a place with no position yet (a new outpost or depot) is still named, so its job can
                # offer "Map it too" instead of nothing
                place = places.get(tid) or unplaced.get(services._key(uex.place_name(t)))
                jobs.append({"id": tid, "name": t.get("name"), "where": uex.where(t), "system": t.get("star_system_name"),
                             "place": place, "here": bool(spot and place == spot), "dist": self._dist_from_you(place),
                             "rows": len(ages), "stale": sum(1 for a in ages if a >= 3),
                             # oldest / median: real ages in days; None when no price there was ever reported
                             "oldest": round(known[-1], 1) if known else None,
                             "median": round(ages[len(ages) // 2], 1) if ages[len(ages) // 2] < NEVER else None,
                             "sort": ages[len(ages) // 2], "sort_oldest": ages[-1],
                             "days": round(sum(min(a, 60) for a in ages), 1),
                             # the average age of prices that have been reported, and how many never were
                             "avg": round(sum(known) / len(known), 1) if known else None,
                             "never": never,
                             "mine": mine.get(tid) if mine.get(tid, 0) > now - 86400 else None})
            if sort == "nearest":
                jobs.sort(key=lambda j: (j["dist"] is None, j["dist"] or 0, -j["sort"]))
            else:
                jobs.sort(key=lambda j: (-j["sort"], -j["sort_oldest"]))
            for j in jobs:
                j.pop("sort"), j.pop("sort_oldest")
            systems = sorted({t.get("star_system_name") for t in terms.values() if t.get("star_system_name")})
            return {"ok": True, "jobs": jobs[:80], "total": len(jobs), "systems": systems, "you_in": self._player_sys,
                    "at": at, "reported": reported}
        return self._uex_call(run)
