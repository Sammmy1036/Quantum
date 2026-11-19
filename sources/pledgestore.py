"""The RSI pledge store's gear, packs and weapons, to say where an item no in-game shop sells can be bought.

Lots of gear (backpacks, armor and weapon paints like "Red Alert") is never sold in game: it comes in a pack
on the RSI pledge store, for real money. The game files say an item is a promotional one, but not which
pack has it, and the Star Citizen Wiki's API doesn't serve its store copy either. So Quantum asks the store
the way its own browse page does (the GraphQL "GetBrowseSkusByFilter" query, as a guest) and matches items to
store listings by name: the paint or edition ("Red Alert"), plus the item's maker or model ("CDS", "ADP-mk4",
"CSP-68H"), or a collection of that paint.

  Store(cache_dir).listing()        every gear, pack and weapon listing on sale: [{id, title, price, url, kind}]
  Store(cache_dir).find(name, ...)  the listings an item is likely in, best first

The list is kept on disk for 6 hours; an older copy is used when RSI can't be reached. Hand-checked
listings (gear.PLEDGE_SOURCES) are shown as well, so a pack RSI has taken off sale is still named.
"""
import json
import re
import threading
import time
from pathlib import Path

import ccu

RSI = ccu.RSI
GRAPHQL = "/graphql"
STALE = 6 * 3600
PAGE = 100
# What's asked for: RSI's product ids for each part of the store (as its browse pages use them)
CATEGORIES = {
    "gear": {"products": [289], "facet": "extras-gear"},
    "packs": {"products": [270]},
    "weapons": {"products": [35, 36, 37, 38, 40, 57, 86, 87, 88, 89, 90, 91, 92, 93, 95, 96, 99, 100, 101, 108, 109,
                             122, 123, 124, 129, 138, 150, 151, 152, 153, 154, 155, 156, 157, 158, 159, 160, 161]},
}
QUERY = """query GetBrowseSkusByFilter($query: SearchQuery, $storeFront: String = "pledge") {
  store(browse: true, name: $storeFront) {
    listing: search(query: $query) {
      count
      totalCount
      resources {
        id
        name
        title
        subtitle
        url
        price { amount }
        stock { available }
        ... on TySku { isPackage parentProduct { name } }
      }
    }
  }
}"""
# Words that make a listing a bundle of many items (it holds every piece of its paint, whoever makes them)
BUNDLE = re.compile(r"\b(collection|bundle|complete|ultimate|everything|set|kit)\b", re.I)   # "Monde 'Keystone' Armor Set"
# Words that name the kind of piece, not the paint ("ADP-mk4 Core Red Alert" is the Core of the Red Alert ADP-mk4)
PIECE = {"helmet", "helm", "core", "torso", "arms", "arm", "legs", "leg", "backpack", "pack", "undersuit", "suit",
         "armor", "armour", "rifle", "pistol", "smg", "lmg", "shotgun", "sniper", "launcher", "knife", "gloves",
         "jacket", "pants", "shirt", "hat", "boots", "shoes"}


def _norm(s):
    s = str(s or "").lower().replace("“", '"').replace("”", '"').replace("’", "'")
    return re.sub(r"\s+", " ", re.sub(r"[\"'()\[\],:]", " ", s)).strip()


def _model_words(name):
    """The model codes in a name: words with a digit or a hyphen ("CSP-68H", "ADP-mk4", "P8-SC")."""
    return [w for w in _norm(name).split() if re.search(r"\d|-", w) and len(w) > 2]


def paint_of(name):
    """The paint or edition in an item's name. Names go model, piece, paint, so it's the words after the piece:
    "Warden Backpack Keystone" -> "keystone"; "CSP-68H Backpack Red Alert" -> "red alert"; "CSP-68H Backpack" -> "".
    With no piece word in the name, what's left without its model codes ("ADP-mk4 Woodland" -> "woodland")."""
    w = _norm(name).split()
    last = max((i for i, x in enumerate(w) if x in PIECE), default=-1)
    if last >= 0:
        return " ".join(x for x in w[last + 1:] if x not in PIECE)
    models = set(_model_words(name))
    words = [w for w in _norm(name).split() if w not in models and w not in PIECE]
    return " ".join(words)


def _words_in(phrase, text):
    return bool(phrase) and re.search(r"(?<![a-z0-9])" + re.escape(phrase) + r"(?![a-z0-9])", text) is not None


def match(listings, name, maker=None, maker_code=None, extra_models=()):
    """The listings an item is likely in, best first: [{title, price, url, kind, why}].
    A listing matches when it has the item's paint and its maker or model, or is a collection of that paint.
    An item with no paint (a base item) matches only a listing naming its model."""
    paint = paint_of(name)
    # the model: words with a digit or hyphen ("CSP-68H"), and the name's words before its piece word ("Warden")
    w = _norm(name).split()
    last = max((i for i, x in enumerate(w) if x in PIECE), default=-1)
    named = [x for x in w[:max(last, 0)] if x not in PIECE and len(x) > 2]
    models = list(dict.fromkeys(_model_words(name) + named + [m.lower() for m in extra_models if m]))
    mk = _norm(maker)
    code = _norm(maker_code)
    out, titles = [], set()
    for x in listings:
        t = _norm(x.get("title"))
        if not t or t in titles:
            continue
        has_model = any(_words_in(m, t) for m in models)
        has_maker = (code and _words_in(code, t)) or (mk and len(mk) > 3 and mk in t)
        if paint:
            if not _words_in(paint, t):
                continue
            if has_model:
                why, rank = "model", 0
            elif has_maker:
                why, rank = "maker", 1
            elif BUNDLE.search(t):
                why, rank = "collection", 2
            else:
                continue
        else:
            if not has_model:
                continue
            why, rank = "model", 0
        titles.add(t)
        out.append({**x, "why": why, "_r": rank})
    out.sort(key=lambda r: (r["_r"], r.get("price") is None, r.get("price") or 0, r["title"]))
    return [{k: v for k, v in r.items() if k != "_r"} for r in out[:8]]


class Store(ccu.Rsi):
    """RSI's pledge store, asked as a guest the way ccu.Rsi asks its upgrade tool."""

    def __init__(self, cache_dir, timeout=30):
        super().__init__(timeout=timeout)
        self.file = Path(cache_dir) / "rsi_store_gear.json"
        self._list_lock = threading.Lock()
        self._mem = None

    def _query(self, cat, page):
        q = {"page": page, "limit": PAGE, "sort": {"field": "weight", "direction": "desc"},
             "skus": {"filtersFromTags": {"tagIdentifiers": [], "facetIdentifiers": [cat["facet"]] if cat.get("facet") else []},
                      "products": cat["products"]}}
        body = {"operationName": "GetBrowseSkusByFilter", "variables": {"storeFront": "pledge", "query": q}, "query": QUERY}
        with self._lock:
            if not self._op:
                self._start()
            text = self._send(GRAPHQL, body)
        d = json.loads(text)
        return ((d.get("data") or {}).get("store") or {}).get("listing") or {}

    def _fetch(self):
        rows, seen = [], set()
        for kind, cat in CATEGORIES.items():
            page, got = 1, 0
            while page <= 20:
                L = self._query(cat, page)
                res = L.get("resources") or []
                for r in res:
                    rid = r.get("id")
                    if rid in seen or not (r.get("title") or r.get("name")):
                        continue
                    seen.add(rid)
                    amt = (r.get("price") or {}).get("amount")
                    url = r.get("url") or ""
                    rows.append({"id": rid, "title": (r.get("title") or r.get("name") or "").strip(),
                                 "price": round(amt / 100, 2) if isinstance(amt, (int, float)) else None,
                                 "url": (RSI + url) if url.startswith("/") else (url if url.startswith("https://") else None),
                                 "kind": "Pack" if (r.get("isPackage") or kind == "packs") else kind.title().rstrip("s"),
                                 "available": (r.get("stock") or {}).get("available") is not False})
                got += len(res)
                if not res or got >= int(L.get("totalCount") or 0):
                    break
                page += 1
        return rows

    def listing(self, fresh=False):
        """{"items": [...], "at": when, "stale": bool}; raises only when RSI can't be reached and there's no copy."""
        with self._list_lock:
            old = self._mem
            if old is None and self.file.exists():
                try:
                    old = json.loads(self.file.read_text(encoding="utf-8"))
                except Exception:
                    old = None
            if old and not fresh and time.time() - (old.get("at") or 0) < STALE:
                self._mem = old
                return old
            try:
                items = self._fetch()
                if not items:
                    raise ccu.RsiError("the store listed nothing")
            except Exception as e:
                self._op = None                          # a fresh guest session next time
                if old:
                    return dict(old, stale=True)
                raise ccu.RsiError(str(e)) from None
            out = {"items": items, "at": time.time(), "stale": False}
            self._mem = out
            try:
                self.file.parent.mkdir(exist_ok=True)
                self.file.write_text(json.dumps(out), encoding="utf-8")
            except Exception:
                pass
            return out

    def find(self, name, maker=None, maker_code=None, extra_models=()):
        """The store listings an item is likely in: {"ok", "items", "at", "stale"} or {"ok": False, "error"}."""
        try:
            L = self.listing()
        except Exception as e:
            return {"ok": False, "error": f"Couldn't reach the RSI store ({e})"}
        return {"ok": True, "items": match(L["items"], name, maker, maker_code, extra_models), "at": L["at"], "stale": L.get("stale", False)}
