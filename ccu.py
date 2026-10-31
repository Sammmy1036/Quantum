"""Ship upgrades (CCUs): the cheapest chain of upgrades from a ship you have to the one you want.

The prices come live from RSI's own upgrade tool (the same API its "Ship upgrades" page uses): every
ship's value (msrp) and the upgrade editions that lead to it ("Standard Edition", "Warbond Edition", ...),
each with its price and whether it's on sale now. The Star Citizen Wiki API
(api.star-citizen.wiki/api/shipmatrix/vehicles) adds each ship's maker and status. The wiki keeps a copy of
RSI's upgrade list too, but never takes old ones out: a Warbond upgrade from a sale years ago, or one priced
before the ship's price went up, still shows as on sale there. So when RSI can't be reached, the wiki's copy
is used only for straight upgrades at the ship's current value, and no Warbond ones.

How RSI prices an upgrade: what the edition costs, less the value of the ship you upgrade from.
A Warbond edition costs less than the ship is worth, so stepping through ships that have one
saves money compared with a straight upgrade. Every step must go up in value. Warbond upgrades
need new money (no store credit).
"""
import http.cookiejar
import json
import re
import threading
import time
import urllib.error
import urllib.parse
import urllib.request
from pathlib import Path

API = "https://api.star-citizen.wiki/api/shipmatrix/vehicles"
UA = {"User-Agent": "Quantum (Star Citizen route planner; github.com/Sammmy1036/Quantum)"}
STALE = 6 * 3600                 # sales change daily: a fresh list after 6 hours
IMPOUND = "https://theimpound.com/search?q="
RSI = "https://robertsspaceindustries.com"
GQL_PATHS = ("/pledge-store/api/upgrade/graphql", "/pledge-store/api/upgrade/v2/graphql")
FROM_STALE = 6 * 3600            # which ships RSI lets you upgrade from, per upgrade: asked again after 6 hours
FROM_BUDGET = 60                 # at most this many "which ships can upgrade to this?" questions per path
SHIPS_Q = """query initShipUpgrade {
  ships {
    id
    name
    msrp
    link
    %s
    skus {
      id
      title
      available
      price
    }
  }
}"""
FROM_Q = """query filterShips($toId: Int, $fromFilters: [FilterConstraintValues]) {
  from(to: $toId, filters: $fromFilters) {
    ships {
      id
    }
  }
}"""
PRICE_Q = """query getPrice($from: Int!, $to: Int!) {
  price(from: $from, to: $to) {
    amount
    nativeAmount
  }
}"""


class RsiError(Exception):
    pass


class NotSold(RsiError):
    """RSI's "Ship not found": an edition its upgrade tool doesn't sell now, from any ship. An answer, not a failure."""


NOT_SOLD = re.compile(r"not found", re.I)


class Rsi:
    """RSI's upgrade tool, asked the way its own Ship Upgrades page asks, as a guest (no RSI account):
    a security token from an RSI page, a guest token, an upgrade context, then its GraphQL queries.
      ships()           every ship's value and the upgrade editions to it (RSI's "available" there means the
                        edition exists, not that you can buy it from your ship)
      from_ids(sku)     the ships RSI lets you upgrade from to that edition: what its "Ship you want" list uses
      price(ship, sku)  RSI's own price for that upgrade
    One request at a time, a moment apart, so Quantum is never a burden on RSI."""
    GAP = 0.25

    def __init__(self, timeout=30):
        self.timeout = timeout
        self._lock = threading.Lock()
        self._op = None
        self._last = 0
        self._path = None

    def _hdr(self, json_body=True):
        h = {**UA, "Accept": "application/json", "Origin": RSI, "Referer": RSI + "/pledge/ship-upgrades"}
        if json_body:
            h["Content-Type"] = "application/json"
        tok = next((c.value for c in self._jar if c.name == "Rsi-Token"), None)
        if tok:
            h["X-Rsi-Token"] = urllib.parse.unquote(tok)
        if self._csrf:
            h["X-CSRF-TOKEN"] = self._csrf
        return h

    def _send(self, path, body=None, method="POST"):
        wait = self._last + self.GAP - time.time()
        if wait > 0:
            time.sleep(wait)
        self._last = time.time()
        data = json.dumps(body).encode("utf-8") if body is not None else None
        req = urllib.request.Request(RSI + path, data=data, headers=self._hdr(body is not None), method=method)
        try:
            with self._op.open(req, timeout=self.timeout) as r:
                text = r.read().decode("utf-8", "replace")
        except urllib.error.HTTPError as e:
            raise RsiError(f"{path}: HTTP {e.code}") from None
        return text

    def _start(self):
        self._jar = http.cookiejar.CookieJar()
        self._op = urllib.request.build_opener(urllib.request.HTTPCookieProcessor(self._jar))
        self._csrf = None
        try:
            page = self._send("/en/pledge", method="GET")
            m = re.search(r"<meta[^>]+name=[\"']csrf-token[\"'][^>]*>", page, re.I)
            v = m and re.search(r"content=[\"']([^\"']+)[\"']", m.group(0))
            self._csrf = v.group(1) if v else None
        except Exception as e:
            print("ccu rsi page:", e, flush=True)
        self._send("/api/account/v2/setAuthToken", {})
        self._send("/api/ship-upgrades/setContextToken", {})

    def context(self, **ids):
        """Tell RSI which upgrade we're looking at (fromShipId, toShipId, toSkuId), as its page does."""
        with self._lock:
            if not self._op:
                self._start()
            self._send("/api/ship-upgrades/setContextToken", {k: int(v) for k, v in ids.items() if v})

    def gql(self, op, query, variables=None):
        with self._lock:
            if not self._op:
                self._start()
            body = {"operationName": op, "variables": variables or {}, "query": query}
            err = None
            for path in ([self._path] if self._path else GQL_PATHS):
                try:
                    r = json.loads(self._send(path, body) or "{}")
                except (RsiError, ValueError) as e:
                    err = e
                    continue
                if isinstance(r, list):
                    r = r[0] if r else {}
                self._path = path                    # it answered in GraphQL: the right address
                if r.get("errors"):
                    msg = "; ".join(str((x or {}).get("message")) for x in r["errors"])[:300]
                    raise (NotSold if NOT_SOLD.search(msg) else RsiError)(f"{op}: {msg}")
                return r.get("data") or {}
            raise err or RsiError(f"{op}: no answer")

    def ships(self):
        try:
            d = self.gql("initShipUpgrade", SHIPS_Q % "flyableStatus")
        except RsiError:
            d = self.gql("initShipUpgrade", SHIPS_Q % "")
        cents = lambda x: (_num(x) or 0) / 100
        out = []
        for x in d.get("ships") or []:
            msrp = cents(x.get("msrp"))
            if not x.get("name") or not msrp:
                continue
            link = x.get("link")
            out.append({"id": int(x["id"]), "name": str(x["name"]).strip(), "msrp": msrp, "flyable": x.get("flyableStatus"),
                        "link": (RSI + link if link and link.startswith("/") else link),
                        "skus": [{"id": int(s["id"]) if s.get("id") else None, "title": str(s.get("title") or "Upgrade").strip(),
                                  "price": cents(s.get("price")), "available": bool(s.get("available")),
                                  "warbond": is_warbond(s.get("title"))}
                                 for s in x.get("skus") or [] if cents(s.get("price"))]})
        if not out:
            raise RsiError("RSI's upgrade tool sent no ships")
        return out

    def from_ids(self, sku_id):
        """{ship ids} RSI lets you upgrade from to this edition."""
        q = lambda: self.gql("filterShips", FROM_Q, {"toId": int(sku_id), "fromFilters": []})
        try:
            d = q()
        except NotSold:
            return set()                         # nobody can upgrade to it
        except RsiError:
            self.context(toSkuId=sku_id)         # some other refusal: once more with RSI told what we're looking at
            try:
                d = q()
            except NotSold:
                return set()
        ships = (d.get("from") or {}).get("ships")
        if ships is None:
            raise RsiError(f"filterShips: no list for {sku_id}")
        return {int(x["id"]) for x in ships if x and x.get("id")}

    def price(self, from_id, sku_id):
        """RSI's price in dollars for upgrading ship from_id to edition sku_id."""
        q = lambda: self.gql("getPrice", PRICE_Q, {"from": int(from_id), "to": int(sku_id)})
        try:
            d = q()
        except NotSold:
            raise
        except RsiError:
            self.context(fromShipId=from_id, toSkuId=sku_id)
            d = q()
        p = d.get("price") or {}
        if not isinstance(p.get("amount"), (int, float)):
            raise RsiError(f"getPrice: no price for {from_id} -> {sku_id}")
        return p["amount"] / 100


def _get(url, timeout=40):
    with urllib.request.urlopen(urllib.request.Request(url, headers=UA), timeout=timeout) as r:
        return json.loads(r.read().decode("utf-8"))


def _num(x):
    try:
        n = float(x)
    except (TypeError, ValueError):
        return None
    return n if n > 0 else None


def _txt(x):
    """A translated field ({"en_EN": "..."}, a list of those, or a plain string) as plain text."""
    if isinstance(x, dict):
        return str(x.get("en_EN") or next(iter(x.values()), "") or "")
    return str(x or "")


def is_warbond(title):
    return "warbond" in str(title or "").lower()


def key(name):
    """A ship name for matching across sources: lower case, letters and digits only."""
    return " ".join(re.findall(r"[a-z0-9]+", str(name or "").lower()))


def ship_row(d):
    """One ship-matrix record -> what the upgrade planner needs, or None for one with no value."""
    msrp = _num(d.get("msrp"))
    name = str(d.get("name") or "").strip()
    if not name or not msrp:
        return None
    skus = []
    for s in d.get("skus") or []:
        if s.get("is_package"):                            # a game package, not an upgrade
            continue
        price = _num(s.get("discounted_price")) or _num(s.get("price"))
        if not price:
            continue
        skus.append({"title": str(s.get("title") or "Upgrade").strip(), "price": price,
                     "available": bool(s.get("available")), "warbond": is_warbond(s.get("title")) or bool(s.get("is_warbond"))})
    maker = d.get("manufacturer") or {}
    return {"id": d.get("id"), "name": name, "slug": d.get("slug"), "msrp": msrp,
            "maker": str(maker.get("name") or "") if isinstance(maker, dict) else str(maker),
            "status": _txt(d.get("production_status")), "store": d.get("pledge_url"), "skus": skus}


class Ccu:
    def __init__(self, cache_dir):
        self.file = Path(cache_dir) / "ccu_ships.json"
        self._ships = None
        self._busy = False
        self._lock = threading.Lock()
        self.source = None                  # "rsi" (live) or "wiki" (RSI couldn't be reached)
        self._rsi = Rsi()
        self.from_file = Path(cache_dir) / "ccu_from.json"
        self._from = None                    # {sku id: (asked at, [ship ids])}
        self._warming = False
        self._prices = {}                    # {(ship id, sku id): (asked at, price)}

    # ------------------------------------------------------------ the data
    def _fetch(self):
        """Live prices from RSI, with each ship's maker and status from the wiki. Without RSI: the wiki's copy,
        cleaned (straight upgrades at the ship's current value only). Saved with where it came from."""
        try:
            wiki = self._fetch_wiki()
        except Exception as e:
            print("ccu wiki:", e, flush=True)
            wiki = {}
        try:
            live = self._rsi.ships()
        except Exception as e:
            print("ccu rsi:", e, flush=True)
            live = None
        if live:
            out, seen = [], set()
            for d in live:
                w = wiki.get(d["id"]) or next((x for x in wiki.values() if key(x["name"]) == key(d["name"])), None) or {}
                seen.add(w.get("id"))
                out.append({"id": d["id"], "name": w.get("name") or d["name"], "slug": w.get("slug"), "msrp": d["msrp"],
                            "maker": w.get("maker") or "", "status": w.get("status") or "",
                            "store": d.get("link") or w.get("store"), "skus": d["skus"]})
            # Ships RSI's tool doesn't list (nothing upgrades to them) can still be the ship you have
            out += [dict(w, skus=[]) for w in wiki.values() if w.get("id") not in seen]
            source = "rsi"
        elif wiki:
            out = [dict(w, skus=[s for s in w["skus"] if not s["warbond"] and abs(s["price"] - w["msrp"]) < 0.5])
                   for w in wiki.values()]
            source = "wiki"
        else:
            raise RuntimeError("couldn't reach RSI or the Star Citizen Wiki")
        ships = sorted(out, key=lambda r: (r["msrp"], r["name"]))
        self.file.parent.mkdir(exist_ok=True)
        self.file.write_text(json.dumps({"v": 3, "at": time.time(), "ships": ships, "source": source}), encoding="utf-8")
        self.source = source
        return ships

    def _fetch_wiki(self):
        out, page = {}, 1
        while page <= 20:
            # JSON:API paging only: a plain "page=" too would overwrite page[...] on the server (PHP)
            q = urllib.parse.urlencode({"page[size]": 200, "page[number]": page})
            data = _get(f"{API}?{q}")
            rows = data.get("data") or []
            before = len(out)
            for d in rows:
                r = ship_row(d)
                if r:
                    out[r["id"] or r["name"]] = r
            last = (data.get("meta") or {}).get("last_page")
            if not rows or len(out) == before or (last and page >= int(last)):
                break
            page += 1
        if not out:
            raise RuntimeError("the Star Citizen Wiki sent no ships")
        return out

    def ships(self, wait=False):
        """(ships, fetched_at, error). Cached for STALE; an old copy is returned while a new one is fetched
        in the background. wait: fetch right away when there's no copy at all."""
        try:
            cached = json.loads(self.file.read_text(encoding="utf-8"))
        except Exception:
            cached = None
        if cached and (cached.get("source") not in ("rsi", "wiki") or cached.get("v") != 3):
            cached = None                     # saved by an earlier version (no RSI edition ids)
        if self._ships is None and cached:
            self._ships = cached.get("ships") or []
            self.source = cached.get("source")
        at = (cached or {}).get("at") or 0
        if cached is None and wait:
            with self._lock:
                try:
                    self._ships = self._fetch()
                    return self._ships, time.time(), None
                except Exception as e:
                    return [], 0, str(e)
        # Wiki's copy only (RSI was down or blocked): RSI is tried again after 30 minutes
        if time.time() - at > (STALE if self.source == "rsi" else 1800) and not self._busy:
            self._busy = True

            def bg():
                try:
                    with self._lock:
                        self._ships = self._fetch()
                except Exception as e:
                    print("ccu refresh:", e, flush=True)
                finally:
                    self._busy = False
            threading.Thread(target=bg, daemon=True).start()
        return self._ships or [], at, None

    # ------------------------------------------------------------ RSI's checks
    def _from_cache(self):
        if self._from is None:
            try:
                self._from = {int(k): v for k, v in json.loads(self.from_file.read_text(encoding="utf-8")).items()}
            except Exception:
                self._from = {}
        return self._from

    def eligible(self, sku_ids, budget=FROM_BUDGET):
        """{sku id: {ship ids RSI lets you upgrade from}} for these editions, asking RSI about the ones not
        asked in the last FROM_STALE (at most budget questions; editions left over, or RSI refused, are
        missing, and so never used)."""
        cache, out, asked = self._from_cache(), {}, 0
        for sid in dict.fromkeys(i for i in sku_ids if i):
            hit = cache.get(sid)
            if hit and time.time() - hit[0] < FROM_STALE:
                out[sid] = set(hit[1])
                continue
            if asked >= budget:
                continue
            asked += 1
            try:
                ids = self._rsi.from_ids(sid)
            except Exception as e:
                print("ccu from:", sid, e, flush=True)
                continue
            cache[sid] = (time.time(), sorted(ids))
            out[sid] = ids
            if asked % 10 == 0:
                self._save_from()
        if asked:
            self._save_from()
        return out

    def _price(self, from_id, sku_id):
        """RSI's price for one upgrade, remembered for an hour (the same steps come up again and again)."""
        k, hit = (from_id, sku_id), self._prices.get((from_id, sku_id))
        if hit and time.time() - hit[0] < 3600:
            return hit[1]
        p = round(self._rsi.price(from_id, sku_id), 2)
        self._prices[k] = (time.time(), p)
        return p

    def _save_from(self):
        try:
            self.from_file.write_text(json.dumps({str(k): v for k, v in list(self._from_cache().items())}), encoding="utf-8")
        except OSError:
            pass

    def _candidates(self, ships, warbond=True):
        """Every edition that could be part of a chain: the ones that cost less than the ship is worth."""
        return [o.get("id") for s in sorted(ships, key=lambda s: s["msrp"])
                for o in offers(s, warbond) if o["price"] < s["msrp"] - 0.5]

    def warm(self):
        """In the background, as soon as the Upgrades tab opens: ask RSI about every sale edition, so by the time
        both ships are picked most answers are already here (kept FROM_STALE, so usually once a day)."""
        if self._warming or self.source != "rsi":
            return
        self._warming = True

        def bg():
            try:
                self.eligible(self._candidates(self._ships or []), budget=400)
            except Exception as e:
                print("ccu warm:", e, flush=True)
            finally:
                self._warming = False
        threading.Thread(target=bg, daemon=True).start()

    def path(self, src, dst, warbond=True):
        """best_path, with only the upgrades RSI's own tool offers from each ship, and RSI's own price for
        every step. With the wiki's copy (RSI unreachable): straight upgrades at current value, unchecked."""
        ships, _, err = self.ships(wait=True)
        r = best_path(ships, src, dst, warbond)                 # the quick checks (same ship, downgrade, none on sale)
        if self.source != "rsi" or (not r["ok"] and r["reason"] in ("unknown", "same", "downgrade", "unavailable")):
            r["checked"] = False
            return r
        a, b = find_ship(ships, src), find_ship(ships, dst)
        # The editions that could be part of a chain: those to the ship you want, and those to ships in between
        # that cost less than the ship is worth (any other step saves nothing over a straight upgrade).
        mid = [o for s in ships if a["msrp"] < s["msrp"] < b["msrp"]
               for o in offers(s, warbond) if o["price"] < s["msrp"] - 0.5]
        mid.sort(key=lambda o: o["price"])
        try:
            elig = self.eligible([o.get("id") for o in offers(b, warbond)] + [o.get("id") for o in mid])
        except Exception as e:
            elig = {}
            print("ccu eligible:", e, flush=True)
        if not any(elig.get(o.get("id")) for o in offers(b, warbond)):
            # RSI couldn't be asked at all: nothing can be checked, so say so instead of guessing
            if not elig:
                return {"ok": False, "reason": "unchecked"}
        r = best_path(ships, src, dst, warbond, allowed=lambda fr, o: fr.get("id") in elig.get(o.get("id"), ()))
        r["checked"] = True
        if not r["ok"]:
            return r
        # RSI's own price for each step (and for the straight upgrade)
        total, sure = 0.0, True
        for st in r["steps"]:
            try:
                st["price"] = self._price(st["from_id"], st["sku_id"])
                st["rsi_price"] = True
            except Exception as e:
                print("ccu price:", e, flush=True)
                sure = False
            total += st["price"]
        r["total"] = round(total, 2)
        if r.get("direct_sku"):
            try:
                r["direct"] = self._price(a["id"], r["direct_sku"])
            except Exception:
                pass
        r["saved"] = round(max(0, r["direct"] - r["total"]), 2)
        r["prices_checked"] = sure
        return r


# ------------------------------------------------------------ the chain
def offers(ship, warbond=True):
    """The upgrade editions to this ship on sale now, cheapest first (warbond=False: no Warbond ones)."""
    return sorted([s for s in ship.get("skus") or [] if s["available"] and (warbond or not s["warbond"])],
                  key=lambda s: s["price"])


def find_ship(ships, x):
    return next((s for s in ships if s.get("id") == x or s["name"] == x), None) \
        or next((s for s in ships if key(s["name"]) == key(x)), None)


def best_path(ships, src, dst, warbond=True, max_steps=8, allowed=None):
    """The cheapest chain of upgrades from ship src to ship dst (both by name or id).

    Returns {"ok": True, "steps": [...], "total", "direct", "saved"} or {"ok": False, "reason": ...}
    with reason one of: unknown, same, downgrade, unavailable (no upgrade to dst on sale now), none.
    Each step: {"from", "to", "edition", "price"}. Ties go to the chain with fewer steps.
    allowed(from_ship, edition): whether that upgrade can be bought from that ship (RSI's own list); without
    it, any edition on sale is taken as buyable from any ship worth less.
    """
    ok = allowed or (lambda fr, o: True)
    a, b = find_ship(ships, src), find_ship(ships, dst)
    if not a or not b:
        return {"ok": False, "reason": "unknown"}
    if a is b or a["name"] == b["name"]:
        return {"ok": False, "reason": "same"}
    if b["msrp"] <= a["msrp"]:
        return {"ok": False, "reason": "downgrade", "from_value": a["msrp"], "to_value": b["msrp"]}
    end = offers(b, warbond)
    if not end:
        return {"ok": False, "reason": "unavailable"}
    # Ships worth more than src and less than dst that have an upgrade on sale, plus dst. Every step goes
    # up in value, so in order of value it's a one-way graph: the cheapest chain is a single pass.
    mid = [s for s in ships if a["msrp"] < s["msrp"] < b["msrp"] and offers(s, warbond)]
    nodes = [a] + sorted(mid, key=lambda s: s["msrp"]) + [b]
    best = {0: (0.0, 0, None, None)}                       # index -> (cost, steps, previous index, edition)
    for j in range(1, len(nodes)):
        to = nodes[j]
        for i in range(j):
            if i not in best:
                continue
            fr = nodes[i]
            if to["msrp"] <= fr["msrp"]:
                continue
            cost, steps = best[i][0], best[i][1]
            if steps >= max_steps:
                continue
            for o in offers(to, warbond):
                price = o["price"] - fr["msrp"]
                if price <= 0 or not ok(fr, o):              # RSI only sells upgrades that cost something
                    continue
                c = (round(cost + price, 2), steps + 1)
                if j not in best or c < best[j][:2]:
                    best[j] = (c[0], c[1], i, o)
                break                                       # offers are cheapest first
    last = len(nodes) - 1
    if last not in best:
        return {"ok": False, "reason": "none"}
    steps, j = [], last
    while j:
        cost, _, i, o = best[j]
        steps.append({"from": nodes[i]["name"], "to": nodes[j]["name"], "edition": o["title"],
                      "from_id": nodes[i].get("id"), "sku_id": o.get("id"),
                      "warbond": o["warbond"], "price": round(o["price"] - nodes[i]["msrp"], 2),
                      "to_store": nodes[j].get("store")})
        j = i
    steps.reverse()
    total = best[last][0]
    straight = [o for o in end if ok(a, o) and o["price"] > a["msrp"]]
    std = [o for o in straight if not o["warbond"]] or straight or end
    direct = round(std[0]["price"] - a["msrp"], 2)
    return {"ok": True, "steps": steps, "total": total, "direct": direct, "saved": round(max(0, direct - total), 2),
            "direct_sku": std[0].get("id") if straight else None, "from_value": a["msrp"], "to_value": b["msrp"]}


def impound_url(name):
    return IMPOUND + urllib.parse.quote(str(name or ""))


if __name__ == "__main__":
    # A check from the command line, against RSI itself:  python ccu.py "Intrepid" "Carrack"
    import sys
    import tempfile
    c = Ccu(sys.argv[3] if len(sys.argv) > 3 else tempfile.mkdtemp())
    ships, at, err = c.ships(wait=True)
    print(f"source: {c.source}  ships: {len(ships)}  error: {err}")
    if len(sys.argv) >= 3:
        t0 = time.time()
        r = c.path(sys.argv[1], sys.argv[2])
        print(f"({time.time() - t0:.1f} s)")
        for st in r.pop("steps", []):
            print(f"  {st['from']} -> {st['to']}  {st['edition']}  ${st['price']}{'' if st.get('rsi_price') else '  (not checked with RSI)'}")
        print(json.dumps(r, indent=1))
