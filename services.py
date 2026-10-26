"""Location services ("amenities") from the Star Citizen Wiki API.

Source: https://api.star-citizen.wiki/api/locations?include=amenities (public, no key, data from the
game files, versioned per game build). Maintained by the Star Citizen Wiki community.

import_data.py downloads it into services.json; the app matches each record to a Quantum place by
name (and parent body) and shows the services in the place's card, like the in-game location panel:
Landing Pad (M), Hangar (L), Vehicle Services, Commodity Trading, Refinery, Clinic, ...
"""
import json
import re
import time
import urllib.request
from pathlib import Path

API = "https://api.star-citizen.wiki/api/locations"
UA = {"User-Agent": "quantum-nav (personal Star Citizen route planner)", "Accept": "application/json"}
PAD_ORDER = ["small", "medium", "large", "xl"]
PAD_CODES = {"S": "small", "M": "medium", "L": "large", "XL": "xl"}


def _get(url):
    with urllib.request.urlopen(urllib.request.Request(url, headers=UA), timeout=60) as r:
        return json.loads(r.read().decode("utf-8"))


def _amenity_names(raw):
    out = []
    for a in raw or []:
        if isinstance(a, str):
            out.append(a)
        elif isinstance(a, dict):
            n = a.get("name") or a.get("display_name") or a.get("title")
            if n:
                out.append(n)
    return sorted(set(out))


def _record(d):
    parent = (d.get("parent") or {}).get("name") or ""
    imgs = d.get("images") or []
    return {"name": d.get("name") or "", "parent": parent, "system": d.get("system") or "",
            "type": (d.get("type") or {}).get("classification") or "",
            "jurisdiction": (d.get("jurisdiction") or {}).get("name") or "",
            "description": (d.get("description") or "").strip(),
            "amenities": _amenity_names(d.get("amenities")),
            "url": d.get("web_url") or "", "image": (imgs[0].get("thumbnail_url") if imgs else "") or "",
            "version": d.get("version") or ""}


def fetch_all(log=print, delay=0.4):
    """Download every location with its amenities. Polite: one page at a time."""
    records, page, last = [], 1, 1
    while page <= last:
        data = _get(f"{API}?include=amenities&page%5Bsize%5D=100&page%5Bnumber%5D={page}")
        records += [_record(d) for d in data.get("data", [])]
        last = (data.get("meta") or {}).get("last_page", page)
        if page == 1:
            log(f"  {data.get('meta', {}).get('total', '?')} locations, {last} pages")
        page += 1
        time.sleep(delay)
    return records


def save(records, path):
    versions = sorted({r["version"] for r in records if r["version"]})
    Path(path).write_text(json.dumps({"source": API, "fetched": time.strftime("%Y-%m-%d"),
                                      "versions": versions, "locations": records}, indent=0), encoding="utf-8")


def load(path):
    try:
        return json.loads(Path(path).read_text(encoding="utf-8")).get("locations", [])
    except Exception:
        return []


def fetched_at(path):
    """When services.json was downloaded (seconds since the epoch), 0 if unknown."""
    try:
        day = json.loads(Path(path).read_text(encoding="utf-8")).get("fetched") or ""
        return time.mktime(time.strptime(day, "%Y-%m-%d"))
    except Exception:
        return 0.0


# ------------------------------------------------------------------ matching
def _key(name):
    n = name.lower().replace("&", " and ")
    n = re.sub(r"^r\s*and\s*r\s+", "", n)           # "R&R ARC-L1 Wide Forest Station" -> "arc-l1 ..."
    n = re.sub(r"\s*\((?:[^)]*)\)\s*$", "", n)       # "... (microTech)" disambiguation suffixes
    return re.sub(r"[^a-z0-9]", "", n)


def _body_key(name):
    m = re.fullmatch(r"([A-Za-z]+)(\d)", name or "")
    roman = {"1": "i", "2": "ii", "3": "iii", "4": "iv", "5": "v", "6": "vi"}
    if m:
        return (m.group(1) + roman.get(m.group(2), m.group(2))).lower()
    return re.sub(r"[^a-z0-9]", "", (name or "").lower())


# Services players have seen where the game data lists none (the Wiki API has the Wikelo stations
# with an empty amenity list). Used only when the data has nothing for that place.
REPORTED = {n: ["Hangar XL", "Freight Elevator", "Wikelo's Shop", "Vehicle Services"]
            for n in ("Wikelo Emporium Dasi Station", "Wikelo Emporium Selo Station",
                      "Wikelo Emporium Kinga Station")}


def _with_reported(out, locations):
    for name, amen in REPORTED.items():
        if name not in locations or (name in out and out[name]["amenities"]):
            continue
        base = out.get(name) or {"name": name, "parent": "", "system": "", "type": "", "jurisdiction": "",
                                 "description": "", "url": "", "image": "", "version": ""}
        out[name] = dict(base, amenities=list(amen), reported=True)
    return out


# Shorter names in the services panel. The data spells some out ("Commodity Trading - Freight Elevator",
# "Vehicle Services (Refuel, Repair)"); a plain "Commodity Trading" is kept as it is.
AMENITY_LABELS = [(re.compile(r"^vehicle services\b.*$", re.I), "Vehicle Services"),
                  (re.compile(r"^commodity trading\s*[-–—:]\s*freight elevators?$", re.I), "Freight Elevator"),
                  (re.compile(r"^commodity trading\s*[-–—:]\s*loading docks?$", re.I), "Loading Dock")]


def clean_amenity(name):
    n = (name or "").strip()
    for rx, label in AMENITY_LABELS:
        if rx.match(n):
            return label
    return n


def _clean_labels(out):
    for name, r in out.items():
        seen, amen = set(), []
        for a in r.get("amenities") or []:
            a = clean_amenity(a)
            if a and a not in seen:
                seen.add(a)
                amen.append(a)
        out[name] = dict(r, amenities=amen)
    return out


def match(records, locations):
    return _clean_labels(_with_reported(_match(records, locations), locations))


def _match(records, locations):
    """-> {quantum place name: record}. Same-named places are told apart by their parent body."""
    by_key = {}
    for r in records:
        if r["name"] and not r["name"].startswith("<="):
            by_key.setdefault(_key(r["name"]), []).append(r)
    out = {}
    for name, loc in locations.items():
        if loc.category == "jump":
            continue                     # a Gateway (jump point) has no services: its station does
        k = _key(name)
        cands = by_key.get(k) or (by_key.get(k[:-7]) if k.endswith("station") else None)  # "Checkmate Station"
        if not cands:
            continue
        # Same-named stations in different systems (Pyro Gateway is in Stanton and in Nyx): same system only.
        sys_ = (loc.system or "").lower()
        cands = [r for r in cands if not r["system"] or r["system"].lower().split()[0] == sys_]
        if not cands:
            continue
        if loc.body:
            # Both sides name a parent body: they must agree (keeps "Area 18 (microTech)" off Area18).
            cands = [r for r in cands if not r["parent"] or _body_key(r["parent"]) == _body_key(loc.body)
                     or r["type"] in ("Manmade", "SpaceStation")]
            if not cands:
                continue
        best = max(cands, key=lambda r: len(r["amenities"]))  # prefer the record that has the details
        out[name] = best
    # A city's spaceport is the same place as far as services go ("New Babbage Interstellar Spaceport"
    # has New Babbage's amenities), but the data lists them under the city only.
    for name, loc in locations.items():
        if "spaceport" not in name.lower() or (name in out and out[name]["amenities"]) or not loc.body:
            continue
        best, bd = None, 60_000.0
        for other, r in out.items():
            o = locations.get(other)
            if o and o.body == loc.body and r["amenities"] and "spaceport" not in other.lower():
                d = sum((a - b) ** 2 for a, b in zip(o.pos, loc.pos)) ** 0.5
                if d < bd:
                    best, bd = other, d
        if best:
            out[name] = dict(out[best], name=name, inherited_from=best)
    return out


def pad_from(amenities):
    """Largest landing option in the amenities -> Quantum's pad size ("small".."xl", "hangar")."""
    best, hangar = None, False
    for a in amenities:
        m = re.match(r"(Landing Pad|Hangar)\s*\(?(XL|S|M|L)\)?$", a.strip(), re.I)   # "Landing Pad M" or "(M)"
        if not m:
            continue
        size = PAD_CODES[m.group(2).upper()]
        if m.group(1).lower() == "hangar":
            hangar = True
        if best is None or PAD_ORDER.index(size) > PAD_ORDER.index(best):
            best = size
    return best or ("hangar" if hangar else None)


# ---- what can be mined or harvested where, from the bodies' own descriptions on the wiki:
#   "Potential Ship Mineables:\nQuartz\nBorase ...", "Potential Ground Vehicle Mineables:", "Potential Hand
#   Mineables:", "Potential Harvestables:" (each a list, one per line; "(Caves)" / "(Caves only)" kept apart)
RESOURCE_HEADS = {"ship mineables": "ship", "ground vehicle mineables": "roc", "hand mineables": "hand",
                  "harvestables": "harvest"}


# Typos in the wiki's lists -> the game's names
RESOURCE_SPELLING = {"alumium": "Aluminum", "tarantite": "Taranite", "beradon": "Beradom"}


def resources(records):
    """{kind: {resource: [{"body", "system", "caves"}]}} for kind in ship / roc / hand / harvest."""
    out = {k: {} for k in RESOURCE_HEADS.values()}
    for r in records or []:
        desc = (r.get("description") or "").replace("\r", "")
        body, system = r.get("name") or "", (r.get("system") or "").replace(" System", "")
        for m in re.finditer(r"Potential ([A-Za-z ]+?):?\s*\n((?:[^\n]+\n?)+)", desc):
            kind = RESOURCE_HEADS.get(m.group(1).strip().lower())
            if not kind:
                continue
            for line in m.group(2).split("\n"):
                line = line.strip()
                if not line or line.lower().startswith("potential"):
                    break
                caves = bool(re.search(r"\(caves?(?: only)?\)", line, re.I))
                name = re.sub(r"\s*\([^)]*\)\s*$", "", line).strip()
                name = RESOURCE_SPELLING.get(name.lower(), name)
                if name and len(name) < 40:
                    out[kind].setdefault(name, []).append({"body": body, "system": system, "caves": caves})
    return out
