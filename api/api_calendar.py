"""Api, part of: Your own calendar (the Org page's month view, with your orgs' events).

A mixin of app.py's Api (class Api(... CalendarMixin ...)): the methods are the Api's, `self` is the one Api.
Module-level names come from qbase.py.

What you plan for yourself: a mining run, a meet-up, a reminder. Kept in settings.json and, while you're signed
in to your Quantum account, with the account too (server: mycalendar.py), so it's the same on every PC. Synced
like the wish list: every entry carries the time it last changed, a sync sends the whole calendar and the newer
change of each entry wins; a deleted entry stays as a marker for a while so another PC doesn't bring it back.
Reminders are shown by the page (a note in the app) and as a Windows notification (calendar_notify)."""
from qbase import *  # noqa: F401,F403

CAL_KINDS = ("personal", "mission", "trade", "mining", "salvage", "combat", "social", "reminder", "other")
CAL_REPEAT = ("none", "daily", "weekly", "monthly")
CAL_TOMBSTONE = 60 * 86400


def cal_merge(a, b, now=None):
    """Two calendars put together: per id the newer change wins. The same rule as the server's."""
    now = now or time.time()
    out = {}
    for x in list(a or []) + list(b or []):
        if not isinstance(x, dict) or not x.get("id"):
            continue
        have = out.get(x["id"])
        u, hu = x.get("updated") or 0, (have or {}).get("updated") or 0
        if have is None or u > hu or (u == hu and x.get("deleted") and not have.get("deleted")):
            out[x["id"]] = x
    return [x for x in out.values() if not (x.get("deleted") and (x.get("updated") or 0) / 1000 < now - CAL_TOMBSTONE)]


def _num(v, lo=None, hi=None):
    try:
        v = float(v)
    except (TypeError, ValueError):
        return None
    if v != v:
        return None
    if lo is not None:
        v = max(lo, v)
    if hi is not None:
        v = min(hi, v)
    return v


class CalendarMixin:
    CAL_SYNC_WAIT = 3           # s after the last change before the calendar is sent
    CAL_SYNC_EVERY = 90         # s: opening the calendar asks the account for other PCs' changes at most this often

    def _cal(self):
        c = self._settings.setdefault("calendar", {})
        if not isinstance(c.get("items"), list):
            c["items"] = []
        return c

    def _cal_live(self):
        return [x for x in self._cal()["items"] if not x.get("deleted")]

    def _cal_changed(self):
        self._cal_ver = getattr(self, "_cal_ver", 0) + 1
        self._save_settings()
        self._cal_sync_soon()

    def calendar_list(self):
        """{ok, items, ver, sync: {signed_in, at, error, busy}}. Asks the account for changes now and then."""
        c = self._cal()
        if self._account_token() and time.time() - (c.get("synced_at") or 0) > self.CAL_SYNC_EVERY \
                and not getattr(self, "_cal_syncing", False):
            threading.Thread(target=self._cal_sync, daemon=True).start()
        signed = bool(self._account_token())
        return {"ok": True, "items": sorted(self._cal_live(), key=lambda x: x.get("starts") or 0),
                "ver": getattr(self, "_cal_ver", 0),
                "sync": {"signed_in": signed, "at": c.get("synced_at"), "error": c.get("sync_error") if signed else None,
                         "busy": bool(getattr(self, "_cal_syncing", False))}}

    def calendar_save(self, e):
        """Add an entry, or change one (same id). -> {ok, item} | {ok: False, error}."""
        if not isinstance(e, dict):
            return {"ok": False, "error": "Nothing to save"}
        title = str(e.get("title") or "").strip()[:80]
        starts = _num(e.get("starts"))
        if not title:
            return {"ok": False, "error": "Give it a title"}
        if starts is None or not (946684800 <= starts <= 4102444800):
            return {"ok": False, "error": "Pick a date and time"}
        until = _num(e.get("until"))
        color = str(e.get("color") or "")
        system = e.get("system") if e.get("system") in ("Stanton", "Pyro", "Nyx") else None
        rid = str(e.get("id") or "")
        old = next((x for x in self._cal()["items"] if x.get("id") == rid), None) if rid else None
        item = {k: v for k, v in {
            "id": rid if old else secrets.token_hex(6), "title": title, "starts": int(starts),
            "minutes": int(_num(e.get("minutes"), 5, 2880) or 60), "all_day": bool(e.get("all_day")) or None,
            "kind": e.get("kind") if e.get("kind") in CAL_KINDS else "personal",
            "place": str(e.get("place") or "").strip()[:80] or None, "system": system,
            "notes": str(e.get("notes") or "").strip()[:1000] or None,
            "color": color if re.fullmatch(r"#[0-9a-fA-F]{6}", color) else None,
            "remind": int(_num(e.get("remind"), 0, 10080)) if e.get("remind") not in (None, "", "none") else None,
            "repeat": e.get("repeat") if e.get("repeat") in CAL_REPEAT and e.get("repeat") != "none" else None,
            "until": int(until) if until and until > starts else None,
            "done": bool(e.get("done")) or None,
            "updated": int(time.time() * 1000)}.items() if v is not None}
        items = self._cal()["items"]
        if old:
            items[items.index(old)] = item
        else:
            if len(self._cal_live()) >= 1000:
                return {"ok": False, "error": "Your calendar is full (1,000 entries). Delete some old ones first."}
            items.append(item)
        self._cal_changed()
        return {"ok": True, "item": item}

    def calendar_delete(self, eid):
        items = self._cal()["items"]
        for i, x in enumerate(items):
            if x.get("id") == eid and not x.get("deleted"):
                items[i] = {"id": eid, "deleted": True, "updated": int(time.time() * 1000)}
                self._cal_changed()
                return {"ok": True}
        return {"ok": False, "error": "That isn't on your calendar any more"}

    def calendar_notify(self, title, text):
        """A reminder from the page, as a Windows notification too (the page shows its own note)."""
        notify = getattr(self, "_notify", None)
        if notify:
            try:
                notify(str(title or "Quantum")[:60], str(text or "")[:250])
            except Exception as e:
                print("calendar notification:", e, flush=True)
        return {"ok": True}

    def calendar_sync_now(self):
        self._cal_sync()
        return self.calendar_list()

    def _cal_sync_soon(self):
        if not self._account_token():
            return
        t = getattr(self, "_cal_timer", None)
        if t:
            t.cancel()
        self._cal_timer = threading.Timer(self.CAL_SYNC_WAIT, self._cal_sync)
        self._cal_timer.daemon = True
        self._cal_timer.start()

    def _cal_sync(self):
        tok = self._account_token()
        if not tok or not getattr(self, "_community", None):
            return
        lock = self.__dict__.setdefault("_cal_lock", threading.Lock())
        if not lock.acquire(blocking=False):
            return
        self._cal_syncing = True
        try:
            sent = json.loads(json.dumps(self._cal()["items"]))
            r = self._community.calendar_sync(tok, sent)
            c = self._cal()
            if r.get("status") == "ok" and isinstance(r.get("items"), list):
                c["items"] = cal_merge(r["items"], c["items"])      # changes made while it was on its way stay
                c["synced_at"] = int(time.time())
                c.pop("sync_error", None)
                self._cal_ver = getattr(self, "_cal_ver", 0) + 1
            elif r.get("status") in ("not_found", "http_404", "off"):
                c["sync_error"] = "The Quantum server doesn't keep calendars yet, so yours is on this PC only for now."
            elif r.get("status") == "signed_out":
                c["sync_error"] = "You were signed out of your Quantum account."
            else:
                c["sync_error"] = r.get("message") or "Couldn't reach the Quantum server. It'll try again with your next change."
            self._save_settings()
        except Exception as e:
            print("calendar sync:", e, flush=True)
        finally:
            self._cal_syncing = False
            lock.release()
