"""Build locations.json from two community databases.

  1. Valalol/Star-Citizen-Navigation Database.json   (Stanton, verified planet positions)
  2. starnav (MIT, crates.io) objContainers.json + pois.json
                                                     (newer: 1,045 Stanton POIs, Pyro, Nyx)

Usage:
    python import_data.py                 # download both
    python import_data.py --offline A B   # A = Database.json, B = folder with starnav json files

Safe to re-run: imported entries are replaced; your own waypoints ("user") and mission
stops are kept, and so are planet calibrations you've made.
"""
import io
import json
import sys
import tarfile
import urllib.request
from pathlib import Path

import gateways
from nav_core import Body, Location, NavDB, CATEGORY_MAP, dist

HERE = Path(sys.executable).parent if getattr(sys, "frozen", False) else Path(__file__).resolve().parent
DB_PATH = HERE / "locations.json"
VALALOL_URL = "https://raw.githubusercontent.com/Valalol/Star-Citizen-Navigation/main/Database.json"
STARNAV_API = "https://crates.io/api/v1/crates/starnav"
UA = {"User-Agent": "quantum-nav-importer (personal tool)"}
KM = 1000.0


def fetch(url):
    with urllib.request.urlopen(urllib.request.Request(url, headers=UA), timeout=60) as r:
        return r.read()


def load_starnav(folder=None):
    if folder:
        f = Path(folder)
        return (json.loads((f / "objContainers.json").read_text(encoding="utf-8")),
                json.loads((f / "pois.json").read_text(encoding="utf-8")))
    ver = json.loads(fetch(STARNAV_API))["crate"]["max_version"]
    print(f"Downloading starnav {ver} data ...")
    blob = fetch(f"https://static.crates.io/crates/starnav/starnav-{ver}.crate")
    with tarfile.open(fileobj=io.BytesIO(blob), mode="r:gz") as tar:
        def member(name):
            m = next(m for m in tar.getmembers() if m.name.endswith("/" + name))
            return json.loads(tar.extractfile(m).read().decode("utf-8"))
        return member("objContainers.json"), member("pois.json")


def main():
    args = sys.argv[1:]
    offline = args[:1] == ["--offline"]
    if offline:
        valalol = json.loads(Path(args[1]).read_text(encoding="utf-8"))
        containers, pois = load_starnav(args[2])
    else:
        print("Downloading Valalol database ...")
        valalol = json.loads(fetch(VALALOL_URL))
        containers, pois = load_starnav()

    db = NavDB.load(DB_PATH)
    old_bodies = dict(db.bodies)
    keep = {n: l for n, l in db.locations.items() if l.source in ("user", "mission")}
    db.bodies, db.locations = {}, {}

    def add_loc(loc: Location):
        name = loc.name
        if name in keep or name in db.locations:
            name = f"{loc.name} ({loc.body or loc.system})"
        if name in keep or name in db.locations:
            return
        loc.name = name
        db.locations[name] = loc

    sn_by_name = {c["name"].lower(): c for c in containers}

    # ---------------------------------------------------------------- Stanton (Valalol base)
    for cname, c in valalol["Containers"].items():
        if cname == "Delamar":
            continue  # Delamar lives in Nyx now
        center = (c["X"] * KM, c["Y"] * KM, c["Z"] * KM)
        radius = c.get("Body Radius", 0) * KM
        if radius > 0:
            sn = sn_by_name.get(cname.lower(), {})
            kind = "star" if cname == "Stanton" else ("planet" if radius >= 700_000 else "moon")
            period = c.get("Rotation Speed", 0.0) or sn.get("rot_vel_x", 0.0)   # e.g. Clio: 0 in one, 3.25 h in the other
            db.bodies[cname] = Body(cname, center, radius, period,
                                    # starnav's offsets are newer than Valalol's (3.17)
                                    sn.get("rot_adj_x") or c.get("Rotation Adjust", 0.0),
                                    om_radius_m=c.get("OM Radius", 0) * KM, system="Stanton",
                                    internal=sn.get("internal_name", ""), kind=kind)
        else:
            add_loc(Location(cname, "space", center, None, notes="Lagrange point", source="db",
                             system="Stanton", category="lpoint"))
        for pname, p in c.get("POI", {}).items():
            qt = str(p.get("QTMarker", "")).upper() == "TRUE"
            local = (p["X"] * KM, p["Y"] * KM, p["Z"] * KM)
            if radius > 0:
                add_loc(Location(pname, "surface", local, cname, source="db", system="Stanton", qt=qt))
            else:
                add_loc(Location(pname, "space", tuple(a + b for a, b in zip(center, local)), None,
                                 source="db", system="Stanton", qt=qt))

    # ---------------------------------------------------------------- Pyro + Nyx bodies (starnav)
    for c in containers:
        if c["system"] not in ("Pyro", "Nyx") or c["cont_type"] not in ("Planet", "Moon", "Star"):
            continue
        radius = c["body_radius"]
        if radius <= 0:
            continue
        if c["cont_type"] == "Star" and radius < 1e7:
            radius *= KM  # star radius is stored in km in this dataset
        kind = c["cont_type"].lower()
        db.bodies[c["name"]] = Body(c["name"], (c["pos_x"], c["pos_y"], c["pos_z"]), radius,
                                    c["rot_vel_x"], c["rot_adj_x"], om_radius_m=c["om_radius"],
                                    system=c["system"], internal=c["internal_name"], kind=kind)
    # Pyro Lagrange points
    for c in containers:
        pos = (c["pos_x"], c["pos_y"], c["pos_z"])
        if c["cont_type"] == "Lagrange" and c["system"] == "Pyro":
            add_loc(Location(c["name"].replace("_", "-"), "space", pos, None, notes="Lagrange point",
                             source="db", system="Pyro", category="lpoint"))
    # Gateway stations at the jump points, all three systems (see gateways.py). The ones in Pyro and
    # Nyx get a position once you've taken a /showlocation there (places.json).
    gateways.apply(db, gateways.load_learned(HERE / "places.json"))
    # Checkmate sits at Pyro II L4; the dataset has no coordinates for it, so pin it to the L-point.
    l4 = db.locations.get("P2-L4")
    if l4:
        add_loc(Location("Checkmate Station", "space", l4.pos, None, notes="Position approximate (at P2-L4)",
                         source="db", system="Pyro", qt=True, category="station"))

    # ---------------------------------------------------------------- POIs (starnav)
    body_ci = {b.lower(): b for b in db.bodies}
    added = updated = 0
    for p in pois:
        if "(example)" in p["name"].lower() or not p["name"].strip():
            continue
        bname = body_ci.get((p.get("obj_container") or "").lower())
        if not bname:
            continue
        body = db.bodies[bname]
        local = (p["pos_x"] * KM, p["pos_y"] * KM, p["pos_z"] * KM)
        cat = CATEGORY_MAP.get(p.get("poi_type"), "")
        # Already known (same place within 300 m)? Just enrich it.
        dup = next((l for l in db.locations.values() if l.body == bname and l.kind == "surface"
                    and dist(l.pos, local) < 300), None)
        if dup:
            dup.qt = dup.qt or bool(p.get("has_qt_marker"))
            dup.category = dup.category or cat
            updated += 1
            continue
        add_loc(Location(p["name"], "surface", local, bname, source="db", system=body.system,
                         qt=bool(p.get("has_qt_marker")), category=cat))
        added += 1

    for b in db.bodies.values():               # remember the community value, so it can be restored
        b.community_offset_deg = b.rotation_offset_deg
    # Keep calibrations the user already made.
    for name, b in old_bodies.items():
        if b.calibrated and name in db.bodies:
            db.bodies[name].rotation_offset_deg, db.bodies[name].calibrated = b.rotation_offset_deg, True

    db.locations.update(keep)
    from app import apply_calibrations
    res = Path(getattr(sys, "_MEIPASS", HERE))
    for cal in (res / "builtin_calibrations.json", HERE / "calibrations.json"):   # shipped, then yours
        if cal.exists():
            applied, _ = apply_calibrations(db, json.loads(cal.read_text(encoding="utf-8")))
            if applied:
                print(f"Applied planet alignments from {cal.name}: {', '.join(applied)}")
    db.save()
    # Descriptive system/planet info from the Star Citizen Wiki (CC BY-SA 4.0) for the info cards.
    if not offline:
        try:
            import wiki
            blob = fetch(wiki.URL)
            json.loads(blob)                       # only save it if it's valid JSON
            (HERE / "wiki_systems.json").write_bytes(blob)
            print("Downloaded Star Citizen Wiki system info (starcitizen.tools, CC BY-SA 4.0)")
        except Exception as e:
            print(f"Skipped wiki system info ({e}); the map works without it")
    # Services at each location (landing pads, hangars, refinery, clinic, shops...) from the Star
    # Citizen Wiki API, built from the game files for the current game version.
    if not offline:
        try:
            import services
            print("Downloading location services from the Star Citizen Wiki API ...")
            recs = services.fetch_all()
            services.save(recs, HERE / "services.json")
            print(f"Saved services for {sum(1 for r in recs if r['amenities'])} locations "
                  f"(matched {len(services.match(recs, db.locations))} of Quantum's places)")
        except Exception as e:
            print(f"Skipped location services ({e}); everything else works without them")
    per = {s: sum(1 for l in db.locations.values() if l.system == s and l.source == "db")
           for s in ("Stanton", "Pyro", "Nyx")}
    nb = {s: sum(1 for b in db.bodies.values() if b.system == s) for s in ("Stanton", "Pyro", "Nyx")}
    print(f"Bodies: {nb}\nPlaces: {per} ({added} new from starnav, {updated} merged)\n"
          f"Kept {len(keep)} of your own waypoints and mission stops.")


if __name__ == "__main__":
    main()
