"""Api, part of: Signing in to the Quantum server, your Quantum account, profile photo and My Fleet on the website.

A mixin of app.py's Api (class Api(... AccountMixin ...)): the methods are the Api's, `self` is the one Api.
Module-level names come from qbase.py."""
from qbase import *  # noqa: F401,F403


class AccountMixin:
    # ------------------------------------------------------------ Quantum server sign-in
    # Quantum signs in to the Quantum server with your UEX datarunner secret key: the server asks UEX
    # whose key it is, forgets the key, and sends back a session token kept here in settings.json. Any
    # PC with your secret key (a new one, a reinstall, a second gaming PC) signs in the same way.
    def _session_token(self):
        """What the server knows this PC by: the UEX-key sign-in, or else the Quantum account's sign-in once that
        account is linked to a UEX name (the server treats it as that name)."""
        # The Quantum account comes first once it's linked to a UEX name: a server that requires accounts
        # (REQUIRE_ACCOUNT) only accepts that one
        if (self._settings.get("account") or {}).get("uex") and self._account_token():
            return self._account_token()
        return (self._dr_cfg().get("session") or {}).get("token") or None

    def _sign_in(self):
        """Sign in now (blocking). Returns the server's answer, or None without a secret key or server."""
        cfg = self._dr_cfg()
        secret = cfg.get("secret")
        if not secret or not self._community.url:
            return None
        r = self._community.login(secret)
        if r.get("status") == "ok" and r.get("session"):
            cfg["session"] = {"token": r["session"], "username": r.get("username"), "at": int(time.time())}
            if r.get("username") and not cfg.get("username"):
                cfg["username"] = r["username"]
            self._settings.pop("device_key", None)            # the old per-PC key isn't used any more
            self._settings.pop("trust_key", None)
            self._save_settings()
            threading.Thread(target=self._resend_alignments, daemon=True).start()   # ones made before signing in
        elif r.get("status") == "account_required":
            self._sender._event("Quantum server: sign in to a Quantum account (Profile) to send reports and pictures")
        else:
            self._sender._event(f"Quantum server sign-in: {r.get('status')}")    # shows in Settings > Log
        self._sign_in_status = r.get("status")
        return r

    def _sign_in_soon(self):
        """Sign in in the background, at most once a minute (so a server that keeps refusing isn't hammered)."""
        if time.time() - getattr(self, "_sign_in_at", 0) < 60:
            return
        self._sign_in_at = time.time()
        threading.Thread(target=self._sign_in, daemon=True).start()

    def _session_lost(self):
        """The server no longer accepts this sign-in (it expired, or the owner ended it): sign in again."""
        if self._dr_cfg().pop("session", None) is not None:
            self._save_settings()
        elif self._account_token():
            threading.Thread(target=self._account_refresh, daemon=True).start()   # the account's sign-in: still good?
        self._sign_in_soon()

    def trust_status(self):
        """Trusted contributor status and progress, for the FAQ."""
        cfg = self._dr_cfg()
        user = cfg.get("username") or (cfg.get("uex_user") or {}).get("username")
        try:
            if cfg.get("secret") and not self._session_token():
                self._sign_in()
        except Exception:
            watcher_mod.log_error("trust_status sign-in")
        r = self._community.trust(user) if user else None
        if r is None and user and self._community.url:
            time.sleep(1.5)                                    # a slow or just-restarted server: one more try
            r = self._community.trust(user)
        return {"ok": bool(r), "user": user, "trusted": bool(r and r.get("trusted")),
                "signed_in": bool(r and r.get("signed_in")), "has_secret": bool(cfg.get("secret")),
                "sign_in_status": getattr(self, "_sign_in_status", None), "info": (r or {}).get("info")}

    # ------------------------------------------------------------ Quantum account
    # Optional. Signing in happens right here with email and password (account_sign_in_password), or in the browser:
    # Quantum asks the server for a short code, opens quantumsc.org/account/link, the person signs in there and
    # approves, and Quantum gets its own sign-in without seeing the password. The sign-in is kept in settings.json
    # encrypted with Windows' DPAPI (secure.py). When a UEX secret key is saved too, the account is linked to that UEX
    # name by itself. "Keep my UEX keys in my Quantum account" (opt-in) keeps this PC's UEX Bearer Token and Secret Key
    # and the account's copy in step: keys changed here are saved there, and keys saved there (on the website, or
    # from another PC) are filled in here.
    def _account(self):
        return self._settings.setdefault("account", {})

    def _account_token(self):
        return secure.unprotect(self._account().get("token"))

    def _account_refresh(self):
        """Ask the server about the account sign-in: still good, and which UEX name it's linked to."""
        tok = self._account_token()
        if not tok:
            return
        r = self._community.account_me(tok)
        a = self._account()
        if r.get("status") == "ok":
            if (a.get("email"), a.get("uex")) != (r.get("email"), r.get("uex")):
                a.update(email=r.get("email"), uex=r.get("uex"))
                self._save_settings()
            if r.get("username") and (r.get("username"), bool(r.get("username_auto"))) != (a.get("username"), a.get("username_auto")):
                a.update(username=r["username"], username_auto=bool(r.get("username_auto")))   # your one name in Quantum
                self._save_settings()
            if r.get("created_at") and r.get("created_at") != a.get("joined"):
                a["joined"] = r["created_at"]                    # when the account was made (Profile › Joined)
                self._save_settings()
            av = r.get("avatar")                                 # the profile photo kept with the account
            if isinstance(av, str) and av.startswith(("data:image/", "https://")) and av != a.get("avatar"):
                a["avatar"] = av
                self._save_settings()
            self._account_keys(r.get("uex_keys"))
            if not r.get("uex") and not self._account().get("uex"):
                self._account_link()
        elif r.get("status") == "signed_out":            # signed out on the website, or the account was deleted
            a.pop("token", None)
            a["note"] = "You were signed out of your Quantum account. Sign in again to keep using it here."
            self._save_settings()

    # ------------------------------------------------------------ profile photo
    # Your own picture for the profile button: kept on this PC, and with your Quantum account when you're
    # signed in (POST /v1/account/avatar, so the website and your other PCs show it). Without one, your UEX
    # avatar is shown. The page shrinks it to a 256 px square JPEG before it gets here.
    PHOTO_MAX = 400_000                     # characters of data: URL (~300 KB)

    def profile_photo(self):
        a = self._account()
        return {"ok": True, "photo": self._settings.get("profile_photo") or a.get("avatar"),
                "shared": bool(self._settings.get("profile_photo_shared"))}

    def profile_photo_set(self, data_url=None):
        if data_url:
            m = re.match(r"^data:image/(jpeg|png|webp);base64,([A-Za-z0-9+/=]+)$", str(data_url))
            if not m or len(data_url) > self.PHOTO_MAX:
                return {"ok": False, "error": "That picture couldn't be used. Try a JPEG or PNG under a few MB"}
            try:
                from PIL import Image
                import io
                Image.open(io.BytesIO(base64.b64decode(m.group(2)))).verify()
            except Exception:
                return {"ok": False, "error": "That file isn't a picture Quantum can read"}
            self._settings["profile_photo"] = data_url
        else:
            self._settings.pop("profile_photo", None)
            self._account().pop("avatar", None)
        self._settings["profile_photo_shared"] = False
        self._save_settings()
        tok = self._account_token()
        if tok:
            def send(img=data_url or None):
                r = self._community.account_avatar(tok, img)
                if r.get("status") == "ok" and self._settings.get("profile_photo") == (img or None):
                    self._settings["profile_photo_shared"] = True
                    self._save_settings()
            threading.Thread(target=send, daemon=True).start()
        return {"ok": True, "photo": data_url or self._account().get("avatar"), "signed_in": bool(tok)}

    def _account_link(self):
        """Link the saved UEX secret key's name to the account, if both are here and it isn't linked yet."""
        tok, secret = self._account_token(), self._dr_cfg().get("secret")
        if not tok or not secret:
            return None
        r = self._community.link_uex(tok, secret)
        if r.get("status") == "ok":
            self._account()["uex"] = r.get("uex")
            self._account().pop("link_error", None)
        else:
            self._account()["link_error"] = r.get("status")
        self._save_settings()
        return r

    def _account_agent(self):
        import platform
        return f"Quantum {updater.VERSION} on {platform.node() or 'Windows'}"[:100]

    def _accounts_open(self):
        """Does the Quantum server offer accounts yet? Asked at most every 5 minutes; Settings hides the section
        until it does (and always shows it once this PC is signed in)."""
        now = time.time()
        if now - getattr(self, "_accounts_open_at", 0) > 300 or not getattr(self, "_accounts_open_v", False):
            try:
                r = self._community._req("/v1/health", timeout=6)
                if r.get("status") == "ok":
                    self._accounts_open_v = bool(r.get("accounts"))
                    self._accounts_open_at = now
            except Exception:
                pass                                            # couldn't ask: Settings asks again shortly
        return bool(getattr(self, "_accounts_open_v", False))

    def account_status(self):
        """For Settings: signed in or not, and how a sign-in in progress is going."""
        a = self._account()
        if self._account_token() and time.time() - getattr(self, "_acct_checked", 0) > 60:
            self._acct_checked = time.time()                     # Settings is open: catch changes made on the website
            threading.Thread(target=self._account_refresh, daemon=True).start()
        return {"on": bool(self._community.url), "available": bool(self._account_token()) or (bool(self._community.url) and self._accounts_open()),
                "signed_in": bool(self._account_token()), "email": a.get("email"), "joined": a.get("joined"),
                "uex": a.get("uex"), "username": a.get("username"), "link_error": a.get("link_error"), "note": a.get("note"),
                "has_secret": bool(self._dr_cfg().get("secret")), "has_token": bool(self._uex.token), "flow": dict(self._acct_flow),
                "site": self._community.url or community.DEFAULT_URL,
                "keys": {"stored": bool(a.get("keys_stored")), "error": a.get("keys_error"),
                         "note": a.pop("keys_note", None)},          # said once
                "fleet_web": {"on": self._fleet_web_wanted(), "at": a.get("fleet_web_at"), "error": a.get("fleet_web_error")}}

    def account_sign_in(self):
        """Start signing in: get a code from the server, open the approval page, and wait for it in the background."""
        if self._acct_flow.get("state") == "waiting":
            return self.account_status()
        r = self._community.device_start(self._account_agent())
        if r.get("status") != "ok":
            self._acct_flow = {"state": "error", "error": {
                "unavailable": "Quantum accounts aren't open yet.", "requests_limit_reached": "Too many tries. Wait a little and try again.",
                "off": "Community features are turned off (Settings › Quantum API)."}.get(r.get("status"),
                "Couldn't reach the Quantum server. Try again in a moment.")}
            return self.account_status()
        flow = {"state": "waiting", "user_code": r["user_code"], "url": r["verify_url"], "page": r.get("verify_page"),
                "until": time.time() + r.get("expires_in", 900)}
        self._acct_flow = flow
        self._account().pop("note", None)
        try:
            webbrowser.open(flow["url"])
        except Exception:
            pass

        def wait(device, interval):
            while self._acct_flow is flow and time.time() < flow["until"]:
                time.sleep(interval)
                if self._acct_flow is not flow:
                    return                                      # cancelled, or started again
                p = self._community.device_poll(device)
                st = p.get("status")
                if st == "slow_down":
                    interval += 2
                elif st == "ok" and p.get("session"):
                    self._acct_flow = {"state": "done"}
                    self._account_signed_in(p)
                    return
                elif st in ("denied", "expired"):
                    self._acct_flow = {"state": "error", "error": "The sign-in was denied in the browser." if st == "denied"
                                       else "The code expired. Start again."}
                    return
            if self._acct_flow is flow:
                self._acct_flow = {"state": "error", "error": "The code expired. Start again."}
        threading.Thread(target=wait, args=(r["device_code"], max(3, int(r.get("interval") or 5))), daemon=True).start()
        return self.account_status()

    def account_sign_in_password(self, email, password):
        """Sign in right here with the account's email and password (Settings › Quantum account)."""
        email = (email or "").strip()
        if not email or not password:
            return {**self.account_status(), "ok": False, "error": "Enter your email and password."}
        r = self._community.account_login(email, password, self._account_agent())
        st = r.get("status")
        if st == "ok" and r.get("session"):
            self._acct_flow = {"state": "idle"}
            self._account_signed_in(r)
            return {**self.account_status(), "ok": True}
        if st == "unavailable" and self._accounts_open():
            # Accounts are open, but this server is older than signing in from the app: the browser way still works
            return {**self.account_status(), "ok": False, "older_server": True,
                    "error": "This Quantum server can't take sign-ins from the app yet. Use \"sign in with your browser\" below."}
        msg = r.get("message") or {
            "unavailable": "Quantum accounts aren't open yet.", "off": "Community features are turned off (Settings › Quantum API).",
            "requests_limit_reached": "Too many tries. Wait a little and try again."}.get(st, "Couldn't reach the Quantum server. Try again in a moment.")
        return {**self.account_status(), "ok": False, "error": msg, "unconfirmed": st == "unconfirmed"}

    def _account_signed_in(self, p):
        """A new account sign-in (from the browser or with the password): keep it, link the UEX name, and bring in
        the UEX keys saved in the account, if any."""
        a = self._account()
        if a.get("email") and a.get("email") != p.get("email"):
            self._account_forget_person()                # another account was here before: none of its things stay
        a.update(token=secure.protect(p["session"]), email=p.get("email"), uex=p.get("uex"), at=int(time.time()))
        for k in ("note", "keys_at", "keys_error", "keys_note"):
            a.pop(k, None)
        if p.get("username"):
            a.update(username=p["username"], username_auto=bool(p.get("username_auto")))
        if p.get("created_at"):
            a["joined"] = p["created_at"]
        av = p.get("avatar")
        if isinstance(av, str) and av.startswith(("data:image/", "https://")):
            a["avatar"] = av                             # the account's own picture wins over one set here before
            self._settings.pop("profile_photo", None)
            self._settings["profile_photo_shared"] = True
        elif self._settings.get("profile_photo") and not self._settings.get("profile_photo_shared"):
            self.profile_photo_set(self._settings["profile_photo"])   # a picture set here while signed out: give it to the account
        self._soc.update(state=None, top=None)
        self._save_settings()
        self._acct_checked = time.time()
        self._account_keys(p.get("uex_keys"))
        if not p.get("uex") and not a.get("uex"):
            self._account_link()

    def _account_loop(self):
        """Every 10 minutes while signed in: is the sign-in still good, and did the saved UEX keys change?"""
        while True:
            time.sleep(600)
            if self._account_token():
                try:
                    self._account_refresh()
                except Exception:
                    pass
                self._fleet_web_failed = None       # a copy that couldn't be sent earlier gets another go
                try:
                    self._fleet_web_check()
                except Exception:
                    pass

    KEY_ERRORS = {"invalid_token": "UEX didn't accept your Bearer Token, so it wasn't saved to your account.",
                  "invalid_secret_key": "UEX didn't accept your Secret Key with this Bearer Token, so they weren't saved to your account.",
                  "banned": "That UEX name is banned from Quantum.", "try_later": "UEX is busy. Your keys will be saved to your account on the next try.",
                  "uex_unreachable": "Couldn't reach UEX. Your keys will be saved to your account on the next try.",
                  "requests_limit_reached": "Too many tries. Wait a little and try again.",
                  "signed_out": "You were signed out of your Quantum account."}

    def _account_keys(self, info):
        """What the server says about the keys saved in the account (/v1/account/me's uex_keys): fill in keys saved
        there since this PC last looked."""
        if info is None:
            return
        a = self._account()
        stored, updated = bool(info.get("stored")), int(info.get("updated") or 0)
        changed = bool(a.get("keys_stored")) != stored
        a["keys_stored"] = stored
        if stored and updated > int(a.get("keys_at") or 0):
            r = self._community.uex_keys_get(self._account_token())
            if r.get("status") == "ok" and r.get("token"):
                filled = self._apply_account_keys(r["token"], r.get("secret"))
                a["keys_at"] = int(r.get("updated") or updated)
                a.pop("keys_error", None)
                if filled:
                    a["keys_note"] = "Your UEX keys were filled in from your Quantum account."
            elif r.get("status") == "unreadable":
                a["keys_error"] = "The UEX keys saved in your account can't be read any more. Turn the switch off and on to save them again."
            changed = True
        elif not stored:
            a.pop("keys_at", None)
        if changed:
            self._save_settings()

    def _apply_account_keys(self, token, secret):
        """Use the account's keys on this PC (the same checks as typing them in). True if anything changed."""
        filled = False
        if token and token != (self._uex.token or ""):
            if self.set_uex_token(token, _from_account=True).get("ok"):
                filled = True
        if secret and secret != (self._dr_cfg().get("secret") or "") and self._uex.token:
            if self.dr_set_secret(secret, _from_account=True).get("ok"):
                filled = True
        return filled

    def _account_keys_push_soon(self):
        """Keys changed on this PC: save them to the account too, when it keeps them."""
        if self._account_token() and self._account().get("keys_stored"):
            threading.Thread(target=self._account_keys_push, daemon=True).start()

    def _account_keys_push(self):
        tok, bearer, secret = self._account_token(), self._uex.token, self._dr_cfg().get("secret")
        if not tok or not bearer:
            return {"status": "no_token"}
        r = self._community.uex_keys_save(tok, bearer, secret)
        a = self._account()
        if r.get("status") == "ok":
            a["keys_stored"] = True
            a["keys_at"] = int((r.get("keys") or {}).get("updated") or time.time())
            a.pop("keys_error", None)
            if r.get("uex"):
                a["uex"] = r["uex"]
                a.pop("link_error", None)
        else:
            a["keys_error"] = self.KEY_ERRORS.get(r.get("status"), "Couldn't save your UEX keys to your account. Try again in a moment.")
        self._save_settings()
        return r

    def account_set_key_sync(self, on):
        """Settings › Quantum account › "Keep my UEX keys in my Quantum account"."""
        tok = self._account_token()
        if not tok:
            return {**self.account_status(), "ok": False, "error": "Sign in to your Quantum account first."}
        a = self._account()
        if on:
            if self._uex.token:                           # this PC's keys go to the account
                r = self._account_keys_push()
                ok = r.get("status") == "ok"
                return {**self.account_status(), "ok": ok, "error": None if ok else a.get("keys_error")}
            me = self._community.account_me(tok)          # none here: take the account's, if it has some
            info = me.get("uex_keys") or {}
            if not info.get("stored"):
                return {**self.account_status(), "ok": False, "error": "Save your UEX Bearer Token above first."}
            a.pop("keys_at", None)
            self._account_keys(info)
            return {**self.account_status(), "ok": bool(self._uex.token), "error": a.get("keys_error")}
        r = self._community.uex_keys_remove(tok)
        if r.get("status") != "ok":
            return {**self.account_status(), "ok": False, "error": "Couldn't reach the Quantum server. Try again in a moment."}
        for k in ("keys_stored", "keys_at", "keys_error", "keys_note"):
            a.pop(k, None)
        self._save_settings()
        return {**self.account_status(), "ok": True}

    # ---- My Fleet on the website. While signed in (and "Show my fleet and gear loadouts on the website" is on,
    # the default), a copy of My Fleet, every ship with each of its loadouts as My Fleet works it out, and the gear
    # loadouts go to the account a few seconds after they change, so quantumsc.org/fleet can show them to you.
    # The copy is replaced whole each time; turning the switch off removes it from the server.
    FLEET_WEB_WAIT = 8                     # s after the last change before the copy is sent

    def _fleet_web_wanted(self):
        return self._settings.get("fleet_web", True) is not False

    def _fleet_web_key(self):
        """A fingerprint of what the copy holds, to tell whether it changed."""
        keep = {"fleet": [{k: v for k, v in f.items() if k not in ("loadout", "power")} for f in self._settings.get("fleet") or []],
                "gear": self._settings.get("gear_loadouts") or []}
        return hashlib.sha256(json.dumps(keep, sort_keys=True, default=str).encode()).hexdigest()[:24]

    def _fleet_web_check(self):
        if not self._fleet_web_wanted() or not getattr(self, "_community", None) or not self._account_token():
            return
        key = self._fleet_web_key()
        if key in (self._account().get("fleet_web_key"), getattr(self, "_fleet_web_pending", None),
                   getattr(self, "_fleet_web_failed", None)):
            return                            # already sent, on its way, or just failed (tried again on the next change)
        self._fleet_web_pending = key
        t = getattr(self, "_fleet_web_timer", None)
        if t:
            t.cancel()
        self._fleet_web_timer = threading.Timer(self.FLEET_WEB_WAIT, self._fleet_web_push)
        self._fleet_web_timer.daemon = True
        self._fleet_web_timer.start()

    def _fleet_web_snapshot(self):
        """Every ship in My Fleet with each loadout worked out, and the gear loadouts, as the server keeps them."""
        rows = self._vehicle_rows()
        ships = []
        for f in json.loads(json.dumps(self._settings.get("fleet") or [], default=str)):    # a copy: My Fleet isn't touched
            try:
                self._loadouts(f)
            except Exception:
                continue
            v = rows.get(f.get("vehicle_id"), {})
            out = {"uid": f["uid"], "vehicle_id": f.get("vehicle_id"), "name": f.get("name"), "nickname": f.get("nickname"),
                   "full": v.get("name_full") or f.get("name"), "maker": v.get("company_name") or "", "scu": v.get("scu") or 0,
                   "pad": v.get("pad_type"), "main": bool(f.get("main")), "primary": f.get("primary_loadout"),
                   "photo": self._vehicle_photo(v) if v else None, "loadouts": []}
            for lo in f["loadouts"]:
                c = json.loads(json.dumps(f, default=str))
                c["active_loadout"] = lo["id"]
                entry = {"id": lo["id"], "name": lo["name"], "livery": (lo.get("livery") or {}).get("name")}
                try:
                    r = self.fleet_loadout(f["uid"], _ship=c)
                except Exception as e:
                    r = {"ok": False, "error": str(e)}
                if r.get("ok"):
                    photo = (r.get("ship") or {}).get("photo")
                    entry.update(slots=r.get("slots") or [], fixed=r.get("fixed") or [], stats=r.get("stats") or {},
                                 stock_stats=r.get("stock_stats") or {}, delta=r.get("delta") or {}, missiles=r.get("missiles"),
                                 power=r.get("power"), photo=photo if isinstance(photo, str) and photo.startswith("https://") else None)
                else:                                        # no wiki loadout: at least the parts swapped in
                    entry.update(error=r.get("error"), slots=[{"port": p, "type": "", "label": p.split("/")[-1],
                                                               "fitted": x.get("name") if isinstance(x, dict) else x}
                                                              for p, x in (lo.get("loadout") or {}).items()])
                out["loadouts"].append(entry)
            ships.append(out)
        return {"fleet": ships, "gear": self._settings.get("gear_loadouts") or [], "version": updater.VERSION}

    def _fleet_web_push(self):
        key = getattr(self, "_fleet_web_pending", None)
        tok = self._account_token()
        if not tok or not self._fleet_web_wanted():
            return
        try:
            r = self._community.fleet_sync(tok, self._fleet_web_snapshot())
        except Exception as e:
            r = {"status": "error", "detail": str(e)}
        a = self._account()
        if getattr(self, "_fleet_web_pending", None) == key:
            self._fleet_web_pending = None
        if r.get("status") == "ok":
            a.update(fleet_web_key=key, fleet_web_at=int(r.get("updated") or time.time()))
            a.pop("fleet_web_error", None)
            self._fleet_web_failed = None
        else:
            a["fleet_web_error"] = (r.get("message") or {"too_big": "Your fleet is too big to keep on the website.",
                                                         "signed_out": "You were signed out of your Quantum account."}.get(
                r.get("status"), "Couldn't send your fleet to the website. It'll try again with your next change."))
            a.pop("fleet_web_key", None)
            self._fleet_web_failed = key
        self._save_settings()

    def account_set_fleet_web(self, on):
        """Settings › Quantum account › "Show my fleet and gear loadouts on the website"."""
        tok = self._account_token()
        if not tok:
            return {**self.account_status(), "ok": False, "error": "Sign in to your Quantum account first."}
        a = self._account()
        self._settings["fleet_web"] = bool(on)
        if on:
            a.pop("fleet_web_key", None)
            self._fleet_web_failed = None
            self._fleet_web_pending = key = self._fleet_web_key()
            self._fleet_web_push()
            ok = a.get("fleet_web_key") == key
            return {**self.account_status(), "ok": ok, "error": None if ok else a.get("fleet_web_error")}
        r = self._community.fleet_clear(tok)
        for k in ("fleet_web_key", "fleet_web_at", "fleet_web_error"):
            a.pop(k, None)
        self._save_settings()
        if r.get("status") != "ok":
            return {**self.account_status(), "ok": False, "error": "Turned off, but the website's copy couldn't be removed yet. Try again in a moment."}
        return {**self.account_status(), "ok": True}

    def account_open_page(self):
        f = self._acct_flow
        if f.get("url"):
            webbrowser.open(f["url"])
        return self.account_status()

    def account_cancel(self):
        self._acct_flow = {"state": "idle"}
        return self.account_status()

    def _account_forget_person(self):
        """What belonged to the account signed in here: its name, picture and friends, so the next one starts clean."""
        a = self._account()
        for k in ("username", "username_auto", "joined", "avatar"):
            a.pop(k, None)
        if self._settings.get("profile_photo_shared") or a.get("token"):
            self._settings.pop("profile_photo", None)    # it was the account's picture (kept with the account)
        self._settings["profile_photo_shared"] = False
        self._soc.update(state=None, top=None)

    def account_sign_out(self):
        """Sign out of the account on this PC (the server forgets this sign-in too). The UEX-key sign-in stays."""
        tok = self._account_token()
        a = self._account()
        self._account_forget_person()
        for k in ("token", "email", "uex", "link_error", "note", "at", "keys_stored", "keys_at", "keys_error", "keys_note"):
            a.pop(k, None)
        self._save_settings()
        if tok:
            threading.Thread(target=self._community.account_logout, args=(tok,), daemon=True).start()
        self._acct_flow = {"state": "idle"}
        return self.account_status()

    # What your profile shows of your fleet and gear loadouts: in which order, which ones, and how many.
    # {"ships": {"order": [uid…], "hidden": [uid…], "count": n, "off": bool}, "gearlo": {...}, "orgs": {...},
    #  "listings": {...}, "sees": "everyone" | "friends" | "nobody", "stats_off": bool}
    def profile_prefs(self):
        return {"ok": True, "prefs": self._settings.get("profile_prefs") or {}}

    def profile_prefs_set(self, prefs):
        out = {"sees": prefs.get("sees") if isinstance(prefs, dict) and prefs.get("sees") in ("everyone", "friends", "nobody") else "everyone",
               "stats_off": bool(isinstance(prefs, dict) and prefs.get("stats_off"))}
        for k in ("ships", "gearlo", "orgs", "listings"):
            v = (prefs or {}).get(k) if isinstance(prefs, dict) else None
            if not isinstance(v, dict):
                continue
            ids = lambda L: [str(x)[:40] for x in (L or []) if isinstance(x, (str, int))][:200]
            c = v.get("count")
            out[k] = {"order": ids(v.get("order")), "hidden": ids(v.get("hidden")), "off": bool(v.get("off")),
                      "count": max(1, min(10, int(c))) if isinstance(c, (int, float)) and not isinstance(c, bool) else None}
        self._settings["profile_prefs"] = out
        self._save_settings()
        return {"ok": True, "prefs": out}

    def sign_out_all(self):
        """Profile › Sign out: off with everything on this PC, so nothing stays connected. Your Quantum
        account sign-in, the Quantum server sign-in, and your UEX Bearer Token and Secret Key are removed
        (a copy kept in your Quantum account stays there and comes back when you sign in again). Your
        ships, waypoints, routes, loadouts and settings stay on this PC."""
        self.account_sign_out()
        self.dr_set_secret("")                      # also signs this PC out of the Quantum server
        cfg = self._dr_cfg()
        for k in ("username", "uex_user", "rating", "session"):
            cfg.pop(k, None)
        self.set_uex_token("")
        self._settings["profile_photo_shared"] = False
        self._save_settings()
        return {"ok": True}

    def account_link_now(self):
        """Try linking the saved UEX secret key again (from Settings)."""
        self._account_link()
        return self.account_status()

    def set_community_url(self, url):
        """The Quantum API server for community prices; empty turns them off."""
        url = (url or "").strip().rstrip("/")
        if url and not url.startswith(("https://", "http://")):
            url = "https://" + url
        self._settings["community_url"] = url
        self._save_settings()
        self._community.prices(fresh=True)
        return self.community_status()
