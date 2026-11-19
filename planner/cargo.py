"""Cargo load planning: how a ship's cargo grids take the boxes you're buying or hauling.

Everything is counted in 1-SCU cells. One SCU is a 1.25 m cube, and every cargo grid's size (from the game files,
through the Star Citizen Wiki's vehicle data) is a whole number of them: the Argo RAFT's 10 x 2.5 x 15 m grid is
8 x 2 x 12 cells = 192 SCU.

Containers are fixed shapes, length x width x height in cells (the wiki's container pages):
    1 SCU 1x1x1   2 SCU 2x1x1   4 SCU 2x2x1   8 SCU 2x2x2   16 SCU 4x2x2   24 SCU 6x2x2   32 SCU 8x2x2
A box may turn on the deck (length along the grid's length or across it) but stays upright, and only sits on the
deck or on a flat top of boxes under its whole footprint, so stacks are ones you could actually build.

How it packs:
  1. Each commodity becomes boxes, biggest first, no bigger than the terminal hands out (its max container size)
     or the grid takes (the grid's max box).
  2. Boxes go in one at a time into the first spot that's furthest from the loading end, lowest, then leftmost:
     the far end fills first, wall to ceiling, so the loading end stays clear. Cargo you'll unload last goes in
     first (deepest).
  3. A box that fits nowhere is split into the next size down (32 -> 16 + 16, 24 -> 16 + 8, 8 -> 4 + 4 ...) and
     those are tried, down to 1 SCU. What doesn't fit at 1 SCU is left over.
  4. That's tried with the biggest boxes allowed, then capped at 16, 8 and 4 SCU, and with and without keeping the
     unload order; the plan that fits the most wins (ties: the unload order kept, then fewer boxes).

What it can't know: the exact mix of boxes a hauling contract hands you (the plan uses the contract's largest box
size), and shapes inside a hold the wiki gives only as a rectangle (a notch or a ramp cut-out).
"""
SCU_M = 1.25
BOXES = {1: (1, 1, 1), 2: (2, 1, 1), 4: (2, 2, 1), 8: (2, 2, 2), 16: (4, 2, 2), 24: (6, 2, 2), 32: (8, 2, 2)}
SIZES = sorted(BOXES, reverse=True)
SPLIT = {32: [16, 16], 24: [16, 8], 16: [8, 8], 8: [4, 4], 4: [2, 2], 2: [1, 1]}


def grid_from_wiki(g, n=0):
    """A wiki cargo grid {width, height, length (m), scu, max_scu_box, external, open} -> a grid in cells, or None."""
    try:
        X, Y, Z = (int(round(float(g[k]) / SCU_M)) for k in ("width", "height", "length"))
    except (KeyError, TypeError, ValueError):
        return None
    if X <= 0 or Y <= 0 or Z <= 0:
        return None
    scu = int(g.get("scu") or 0)
    mb = g.get("max_scu_box")
    mb = int(mb) if isinstance(mb, (int, float)) and mb > 0 else max(SIZES)
    return {"id": n, "X": X, "Y": Y, "Z": Z, "max_box": mb, "scu": scu or X * Y * Z,
            "external": bool(g.get("external")), "open": bool(g.get("open", True)),
            # the wiki's SCU and the box don't always agree (a hold that isn't a plain rectangle): say so
            "approx": bool(scu) and scu != X * Y * Z}


def split(scu, max_box=32, allowed=None):
    """SCU of one commodity -> box sizes, biggest first, none over max_box (and only `allowed` sizes, when given)."""
    sizes = [s for s in SIZES if s <= max_box and (not allowed or s in allowed)] or [1]
    if 1 not in sizes:
        sizes.append(1)
    out, left = [], int(round(scu))
    for s in sizes:
        while left >= s:
            out.append(s)
            left -= s
    return out


class _Grid:
    def __init__(self, g):
        self.g, self.X, self.Y, self.Z = g, g["X"], g["Y"], g["Z"]
        self.hm = [[0] * self.Z for _ in range(self.X)]    # height of the stack in each deck cell
        self.boxes = []

    def spot(self, size):
        """Best (score, x, y, z, dx, dy, dz) for a box of this size, or None."""
        if size > self.g["max_box"]:
            return None
        L, W, H = BOXES[size]
        if H > self.Y:
            return None
        best = None
        for dx, dz in {(W, L), (L, W)}:
            if dx > self.X or dz > self.Z:
                continue
            for z in range(self.Z - dz + 1):
                if best and z > best[0][0]:
                    break                              # nothing further along can score better
                for x in range(self.X - dx + 1):
                    h = self.hm[x][z]
                    if h + H > self.Y:
                        continue
                    flat = True
                    for i in range(x, x + dx):
                        col = self.hm[i]
                        for k in range(z, z + dz):
                            if col[k] != h:
                                flat = False
                                break
                        if not flat:
                            break
                    if flat:
                        score = (z, h, x, 0 if dz >= dx else 1)
                        if best is None or score < best[0]:
                            best = (score, x, h, z, dx, H, dz)
        return best

    def put(self, s, size, item, seq):
        _, x, y, z, dx, dy, dz = s
        for i in range(x, x + dx):
            for k in range(z, z + dz):
                self.hm[i][k] = y + dy
        self.boxes.append({"x": x, "y": y, "z": z, "dx": dx, "dy": dy, "dz": dz, "size": size, "item": item, "seq": seq})


def _pack_once(grids, items, cap, keep_order):
    G = [_Grid(g) for g in grids]
    queue = []
    for i, it in enumerate(items):
        mb = min(int(it.get("max_box") or 32), cap)
        for s in split(it["scu"], mb, it.get("sizes")):
            queue.append((i, s))
    if keep_order:          # last off goes in first (deepest), then biggest first
        queue.sort(key=lambda q: (-(items[q[0]].get("drop") or 0), -q[1], q[0]))
    else:
        queue.sort(key=lambda q: (-q[1], -(items[q[0]].get("drop") or 0), q[0]))
    left = [0] * len(items)
    seq = 0
    while queue:
        i, s = queue.pop(0)
        best = None
        for g in G:
            sp = g.spot(s)
            if sp and (best is None or (sp[0][0], sp[0][1]) < (best[1][0][0], best[1][0][1])):
                best = (g, sp)
            if sp:
                break                                  # grids are tried in order: fill one before the next
        if best:
            best[0].put(best[1], s, i, seq)
            seq += 1
        elif s in SPLIT:
            queue[0:0] = [(i, p) for p in SPLIT[s]]
        else:
            left[i] += s
    return G, left


def pack(grids, items):
    """grids: from grid_from_wiki. items: [{key, name, scu, max_box?, sizes?, drop?}] (drop: 0 = unloaded first).
    -> {grids: [... boxes: [{x,y,z,dx,dy,dz,size,item,seq}]], items: [{..., placed, left, boxes: {size: n}}],
        capacity, used, left, cap, kept_order, notes}"""
    items = [dict(it, scu=max(0, int(round(float(it.get("scu") or 0))))) for it in items]
    biggest = max([g["max_box"] for g in grids] + [1])
    caps = [c for c in (32, 16, 8, 4) if c <= biggest] or [biggest]
    best = None
    for cap in caps:
        for keep in (True, False):
            G, left = _pack_once(grids, items, cap, keep)
            placed = sum(b["size"] for g in G for b in g.boxes)
            nbox = sum(len(g.boxes) for g in G)
            key = (placed, keep, -nbox)
            if best is None or key > best[0]:
                best = (key, G, left, cap, keep)
            if not sum(left) and keep:
                break                                  # everything fits, in unload order: done with this cap
        if best and not sum(best[2]) and best[4]:
            break                                      # the biggest boxes that fit everything in order win
    _, G, left, cap, keep = best
    out_items = []
    for i, it in enumerate(items):
        counts = {}
        for g in G:
            for b in g.boxes:
                if b["item"] == i:
                    counts[b["size"]] = counts.get(b["size"], 0) + 1
        placed = sum(s * n for s, n in counts.items())
        out_items.append({**{k: it.get(k) for k in ("key", "name", "scu", "max_box", "drop", "to")},
                          "placed": placed, "left": left[i],
                          "boxes": {str(s): counts[s] for s in sorted(counts, reverse=True)}})
    capacity = sum(g["X"] * g["Y"] * g["Z"] for g in grids)
    used = sum(b["size"] for g in G for b in g.boxes)
    notes = []
    if any(g["approx"] for g in grids):
        notes.append("This ship's hold isn't a plain box in the wiki's data, so treat the layout as a guide.")
    if not keep and len(items) > 1:
        notes.append("To fit everything, some cargo you'll unload later sits in front of cargo you'll unload sooner.")
    gmax = max((g["max_box"] for g in grids), default=32)
    if gmax < 32:
        notes.append(f"Boxes are kept to {gmax} SCU or smaller (the wiki's limit for this ship).")
    if cap < max(it.get("max_box") or 32 for it in items or [{}]) and used and cap < gmax:
        notes.append(f"Packs best as boxes of {cap} SCU or smaller.")
    return {"grids": [dict(g.g, boxes=g.boxes) for g in G], "items": out_items, "capacity": capacity,
            "used": used, "left": sum(left), "cap": cap, "kept_order": keep, "notes": notes}
