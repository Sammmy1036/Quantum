"""Api, part of: Social (friends and messages), the player marketplace and orgs. The server side is social.py, market.py and orgs.py.

A mixin of app.py's Api (class Api(... SocialMixin ...)): the methods are the Api's, `self` is the one Api.
Module-level names come from qbase.py."""
from qbase import *  # noqa: F401,F403


class SocialMixin:
    # ------------------------------------------------------------ social: friends and messages
    # Signed in to a Quantum account, the app checks in with the server (GET /v1/social/state) every 20 s, or
    # every 4 s while the Social section is open. That check-in is also what shows you online to your friends.
    def _social_call(self, path, body=None, timeout=10):
        return self._community.social(self._account_token(), path, body, timeout)

    def _social_loop(self):
        so = self._soc
        while True:
            fast = time.time() < so["focus_until"]
            try:
                if self._account_token() and self._community.url:
                    self._social_tick()
                elif so["state"] is not None:
                    so.update(state=None, top=None)
            except Exception:
                watcher_mod.log_error("social")
            so["wake"].wait(4 if fast else 20)
            so["wake"].clear()

    def _social_tick(self):
        with self._soc["lock"]:                  # one check-in at a time, so nothing is notified twice
            self._social_tick_locked()

    def _social_tick_locked(self):
        so = self._soc
        playing = bool(self._game_on()) if os.name == "nt" else False
        if playing != so["playing"]:            # friends see "In Star Citizen" while the game runs
            want = self._settings.get("social_status") or "online"
            if self._social_call("status", {"status": want, "playing": playing}).get("status") == "ok":
                so["playing"] = playing
        r = self._social_call("state" + (f"?since={so['top']}" if so["top"] is not None else "?since=0"))
        st = r.get("status")
        if st != "ok":
            so["err"] = st
            if st in ("signed_out", "unavailable"):
                so["state"] = {"status": st}
            return
        so["err"] = None
        for m in r.get("new") or []:
            f = next((x for x in [*(r.get("friends") or []), *(r.get("chats") or [])] if x["id"] == m["sender"]), None)
            so["notes"].append({"id": m["id"], "from": m["sender"], "name": f["name"] if f else "A friend",
                                "body": m["body"][:140], "avatar": f.get("avatar") if f else None})
        so["notes"] = so["notes"][-20:]
        so["top"] = max(r.get("top") or 0, so["top"] or 0)
        known = {x["id"] for x in (so["state"] or {}).get("incoming") or []}
        for q in r.get("incoming") or []:
            if so["state"] is not None and q["id"] not in known:
                so["notes"].append({"request": True, "from": q["id"], "name": q["name"], "avatar": q.get("avatar")})
        so["state"] = r

    def _social_badge(self):
        s = self._soc["state"] or {}
        return {"unread": s.get("unread") or 0, "requests": len(s.get("incoming") or []), "market": s.get("market_todo") or 0,
                "online": sum(1 for f in s.get("friends") or [] if f.get("online"))} if s.get("status") == "ok" else None

    def social_get(self, focus=True):
        """Friends, requests and anything new since last time (shown as notifications once)."""
        so = self._soc
        if focus:
            fresh = time.time() >= so["focus_until"]
            so["focus_until"] = time.time() + 30
            if fresh:
                so["wake"].set()
        if not self._account_token():
            return {"ok": True, "signed_in": False}
        notes, so["notes"] = so["notes"], []
        return {"ok": True, "signed_in": True, "state": so["state"], "error": so["err"], "notes": notes,
                "my_status": self._settings.get("social_status") or "online"}

    def social_refresh(self):
        self._soc["focus_until"] = time.time() + 30
        try:
            self._social_tick()
        except Exception:
            watcher_mod.log_error("social")
        return self.social_get(False)

    # ------------------------------------------------------------ marketplace (server: market.py)
    _PM_PATH = re.compile(r"^(browse|listing|mine|escrow|create|update|close|renew|delete|remove|contact|buy|trade|rate|report|reviews|"
                          r"escrow/apply|escrow/decide|escrow/appoint|escrow/remove)(\?[\w=&%.,+\-]*)?$")
    _PM_ERR = {"signed_out": "Sign in to your Quantum account first.", "unreachable": "Couldn't reach the Quantum server. Try again in a moment.",
               "unavailable": "The Quantum server isn't running the marketplace yet (market.py), so nothing can be listed or bought.", "forbidden": "Only the Quantum owner can do that.",
               "not_found": "That isn't there any more.", "requests_limit_reached": "That's a lot in a short time. Wait a little and try again."}

    def pm(self, path, body=None):
        """The marketplace: GET when body is None, otherwise POST. Path as in market.py, e.g. "browse?kind=item"."""
        path = str(path or "")
        if not self._PM_PATH.match(path):
            return {"ok": False, "error": "Unknown request"}
        r = self._community.market(self._account_token(), path, body if body is None else dict(body), timeout=40 if body and body.get("photo") else 15)
        ok = r.get("status") == "ok"
        if ok and body is not None:
            threading.Thread(target=self._social_tick, daemon=True).start()      # trade badges and chat messages
        return {**r, "ok": ok, "signed_in": bool(self._account_token()),
                "error": None if ok else (r.get("message") or self._PM_ERR.get(r.get("status"), "Something went wrong. Try again."))}

    # ------------------------------------------------------------ orgs (server: orgs.py)
    _ORG_PATH = re.compile(r"^(mine|browse|org|create|update|delete|transfer|invite|invite/respond|invite/cancel|request|"
                           r"request/respond|member/rank|member/remove|leave|rank/save|rank/delete|rank/move|event/save|"
                           r"event/delete|rsvp|claim|claim/check|claim/cancel|slot/take|slot/leave|slot/assign|slot/unassign|banner)(\?[\w=&%.,+\-]*)?$")

    def org(self, path, body=None):
        """Orgs: GET when body is None, otherwise POST. Path as in orgs.py, e.g. "org?id=3"."""
        path = str(path or "")
        if not self._ORG_PATH.match(path):
            return {"ok": False, "error": "Unknown request"}
        r = self._community.orgs(self._account_token(), path, body if body is None else dict(body),
                                 timeout=60 if body and (body.get("logo") or body.get("banner")) else 15)
        ok = r.get("status") == "ok"
        if ok and body is not None:
            threading.Thread(target=self._social_tick, daemon=True).start()
        err = {"signed_out": "Sign in to your Quantum account first.", "unreachable": "Couldn't reach the Quantum server. Try again in a moment.",
               "unavailable": "The Quantum server isn't running orgs yet (orgs.py).", "forbidden": "Your rank can't do that.",
               "not_found": "That isn't there any more.", "requests_limit_reached": "That's a lot in a short time. Wait a little and try again."}
        return {**r, "ok": ok, "signed_in": bool(self._account_token()),
                "error": None if ok else (r.get("message") or err.get(r.get("status"), "Something went wrong. Try again."))}

    _SOCIAL_ERR = {"unreachable": "Couldn't reach the Quantum server. Try again in a moment.",
                   "requests_limit_reached": "That's a lot in a short time. Wait a little and try again.",
                   "signed_out": "Sign in to your Quantum account first.",
                   "not_friends": "You can only message friends.", "too_long": "That message is too long (2,000 characters at most).",
                   "too_many_friends": "You've reached the friend limit.",
                   "too_many_pending": "You have a lot of friend requests waiting. Cancel some first.",
                   "not_found": "That person isn't on Quantum any more.", "unavailable": "The Quantum server doesn't have friends and messages yet."}

    def _social_result(self, r, refresh=True):
        ok = r.get("status") == "ok"
        if ok and refresh:
            threading.Thread(target=self._social_tick, daemon=True).start()
        return {**r, "ok": ok, "error": None if ok else self._SOCIAL_ERR.get(r.get("status")) or r.get("message") or "Something went wrong. Try again."}

    def social_search(self, q):
        return self._social_result(self._social_call("search?q=" + urllib.parse.quote(str(q or "")[:40])), refresh=False)

    def social_request(self, member_id):
        return self._social_result(self._social_call("request", {"id": member_id}))

    def social_respond(self, member_id, accept):
        return self._social_result(self._social_call("respond", {"id": member_id, "accept": bool(accept)}))

    def social_remove(self, member_id):
        return self._social_result(self._social_call("remove", {"id": member_id}))

    def social_block(self, member_id, block=True):
        return self._social_result(self._social_call("block" if block else "unblock", {"id": member_id}))

    def social_blocked(self):
        return self._social_result(self._social_call("blocked"), refresh=False)

    def social_profile(self, who):
        """Someone's profile (their id or @username), as you may see it."""
        return self._social_result(self._social_call("profile?id=" + urllib.parse.quote(str(who or "")[:40])), refresh=False)

    def social_profile_publish(self, data):
        """Publish what your profile shows other people. The page builds it from your Profile choices: the ships and
        loadouts you chose (already in order), how to show your orgs and listings, and who may see it."""
        if not isinstance(data, dict):
            return {"ok": False, "error": "Nothing to publish"}
        return self._social_result(self._social_call("profile", data, timeout=20), refresh=False)

    def social_messages(self, member_id, before=None):
        q = f"messages?with={urllib.parse.quote(str(member_id or ''))}" + (f"&before={int(before)}" if before else "")
        r = self._social_result(self._social_call(q), refresh=False)
        s = self._soc["state"] or {}
        for f in s.get("friends") or []:              # opening it read them: drop the badge now, not at the next check-in
            if r["ok"] and f["id"] == str(member_id) and f.get("unread"):
                s["unread"] = max(0, (s.get("unread") or 0) - f["unread"])
                f["unread"] = 0
        return r

    def social_send(self, member_id, body):
        return self._social_result(self._social_call("send", {"to": member_id, "body": str(body or "")[:2000]}), refresh=False)

    def social_username(self, name):
        """Choose your username (@name): unique, 3-20 letters, numbers, _ and ."""
        return self._social_result(self._social_call("username", {"username": str(name or "")[:40]}))

    def social_set_status(self, status):
        if status not in ("online", "away", "invisible"):
            return {"ok": False, "error": "Unknown status"}
        self._settings["social_status"] = status
        self._save_settings()
        r = self._social_call("status", {"status": status, "playing": bool(self._soc["playing"])})
        return self._social_result(r)
