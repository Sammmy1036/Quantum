"""Star Citizen Wiki system data (starcitizen.tools, CC BY-SA 4.0) for Quantum's info cards.

Source: https://starcitizen.tools/Module:SystemMap/systems.json, downloaded by import_data.py into
wiki_systems.json. It has no coordinates, only descriptive data for 90 systems: each body's official
designation ("Stanton IV"), type ("Super-Earth"), moons, the star's class, and the system's affiliation.
"""
import json
import re
from pathlib import Path

URL = "https://starcitizen.tools/Module:SystemMap/systems.json?action=raw"
PAGE_URL = "https://starcitizen.tools/"
AFFILIATION = {"uee": "UEE", "unc": "Unclaimed", "banu": "Banu", "xian": "Xi'an", "vanduul": "Vanduul",
               "dev": "Developing"}
ROMAN = {"1": "I", "2": "II", "3": "III", "4": "IV", "5": "V", "6": "VI", "7": "VII", "8": "VIII"}


def page_url(page):
    return PAGE_URL + page.replace(" ", "_") if page else None


def game_name_to_wiki(name):
    """Our map names -> wiki labels: 'Pyro4' -> 'Pyro IV', 'Pyrostar' -> star 'Pyro'."""
    m = re.fullmatch(r"([A-Za-z]+)(\d)", name)
    if m and m.group(2) in ROMAN:
        return f"{m.group(1)} {ROMAN[m.group(2)]}"
    return name


def load(path: Path):
    """-> {"systems": {name: info}, "bodies": {label: info}} ready for the UI, or None."""
    try:
        raw = json.loads(Path(path).read_text(encoding="utf-8"))
    except Exception:
        return None
    systems_raw = raw.get("systems", raw)
    systems, bodies = {}, {}
    for sname, s in systems_raw.items():
        if not isinstance(s, dict):
            continue
        name = re.sub(r"\s*\(.*\)$", "", sname)   # "Kyuk'ya (Indra)" -> "Kyuk'ya"
        star = s.get("star") or {}
        planets = [b for b in s.get("bodies", []) if b.get("tier") not in ("belt", "moon")]
        belts = [b for b in s.get("bodies", []) if b.get("tier") == "belt"]
        moons = sum(len([m for m in (b.get("moons") or []) if m.get("tier") != "ring"]) for b in planets)
        systems[name] = {
            "name": name, "affiliation": AFFILIATION.get(s.get("affiliation"), s.get("affiliation") or ""),
            "url": page_url(s.get("page")), "star": star.get("label"), "star_type": star.get("subtype"),
            "star_class": star.get("class"), "star_url": page_url(star.get("page")),
            "companion": (s.get("companion") or {}).get("label"),
            "planets": [p.get("label") for p in planets], "belts": [b.get("label") for b in belts],
            "moons": moons}
        for b in s.get("bodies", []):
            info = {"label": b.get("label"), "designation": b.get("designation"), "type": b.get("subtype"),
                    "tier": b.get("tier") or "planet", "system": name, "url": page_url(b.get("page")),
                    "moons": [m.get("label") for m in (b.get("moons") or []) if m.get("tier") != "ring"]}
            bodies[b.get("label")] = info
            for m in b.get("moons") or []:
                if m.get("tier") == "ring":
                    continue
                # A few "moons" are really planets parented oddly upstream (Pyro IV); keep their own type.
                bodies[m.get("label")] = {"label": m.get("label"),
                                          "designation": m.get("designation") if not re.fullmatch(r"\d+[a-z]", m.get("designation") or "")
                                          else f"{b.get('designation')} {m.get('designation')[-1]}".strip(),
                                          "type": m.get("subtype") or "Moon", "tier": "moon", "system": name,
                                          "orbits": b.get("label"), "url": page_url(m.get("page")), "moons": []}
    return {"systems": systems, "bodies": bodies}


def for_game_body(wiki, name, kind, system):
    """Wiki info for one of our map bodies (None if the wiki doesn't list it)."""
    if not wiki:
        return None
    if kind == "star":
        s = wiki["systems"].get(system)
        return s and {"designation": f"{system} star", "type": s["star_type"], "star_class": s["star_class"],
                      "url": s["star_url"], "tier": "star", "system": system}
    return wiki["bodies"].get(game_name_to_wiki(name)) or wiki["bodies"].get(name)
