"""Shopping list: the parts (and gear) you want, and the trip that buys them all.

plan() picks which shops to visit and in what order:
  - "fewest" (default): as few stops as possible. Each stop is the one that sells the most of what's left;
    ties go to the one in your system, then the nearest, then the cheapest. Every item is then bought at
    the cheapest of the chosen stops, and a stop left with nothing to buy is dropped.
  - "cheapest": every item where it's cheapest; items whose cheapest shops are in the same place share a stop.
The stops are then put in the shortest order from where you are (NavDB.optimize: your system first).

A spot is {"place": Quantum's name for the location (or None when it isn't on the map), "where", "shop",
"system", "price"}. Pure functions: app.py fetches the spots and the positions.
"""
import re
import time
import uuid as _uuid

MODES = ("fewest", "cheapest")


def new_entry(name, kind, uuid=None, uex_id=None, class_name=None, qty=1, source=None):
    return {"id": _uuid.uuid4().hex[:10], "name": name, "kind": kind, "uuid": uuid, "uex_id": uex_id,
            "class_name": class_name or "", "qty": max(1, int(qty or 1)), "bought": 0, "source": source,
            "added": int(time.time())}


def same_item(a, b):
    if a.get("uuid") and b.get("uuid"):
        return str(a["uuid"]).lower() == str(b["uuid"]).lower()
    return (a.get("name") or "").lower() == (b.get("name") or "").lower() and a.get("kind") == b.get("kind")


def plan(entries, spots_of, dist_of, system_of, here_system=None, mode="fewest", order=None):
    """entries: shopping list entries still to buy (qty - bought > 0).
    spots_of(entry) -> [spot]; dist_of(place) -> metres from you (None if unknown/other system);
    system_of(place) -> system; order(places) -> the places in travel order.
    Returns {"steps": [{"place", "where", "system", "items": [{"id", "name", "qty", "price", "shop"}],
    "subtotal"}], "offmap": [same, for shops not on Quantum's map], "unavailable": [entry ids], "total"}."""
    want = [e for e in entries if (e.get("qty") or 1) - (e.get("bought") or 0) > 0]
    sold = {}                                   # entry id -> {place: cheapest spot there}
    offmap, unavailable = {}, []
    for e in want:
        by_place = {}
        for s in spots_of(e) or []:
            if not s.get("price"):
                continue
            key = s.get("place")
            if not key:
                continue
            if key not in by_place or s["price"] < by_place[key]["price"]:
                by_place[key] = s
        if by_place:
            sold[e["id"]] = by_place
            continue
        other = sorted([s for s in spots_of(e) or [] if s.get("price")], key=lambda s: s["price"])
        if other:
            offmap.setdefault(other[0].get("where") or "?", []).append((e, other[0]))
        else:
            unavailable.append(e["id"])

    def here_first(p):
        sysp = system_of(p)
        return 0 if here_system and sysp == here_system else 1

    def far(p):
        d = dist_of(p)
        return d if d is not None else 9e18

    chosen = []
    if mode == "cheapest":
        for e in want:
            if e["id"] not in sold:
                continue
            opts = sold[e["id"]]
            best = min(opts.values(), key=lambda s: s["price"])
            # the same price somewhere you already stop beats a new stop
            same = [p for p in chosen if p in opts and opts[p]["price"] <= best["price"]]
            p = same[0] if same else best["place"]
            if p not in chosen:
                chosen.append(p)
    else:
        left = {eid for eid in sold}
        while left:
            places = {p for eid in left for p in sold[eid]}
            p = min(places, key=lambda p: (-sum(1 for eid in left if p in sold[eid]), here_first(p), far(p),
                                           sum(sold[eid][p]["price"] for eid in left if p in sold[eid])))
            chosen.append(p)
            left -= {eid for eid in left if p in sold[eid]}

    # Each item at the cheapest chosen stop that sells it
    at = {p: [] for p in chosen}
    for e in want:
        opts = sold.get(e["id"])
        if not opts:
            continue
        p = min((p for p in chosen if p in opts), key=lambda p: (opts[p]["price"], chosen.index(p)))
        at[p].append((e, opts[p]))
    chosen = [p for p in chosen if at[p]]
    ordered = order(chosen) if order and chosen else chosen

    def row(e, s):
        n = (e.get("qty") or 1) - (e.get("bought") or 0)
        return {"id": e["id"], "name": e["name"], "kind": e.get("kind"), "qty": n, "price": s["price"],
                "shop": s.get("shop"), "cost": s["price"] * n}

    steps = []
    for p in ordered:
        items = [row(e, s) for e, s in at[p]]
        s0 = at[p][0][1]
        steps.append({"place": p, "where": s0.get("where") or p, "system": s0.get("system") or system_of(p),
                      "items": items, "subtotal": sum(i["cost"] for i in items)})
    off = []
    for where, pairs in offmap.items():
        items = [row(e, s) for e, s in pairs]
        off.append({"place": None, "where": where, "system": pairs[0][1].get("system"), "items": items,
                    "subtotal": sum(i["cost"] for i in items)})
    total = sum(s["subtotal"] for s in steps) + sum(s["subtotal"] for s in off)
    return {"steps": steps, "offmap": off, "unavailable": unavailable, "total": total, "mode": mode,
            "made": int(time.time())}


def match_purchase(entries, item_code, words_noise=()):
    """The shopping-list entry a Game.log purchase is for, from the item's class name ("COOL_AEGS_S01_Bracer"):
    an exact class name match, else the entry whose distinctive name words all appear in it."""
    code = (item_code or "").lower()
    if not code:
        return None
    for e in entries:
        if e.get("class_name") and e["class_name"].lower() == code:
            return e
    flat = re.sub(r"[^a-z0-9]", "", code)
    best, score = None, 0
    for e in entries:
        words = [w for w in re.findall(r"[a-z0-9]+", (e.get("name") or "").lower()) if w not in words_noise]
        long_ = [w for w in words if len(w) >= 4]
        squashed = "".join(words)
        if (long_ and all(w in flat for w in long_)) or (len(squashed) >= 4 and squashed in flat):
            sc = len("".join(long_)) or len(squashed)
            if sc > score:
                best, score = e, sc
    return best
