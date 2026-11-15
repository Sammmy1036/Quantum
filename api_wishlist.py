"""Api, part of: Your wish list.

A mixin of app.py's Api (class Api(... WishlistMixin ...)): the methods are the Api's, `self` is the one Api.
Module-level names come from qbase.py.

Ships, ship parts and gear you want, kept to come back to: each with a note and how much you want it, and
in one click into the Cart when you're ready to buy (in game, for aUEC). The list lives in settings.json and,
while you're signed in to your Quantum account, with the account too (server: wishlist.py), so it's the same
on every PC and on quantumsc.org. Every entry carries the time it last changed; a sync sends the whole list and
the server keeps the newer change of each entry. A removed entry stays as a marker for a while, so another PC
doesn't bring it back."""
from qbase import *  # noqa: F401,F403

WISH_KINDS = ("ship", "component", "weapon", "armor", "gadget", "clothing", "consumable", "utility", "other")
WISH_CART_KINDS = ("ship", "component", "weapon", "armor", "gadget", "clothing", "consumable", "utility")
WISH_TOMBSTONE = 60 * 86400


def wish_merge(a, b, now=None):
    """Two lists put together: per id the newer change wins (a removed marker included); old markers dropped.
    The same rule as the server's (wishlist.py)."""
    now = now or time.time()
    out = {}
    for x in list(a or []) + list(b or []):
        if not isinstance(x, dict) or not x.get("id"):
            continue
        have = out.get(x["id"])
        u, hu = x.get("updated") or 0, (have or {}).get("updated") or 0
        if have is None or u > hu or (u == hu and x.get("deleted") and not have.get("deleted")):
            out[x["id"]] = x                     # the newer change wins; on a tie, taking it off wins
    # "updated" is in milliseconds (two changes in one second still come in the right order)
    keep = [x for x in out.values() if not (x.get("deleted") and (x.get("updated") or 0) / 1000 < now - WISH_TOMBSTONE)]
    keep.sort(key=lambda x: -(x.get("added") or x.get("updated") or 0))
    return keep


def _same(a, b):
    if a.get("kind") != b.get("kind"):
        return False
    if a.get("uuid") and b.get("uuid"):
        return str(a["uuid"]).lower() == str(b["uuid"]).lower()
    if a.get("kind") == "ship" and a.get("uex_id") is not None and b.get("uex_id") is not None:
        return str(a["uex_id"]) == str(b["uex_id"])
    return (a.get("name") or "").strip().lower() == (b.get("name") or "").strip().lower()


class WishlistMixin:
    WISH_SYNC_WAIT = 3          # s after the last change before the list is sent
    WISH_SYNC_EVERY = 90        # s: opening the list asks the account for other PCs' changes at most this often

    def _wish(self):
        w = self._settings.setdefault("wishlist", {})
        if not isinstance(w.get("items"), list):
            w["items"] = []
        return w

    def _wish_live(self):
        return [x for x in self._wish()["items"] if not x.get("deleted")]

    def _wish_changed(self):
        self._wish_ver = getattr(self, "_wish_ver", 0) + 1
        self._save_settings()
        self._wish_sync_soon()

    # ---- the list
    def wish_list(self):
        """{ok, items: [entry + price/where/sold (in game, cheapest) for what the Cart can buy], sync: {...}}."""
        w = self._wish()
        if self._account_token() and time.time() - (w.get("synced_at") or 0) > self.WISH_SYNC_EVERY \
                and not getattr(self, "_wish_syncing", False):
            threading.Thread(target=self._wish_sync, daemon=True).start()
        items = [dict(x) for x in self._wish_live()]
        market = self._wish_market()
        for x in items:
            if market.get(x["id"]):
                x["market"] = market[x["id"]]
        cache = {}
        for x in items:
            if x.get("kind") not in WISH_CART_KINDS:
                continue
            try:
                spots = self._wish_spots(x, cache)
            except Exception:
                spots = []
            best = min((s for s in spots if s.get("price")), key=lambda s: s["price"], default=None)
            x.update(price=best["price"] if best else None, where=best["where"] if best else None, shops=len(spots))
        return {"ok": True, "items": items, "ver": getattr(self, "_wish_ver", 0), "sync": self._wish_sync_state(),
                "alerts": self._wish_alerts_on()}

    def _wish_spots(self, x, cache):
        """Where the Cart would buy it: the same lookup the Cart uses."""
        e = {"id": "w" + x["id"], "name": x["name"], "kind": x["kind"], "uuid": x.get("uuid"), "uex_id": x.get("uex_id"),
             "class_name": x.get("class_name") or ""}
        return self._shop_spots(e, cache)

    def wish_add(self, item):
        """Add something: {kind, name, uuid, uex_id, class_name, maker, photo, note, priority}. Already on it:
        brought back (if removed) and left as it is. -> {ok, item, added, count}."""
        if not isinstance(item, dict) or not str(item.get("name") or "").strip():
            return {"ok": False, "error": "Nothing to add"}
        kind = item.get("kind") if item.get("kind") in WISH_KINDS else "other"
        now = int(time.time())
        ms = int(time.time() * 1000)
        new = {k: v for k, v in {
            "id": secrets.token_hex(6), "kind": kind, "name": str(item["name"]).strip()[:120],
            "uuid": str(item.get("uuid") or "")[:40] or None,
            "uex_id": int(item["uex_id"]) if isinstance(item.get("uex_id"), (int, float)) and not isinstance(item.get("uex_id"), bool) else None,
            "class_name": str(item.get("class_name") or "")[:100] or None, "maker": str(item.get("maker") or "")[:60] or None,
            "photo": item.get("photo") if isinstance(item.get("photo"), str) and item["photo"].startswith("https://") else None,
            "note": str(item.get("note") or "")[:300] or None,
            "priority": max(0, min(3, int(item["priority"]))) if isinstance(item.get("priority"), (int, float)) else None,
            "qty": 1, "added": now, "updated": ms}.items() if v is not None}
        w = self._wish()
        have = next((x for x in w["items"] if _same(x, new) and not x.get("deleted")), None)
        if have:
            return {"ok": True, "item": have, "added": False, "count": len(self._wish_live())}
        w["items"].insert(0, new)
        self._wish_changed()
        return {"ok": True, "item": new, "added": True, "count": len(self._wish_live())}

    def wish_has(self, item):
        """Is this already on the list? -> {ok, id or None}."""
        if not isinstance(item, dict):
            return {"ok": True, "id": None}
        probe = {"kind": item.get("kind") if item.get("kind") in WISH_KINDS else "other", "name": item.get("name"),
                 "uuid": item.get("uuid"), "uex_id": item.get("uex_id")}
        have = next((x for x in self._wish_live() if _same(x, probe)), None)
        return {"ok": True, "id": have["id"] if have else None}

    def wish_remove(self, ids):
        """Take entries off (one id or a list): each becomes a removed marker, so other PCs follow."""
        ids = {str(i) for i in (ids if isinstance(ids, list) else [ids]) if i}
        now = int(time.time() * 1000)
        n = 0
        w = self._wish()
        for i, x in enumerate(w["items"]):
            if x.get("id") in ids and not x.get("deleted"):
                w["items"][i] = {"id": x["id"], "deleted": True, "updated": now}
                n += 1
        if n:
            self._wish_changed()
        return {"ok": True, "removed": n, "count": len(self._wish_live())}

    def wish_set(self, item_id, note=None, priority=None, qty=None):
        """Change an entry's note, priority (0-3: how much you want it) or quantity."""
        x = next((x for x in self._wish_live() if x.get("id") == item_id), None)
        if not x:
            return {"ok": False, "error": "That isn't on your wish list any more"}
        if note is not None:
            x["note"] = str(note).strip()[:300] or None
        if priority is not None:
            x["priority"] = max(0, min(3, int(priority)))
        if qty is not None:
            x["qty"] = max(1, min(99, int(qty)))
        x["updated"] = int(time.time() * 1000)
        self._wish_changed()
        return {"ok": True, "item": x}

    def wish_to_cart(self, ids=None, remove=False):
        """Put entries (all of them when ids is None) in the Cart, to buy in game. What no shop sells in game
        (pledge-only ships, loot, rewards) stays on the list. remove: take what went in the Cart off the wish list. -> {ok, added, skipped, left}."""
        want = self._wish_live() if ids is None else [x for x in self._wish_live() if x.get("id") in set(ids)]
        cache, entries, moved, skipped = {}, [], [], []
        for x in want:
            if x.get("kind") not in WISH_CART_KINDS:
                skipped.append({"name": x["name"], "why": "The Cart can't buy this kind of thing"})
                continue
            try:
                spots = self._wish_spots(x, cache)
            except Exception:
                spots = []
            if not spots:
                skipped.append({"name": x["name"], "why": "No ship shop sells it in game: it's pledge-only for now"
                                if x["kind"] == "ship" else "No shop sells it in game: open it to see how to get it"})
                continue
            entries.append({"name": x["name"], "kind": x["kind"], "uuid": x.get("uuid"), "uex_id": x.get("uex_id"),
                            "class_name": x.get("class_name"), "qty": x.get("qty") or 1, "source": "Wish list"})
            moved.append(x["id"])
        r = self.shop_add(entries) if entries else {"ok": True, "added": 0, "left": None}
        if remove and moved:
            self.wish_remove(moved)
        return {"ok": True, "added": len(entries), "skipped": skipped, "left": r.get("left"), "count": len(self._wish_live())}

    def wish_clear(self):
        """Empty the list here and in the account."""
        w = self._wish()
        now = int(time.time() * 1000)
        w["items"] = [{"id": x["id"], "deleted": True, "updated": now} for x in w["items"] if x.get("id") and not x.get("deleted")]
        self._wish_changed()
        return {"ok": True, "count": 0}

    # ---- players selling something on your list. The server checks the Market's item listings against your
    # list (wishlist.py, in the social check-in every 20 s): each listing of something you want comes back once
    # as a notification, and stays on the entry's card while it's up.
    WISH_SEEN_MAX = 600

    def _wish_alerts_on(self):
        return self._settings.get("wish_alerts", True) is not False

    def wish_alerts_set(self, on):
        """Wish list › "Tell me when a player sells one"."""
        self._settings["wish_alerts"] = bool(on)
        self._save_settings()
        return {"ok": True, "on": bool(on)}

    def _wish_market(self):
        """{wish id: [listing]} from the last social check-in."""
        st = (getattr(self, "_soc", None) or {}).get("state") or {}
        return {m["wish"]: m.get("listings") or [] for m in st.get("wish_market") or [] if isinstance(m, dict) and m.get("wish")} \
            if st.get("status") == "ok" else {}

    def _wish_market_notes(self, r):
        """New listings of things on your list, from a social check-in: notifications, each listing once."""
        found = [(m, l) for m in r.get("wish_market") or [] if isinstance(m, dict)
                 for l in m.get("listings") or [] if isinstance(l, dict) and l.get("id")]
        if not found:
            return []
        w = self._wish()
        seen = list(w.get("market_seen") or [])
        have = set(seen)
        new = [(m, l) for m, l in found if l["id"] not in have]
        if not new:
            return []
        w["market_seen"] = (seen + [l["id"] for _, l in new])[-self.WISH_SEEN_MAX:]
        self._save_settings()
        if not self._wish_alerts_on():
            return []
        return [{"wish": True, "name": m.get("name"), "title": l.get("title"), "price": l.get("price"), "listing": l["id"]}
                for m, l in new[:3]]

    # ---- keeping it with the account
    def _wish_sync_state(self):
        w = self._wish()
        signed = bool(self._account_token())
        return {"signed_in": signed, "at": w.get("synced_at"), "error": w.get("sync_error") if signed else None,
                "busy": bool(getattr(self, "_wish_syncing", False))}

    def _wish_sync_soon(self):
        if not self._account_token():
            return
        t = getattr(self, "_wish_timer", None)
        if t:
            t.cancel()
        self._wish_timer = threading.Timer(self.WISH_SYNC_WAIT, self._wish_sync)
        self._wish_timer.daemon = True
        self._wish_timer.start()

    def wish_sync_now(self):
        """Send and fetch now (the list also syncs by itself: on every change, at sign-in and every minute or so). -> wish_list()."""
        self._wish_sync()
        return self.wish_list()

    def _wish_sync(self):
        tok = self._account_token()
        if not tok or not getattr(self, "_community", None):
            return
        lock = self.__dict__.setdefault("_wish_lock", threading.Lock())
        if not lock.acquire(blocking=False):
            return
        self._wish_syncing = True
        try:
            sent = json.loads(json.dumps(self._wish()["items"]))
            r = self._community.wishlist_sync(tok, sent)
            w = self._wish()
            if r.get("status") == "ok" and isinstance(r.get("items"), list):
                # anything changed here while the list was on its way is put together with the server's answer too
                w["items"] = wish_merge(r["items"], w["items"])
                w["synced_at"] = int(time.time())
                w.pop("sync_error", None)
                self._wish_ver = getattr(self, "_wish_ver", 0) + 1
            elif r.get("status") in ("not_found", "http_404", "off"):
                w["sync_error"] = "The Quantum server doesn't keep wish lists yet, so it's on this PC only for now."
            elif r.get("status") == "signed_out":
                w["sync_error"] = "You were signed out of your Quantum account."
            else:
                w["sync_error"] = r.get("message") or "Couldn't reach the Quantum server. It'll try again with your next change."
            self._save_settings()
        except Exception as e:
            print("wish list sync:", e, flush=True)
        finally:
            self._wish_syncing = False
            lock.release()
