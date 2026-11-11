"""Commodity price watchlist and alerts.

You pick a commodity, which price to watch (what terminals sell it for, or what they pay for it), and a low
and/or high mark. Quantum checks UEX's prices (with Quantum datarunners' newer reports laid over them) every few
minutes and tells you when any terminal reaches a mark: a note in the app, a Windows notification, and a line
in Settings > Log. Each terminal alerts once when it gets there and again only after it has gone back past the
mark, so a price that sits at your mark doesn't keep alerting.

Kept in settings.json under "watchlist": {"items": [watch, ...], "fired": {"<watch>|<terminal>|<low/high>": price}}.
A watch: {id, id_commodity, name, side: "buy" | "sell", low, high, system, max_age_h, on, created}.
  side "buy":  what terminals SELL it for (the price you buy at). A low mark is the usual one: "tell me when it's cheap".
  side "sell": what terminals BUY it for (the price you sell at). A high mark is the usual one: "tell me when it pays".
"""
import secrets
import threading
import time

import uex

WATCH_EVERY = 300            # seconds between checks (UEX's price list itself is cached for 30 minutes)
WATCH_MAX = 50               # watches you can keep
AGE_CHOICES = (24, 72, 168, 0)   # "Prices reported within": a day, 3 days, a week, any age (0)


class WatchMixin:
    # ---------------------------------------------------------------- storage
    def _watch_cfg(self):
        w = self._settings.setdefault("watchlist", {})
        w.setdefault("items", [])
        w.setdefault("fired", {})
        return w

    @staticmethod
    def _watch_num(v):
        """A price mark from the page: a positive number, or None for no mark."""
        try:
            v = float(str(v).replace(",", "").strip()) if v not in (None, "") else None
        except ValueError:
            return None
        return round(v, 2) if v and v > 0 else None

    def _watch_clean(self, w):
        side = "sell" if w.get("side") == "sell" else "buy"
        low, high = self._watch_num(w.get("low")), self._watch_num(w.get("high"))
        if low and high and low > high:
            low, high = high, low
        try:
            age = int(w.get("max_age_h", 72))
        except (TypeError, ValueError):
            age = 72
        system = w.get("system") if w.get("system") in uex.SYSTEMS else ""
        return {"id": str(w.get("id") or secrets.token_hex(4)), "id_commodity": int(w["id_commodity"]),
                "name": str(w.get("name") or "")[:80], "side": side, "low": low, "high": high, "system": system,
                "max_age_h": age if age in AGE_CHOICES else 72, "on": w.get("on", True) is not False,
                "created": int(w.get("created") or time.time())}

    # ---------------------------------------------------------------- what the page calls
    def watch_list(self):
        """Your watches with where each stands now: {ok, items: [watch + {best, hits}], checked, error}."""
        cfg = self._watch_cfg()
        got = getattr(self, "_watch_last", None) or {}
        items = [dict(w, best=(got.get("best") or {}).get(w["id"]), hits=(got.get("hits") or {}).get(w["id"], []))
                 for w in cfg["items"]]
        return {"ok": True, "items": items, "checked": got.get("at"), "error": got.get("error"),
                "token": bool(self._uex.token), "every": WATCH_EVERY}

    def watch_save(self, w):
        """Add a watch, or change one (same id). Needs a commodity and at least one mark."""
        try:
            w = self._watch_clean(w or {})
        except (KeyError, TypeError, ValueError):
            return {"ok": False, "error": "Pick a commodity first"}
        if not w["low"] and not w["high"]:
            return {"ok": False, "error": "Set a low price, a high price, or both"}
        cfg = self._watch_cfg()
        old = next((x for x in cfg["items"] if x["id"] == w["id"]), None)
        if old:
            w["created"] = old.get("created", w["created"])
            cfg["items"] = [w if x["id"] == w["id"] else x for x in cfg["items"]]
            self._watch_forget(w["id"])                  # new marks: alert afresh
        else:
            if len(cfg["items"]) >= WATCH_MAX:
                return {"ok": False, "error": f"You can keep up to {WATCH_MAX} price alerts"}
            cfg["items"].append(w)
        self._save_settings()
        self._watch_kick()
        return dict(self.watch_list(), saved=w["id"])

    def watch_delete(self, wid):
        cfg = self._watch_cfg()
        cfg["items"] = [x for x in cfg["items"] if x["id"] != wid]
        self._watch_forget(wid)
        self._save_settings()
        return self.watch_list()

    def watch_toggle(self, wid, on):
        for x in self._watch_cfg()["items"]:
            if x["id"] == wid:
                x["on"] = bool(on)
        if not on:
            self._watch_forget(wid)
        self._save_settings()
        self._watch_kick()
        return self.watch_list()

    def watch_check_now(self):
        """Check every watch now (the page's Check now). Alerts as usual."""
        self._watch_run(notify=True)
        return self.watch_list()

    # ---------------------------------------------------------------- checking
    def _watch_forget(self, wid):
        fired = self._watch_cfg()["fired"]
        for k in [k for k in fired if k.split("|", 1)[0] == wid]:
            fired.pop(k, None)

    def _watch_kick(self):
        """Check soon in the background (after a watch was added or changed), and make sure the loop runs."""
        if not getattr(self, "_watch_started", False):
            self._watch_started = True
            threading.Thread(target=self._watch_loop, daemon=True, name="price-watch").start()
        ev = getattr(self, "_watch_wake", None)
        if ev:
            ev.set()

    def _watch_loop(self):
        self._watch_wake = threading.Event()
        time.sleep(20)                                   # let start-up (prices, sign-in) settle first
        while True:
            try:
                if any(w.get("on", True) for w in self._watch_cfg()["items"]) and self._uex.token:
                    self._watch_run(notify=True)
            except Exception as e:
                print("price watch:", e, flush=True)
            self._watch_wake.wait(WATCH_EVERY)
            self._watch_wake.clear()

    def _watch_prices(self):
        """[(terminal id, terminal, row)] for every commodity price row, newest report per side."""
        terms = self._uex.terminals()
        rows, at = self._uex.get("commodities_prices_all")
        try:
            rows = self._community.overlay(rows)         # newer reports from Quantum datarunners
        except Exception:
            pass
        return [(r.get("id_terminal"), terms.get(r.get("id_terminal")), r) for r in rows], at

    def _watch_run(self, notify=True):
        lock = self.__dict__.setdefault("_watch_lock", threading.Lock())
        if not lock.acquire(blocking=False):
            return                                       # a check is already running
        try:
            self._watch_run_locked(notify)
        finally:
            lock.release()

    def _watch_run_locked(self, notify):
        cfg = self._watch_cfg()
        watches = [w for w in cfg["items"] if w.get("on", True)]
        try:
            rows, at = self._watch_prices() if watches else ([], None)
            places = self._uex.place_map(self._db.locations) if watches else {}
        except uex.UexError as e:
            self._watch_last = dict(getattr(self, "_watch_last", None) or {}, error=str(e), at=time.time())
            return
        now = time.time()
        best, hits, new = {}, {}, []
        live_keys = set()
        for w in watches:
            key = "price_buy" if w["side"] == "buy" else "price_sell"
            seen = []
            for tid, t, r in rows:
                if r.get("id_commodity") != w["id_commodity"] or not t or not uex.is_live(t):
                    continue
                price = r.get(key) or 0
                if price <= 0:
                    continue
                if w["system"] and t.get("star_system_name") != w["system"]:
                    continue
                when = self._side_at(r, w["side"])
                if w["max_age_h"] and when and now - when > w["max_age_h"] * 3600:
                    continue                             # too old to trust for an alert
                seen.append({"tid": tid, "price": price, "where": uex.where(t), "system": t.get("star_system_name"),
                             "place": places.get(tid), "updated": when or None,
                             "community": bool(r.get(f"community_{w['side']}"))})
            if seen:
                # the best one for you: cheapest to buy from, or best paying to sell to
                b = min(seen, key=lambda x: x["price"]) if w["side"] == "buy" else max(seen, key=lambda x: x["price"])
                best[w["id"]] = {k: b[k] for k in ("price", "where", "system", "place", "updated")}
            mine = []
            for s in seen:
                for kind, mark, ok in (("low", w["low"], w["low"] and s["price"] <= w["low"]),
                                       ("high", w["high"], w["high"] and s["price"] >= w["high"])):
                    if not ok:
                        continue
                    fk = f"{w['id']}|{s['tid']}|{kind}"
                    live_keys.add(fk)
                    mine.append(dict(s, kind=kind, mark=mark))
                    if fk not in cfg["fired"]:
                        cfg["fired"][fk] = s["price"]
                        new.append((w, dict(s, kind=kind, mark=mark)))
            mine.sort(key=lambda x: x["price"], reverse=w["side"] == "sell")
            hits[w["id"]] = mine[:25]
        # A terminal that went back past the mark (or a watch that's gone): it can alert again next time
        changed = bool(new)
        for fk in list(cfg["fired"]):
            if fk not in live_keys:
                cfg["fired"].pop(fk, None)
                changed = True
        self._watch_last = {"at": now, "prices_at": at, "best": best, "hits": hits, "error": None}
        if changed:
            self._save_settings()
        if new and notify:
            self._watch_alert(new)

    def _watch_alert(self, new):
        """Tell you: one line per watch (the best terminal, and how many more), as a note in the app, a Windows
        notification and a line in Settings > Log."""
        by = {}
        for w, s in new:
            by.setdefault((w["id"], s["kind"]), (w, []))[1].append(s)
        lines = []
        for (_, kind), (w, L) in by.items():
            L.sort(key=lambda x: x["price"], reverse=(kind == "high"))
            top = L[0]
            verb = ("sells for" if w["side"] == "buy" else "buys for")
            more = f" (+{len(L) - 1} more)" if len(L) > 1 else ""
            mark = w["low"] if kind == "low" else w["high"]
            lines.append(f"{w['name']} {verb} {top['price']:,.0f} aUEC at {top['where']}"
                         f" ({'at or below' if kind == 'low' else 'at or above'} your {mark:,.0f}){more}")
        text = "; ".join(lines)
        n = (getattr(self, "_watch_note", None) or {}).get("n", 0) + 1
        self._watch_note = {"n": n, "text": "Price alert: " + text, "at": time.time(), "count": len(new)}
        try:
            self._sender._event("Price alert: " + text)
        except Exception:
            pass
        notify = getattr(self, "_notify", None)
        if notify:
            try:
                notify("Quantum price alert", "\n".join(lines)[:250])
            except Exception as e:
                print("price alert notification:", e, flush=True)

    def _watch_live(self):
        """For get_live: whether there's a new alert to show, and how many terminals are at a mark now."""
        got = getattr(self, "_watch_last", None) or {}
        return {"note": getattr(self, "_watch_note", None),
                "hits": sum(len(v) for v in (got.get("hits") or {}).values()),
                "n": len(self._watch_cfg()["items"])}
