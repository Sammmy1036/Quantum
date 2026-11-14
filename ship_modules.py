"""Swappable ship modules (the RSI Galaxy's cargo, med bay and refinery modules), and what each one changes.

A module is picked per loadout in My Fleet (like a livery) and is shown on the ship's Vehicles page. Its
numbers replace the ship's own (cargo grid, medical beds…) wherever Quantum uses them: the loadout's stats,
the fleet list, trade-run cargo space and the website copy of the fleet.

Kept in one plain file with no imports from the rest of Quantum, so the server can use the very same copy.
To add another modular ship (the Aurora Mk II, the Retaliator…), add an entry to SHIP_MODULES."""
import re

# Each ship: the words its name must have, the module it comes with ("default"), and its modules. A module's
# numbers are the ship's totals with it fitted, not what it adds:
#   scu            cargo grid in SCU (the Galaxy's rear hangar keeps its 64 SCU whatever module is in)
#   medical_beds   medical beds, with medical_tiers {tier: beds}; medical_tier is the best one (1 is the best)
#   refinery       refining reactors (refinery modules)
#   concept        announced but not in the game yet: can be picked and looked at, flagged as a concept
#   notes          one line shown under the module on the Vehicles page
SHIP_MODULES = [
    {"match": {"galaxy"}, "default": "base",
     "source": "RSI Galaxy, flight ready in Alpha 4.10.3 (Star Citizen Wiki, IAE 2956 launch details)",
     "modules": [
         {"id": "base", "name": "Base", "full": "No module", "scu": 64,
          "notes": "The ship as it comes: 64 SCU in the rear hangar (4 × 16 SCU grids) and the afterdeck hangar."},
         {"id": "cargo", "name": "Cargo", "full": "Galaxy - Cargo Module", "scu": 720, "module_scu": 656,
          "notes": "656 SCU in the module plus the rear hangar's 64 SCU. Cargo lift takes two 32 SCU containers "
                   "or a vehicle up to an Ursa."},
         {"id": "medical", "name": "Med Bay", "full": "Galaxy - Med Bay Module", "scu": 64,
          "medical_beds": 8, "medical_tiers": {"1": 2, "2": 3, "3": 3}, "medical_tier": 1,
          "notes": "8 medical beds: 2 × Tier 1, 3 × Tier 2, 3 × Tier 3, with a lift to the afterdeck."},
         {"id": "refinery", "name": "Refinery", "full": "Galaxy - Refinery Module", "scu": 64,
          "refinery": 2, "concept": True,
          "notes": "2 refining reactors, larger than the Expanse's: bigger jobs, fewer at a time. "
                   "Planned for a later patch with its refining gameplay."}]},
]


def _words(v):
    if isinstance(v, str):
        text = v
    else:
        text = f"{v.get('name') or ''} {v.get('name_full') or v.get('full') or ''}"
    return set(re.findall(r"[a-z0-9]+", text.lower()))


def ship_modules(v):
    """The module set for a vehicle (a UEX row, a fleet ship or a plain name), or None. Module add-ons
    themselves ("Galaxy - Cargo Module") aren't ships and get None."""
    w = _words(v)
    if "module" in w:
        return None
    return next((s for s in SHIP_MODULES if s["match"] <= w), None)


def module_of(v, module_id=None):
    """The module fitted (module_id, or the ship's default when it's missing or unknown), or None."""
    s = ship_modules(v)
    if not s:
        return None
    return next((m for m in s["modules"] if m["id"] == module_id), None) or \
        next((m for m in s["modules"] if m["id"] == s["default"]), s["modules"][0])


def module_options(v, module_id=None):
    """{"current", "default", "modules": [...]} for the module picker, or None when the ship has none."""
    s = ship_modules(v)
    if not s:
        return None
    cur = module_of(v, module_id)
    return {"current": cur["id"], "default": s["default"], "source": s.get("source"),
            "modules": [dict(m) for m in s["modules"]]}


def apply_module(stats, m):
    """The ship's stats with module m fitted (a new dict): cargo, medical beds and refinery."""
    out = dict(stats or {})
    if not m:
        return out
    if m.get("scu") is not None:
        out["cargo"] = m["scu"]
    for k in ("medical_beds", "medical_tier", "refinery"):
        if m.get(k):
            out[k] = m[k]
        else:
            out.pop(k, None)
    return out
