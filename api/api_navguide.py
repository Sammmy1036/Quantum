"""Api, part of: live directions over a planet or moon, and the navigation guide drawn over the game.

A mixin of app.py's Api (class Api(... NavGuideMixin ...)): the methods are the Api's, `self` is the one Api.
Module-level names come from qbase.py.

While you fly over a planet or moon and Quantum knows where you are (the dead-reckoned position from your last
/showlocation, game/deadreckon.py, or a /showlocation in the last two minutes), the distance and compass heading to
a place on that same body are worked out from where you are now, not from the quantum marker you'd jump to first:
    get_live's "no_qt"[name]["here"]  the route's no-quantum-marker notice ("fly 12.4 km heading 62° from here")
    the navigation guide              an arrow over the game (Settings > Navigation Guide Overlay), towards your
                                      Guide me target, else your next route stop"""
from qbase import *  # noqa: F401,F403
from game import nav_overlay
from planner.nav_core import great_circle

NAV_FIX_S = 120          # a /showlocation this recent still counts as where you are (landed, or barely moved)
NAV_ARRIVED_M = 150      # this close: you're there, the guide goes away
ATMO_FRAC = 0.1          # in the air: lower than a tenth of the planet's radius above it (the game's atmospheres
                         # end about there: Daymar ~30 km, Hurston and microTech ~100 km). Higher up, at an orbital
                         # marker or just out of a quantum jump, you're still in space and the guide waits


class NavGuideMixin:
    def _nav_from_here(self, L, t=None):
        """Distance and heading from where you are now to place L on the planet or moon you're over.
        {ground, heading, climb, err, how: "dr"|"fix", ship, turn} or None (another body, or no position)."""
        t = t or time.time()
        if L is None or L.kind != "surface" or not L.body or L.body not in self._db.bodies:
            return None
        b = self._db.bodies[L.body]
        dr, _ = self._dr_objs()
        e = dr.estimate(t)
        if e and e["body"] == b.name:
            local, err, how = e["local"], e["err_m"], "dr"
        elif self._player is not None and self._player_t and t - self._player_t < NAV_FIX_S and self._player_sys == L.system:
            here = self._db.body_near(self._player, self._player_sys)
            if here is None or here.name != b.name:
                return None
            local, err, how = here.to_local(self._player, self._player_t), 30, "fix"
        else:
            return None
        plat, plon, palt = b.lat_lon_alt(local)
        tb, tlocal = self._db.local_of(L)
        if tb is None:
            return None
        tlat, tlon, talt = b.lat_lon_alt(tlocal)
        ground, heading = great_circle(plat, plon, tlat, tlon, b.radius_m)
        out = {"ground": round(ground), "heading": round(heading % 360, 1), "climb": round(talt - palt), "err": err, "how": how,
               "ship": None, "turn": None, "alt": round(palt), "in_air": palt < b.radius_m * ATMO_FRAC}
        tel = getattr(self, "_tel", None)
        v = (tel.state().get("vehicle") or {}) if tel is not None and tel.enabled else {}
        # The game only sends your altitude once you're in a planet's atmosphere (none out in space): that, and
        # only that, says you're in the air. The height rule above is for when telemetry has nothing to say.
        out["tel_alt"] = v.get("altitude") if v.get("flight_data") else None
        if out["tel_alt"] is not None or v.get("radar_alt") is not None:
            out["in_air"] = bool(out["tel_alt"]) or bool(v.get("radar_alt"))
        elif v.get("flight_data"):
            out["in_air"] = False
        if v.get("heading") is not None and v.get("flight_data"):
            out["ship"] = round(float(v["heading"]) % 360, 1)
            out["turn"] = round(((heading - out["ship"] + 540) % 360) - 180, 1)     # + right, - left
        return out

    def _nav_landed_at(self, L):
        """The log has you landed or docked at L, or anywhere in L's city (a hangar at Teasa Spaceport when you're
        guided to Teasa, or to Lorville): you're there, whatever the dead reckoning says. The same rule ticks off a
        route stop (_auto_arrive). A city's spaceport is only placed to within a few km, so the 150 m rule alone
        never saw you arrive at one."""
        cur = self._tracker.cur or {}
        if L is None or not cur.get("landing") or not cur.get("place"):
            return False
        here = self._db.locations.get(cur["place"])
        if cur["place"] == L.name or L.name in place_group(cur["place"]):
            return True
        return bool(here and L.body and here.body == L.body and here.pos is not None and L.pos is not None
                    and classify(here.name, here.category) == "city" and dist(here.pos, L.pos) < 30_000)

    HANGAR_NEAR_M = 30_000    # a hangar request this close to where you're guided (a city's traffic control answers
                              # from about 10-15 km out) means you've made it
    HANGAR_FRESH_S = 600      # ...and only a request in the last 10 minutes

    def _nav_hangar_at(self, L, nav, now):
        """The game gave you a hangar ("Hangar Request Completed" in Game.log) near L since you were guided there:
        you've made it, so the guide stops then rather than once you've landed."""
        h = getattr(self._tracker, "hangar_at", None)
        if L is None or not h or not (0 <= now - h <= self.HANGAR_FRESH_S):
            return False
        if h < (getattr(self, "_guide_since", 0) or 0) and self._guide == L.name:
            return False                                  # that request was before you asked to be guided here
        if nav is not None:
            return nav["ground"] < self.HANGAR_NEAR_M
        # no position to go by: where the log last named you (the city whose traffic control you talked to)
        w = self._tracker.where or {}
        wp = self._tracker.place_for_code(w["code"]) if w.get("code") else None
        here = self._db.locations.get(wp or "")
        return bool(here is not None and here.pos is not None and L.pos is not None and here.body == L.body
                    and (wp == L.name or L.name in place_group(wp) or dist(here.pos, L.pos) < self.HANGAR_NEAR_M))

    def _nav_target(self):
        """Where the guide points: your Guide me target, else the first stop of your route."""
        if self._guide and self._guide in self._db.locations:
            return self._db.locations[self._guide]
        for task in self._route:
            L = self._db.locations.get(task.get("place"))
            if L is not None:
                return L
        return None

    # ------------------------------------------------------------ settings
    def _nav_cfg(self):
        c = {"on": False, "position": "bottom", "size": "medium", "style": "arrow", "color": "blue", "opacity": 100,
             "x": 0.5, "y": 0.62, **(self._settings.get("nav_overlay") or {})}
        c["on"] = bool(c["on"])
        if c["position"] not in nav_overlay.POSITIONS:
            c["position"] = "bottom"
        if c["size"] not in nav_overlay.SIZES:
            c["size"] = "medium"
        if c["style"] not in nav_overlay.STYLES:
            c["style"] = "arrow"
        if c["color"] not in nav_overlay.COLORS:
            c["color"] = "blue"
        if c["opacity"] not in nav_overlay.OPACITIES:
            c["opacity"] = 100
        return c

    def _nav_view(self):
        """For get_live: the settings, whether it can work here, whether it's showing, and where it points (the
        page draws that place's icon and hands it over: nav_overlay_icon)."""
        L = self._nav_target()
        return {**self._nav_cfg(), "available": nav_overlay.AVAILABLE, "showing": bool(getattr(self, "_nav_showing", False)),
                "target": L.name if L is not None else None, "has_icon": bool(L is not None and L.name in self._nav_icons_())}

    def _nav_icons_(self):
        if not hasattr(self, "_nav_icons"):
            self._nav_icons = {}
        return self._nav_icons

    def nav_overlay_icon(self, name, data_url):
        """The icon of the place the guide points to (its map symbol, or a waypoint's own), drawn white by the page
        (the app's icons are SVG in the page): the guide shows it in its colour on the tape, ring or by the name."""
        try:
            import io
            from PIL import Image
            raw = base64.b64decode(str(data_url).split(",", 1)[1])
            img = Image.open(io.BytesIO(raw)).convert("RGBA")
            icons = self._nav_icons_()
            if len(icons) > 40:
                icons.clear()
            icons[str(name)] = img
            return {"ok": True}
        except Exception as e:
            return {"ok": False, "error": str(e)}

    def set_nav_overlay(self, prefs):
        """Settings > Navigation Guide Overlay: on/off, look (arrow / compass / tape), colour, size, position, opacity."""
        prefs = prefs or {}
        with self._lock:
            c = self._nav_cfg()
            if "on" in prefs:
                c["on"] = bool(prefs["on"])
            for k, ok in (("position", nav_overlay.POSITIONS), ("size", nav_overlay.SIZES), ("style", nav_overlay.STYLES),
                          ("color", nav_overlay.COLORS)):
                if prefs.get(k) in ok:
                    c[k] = prefs[k]
            try:
                op = int(prefs["opacity"]) if prefs.get("opacity") is not None else None
            except (TypeError, ValueError):
                op = None
            if op in nav_overlay.OPACITIES:
                c["opacity"] = op
            for k in ("x", "y"):
                v = prefs.get(k)
                if isinstance(v, (int, float)) and not isinstance(v, bool):
                    c[k] = round(min(1.0, max(0.0, float(v))), 4)
            self._settings["nav_overlay"] = c
            self._save_settings()
        return {"ok": True, **c}

    def nav_overlay_image(self, style=None):
        """The guide as a picture, for the looks to pick from in Settings (its size at 1080p)."""
        c = self._nav_cfg()
        try:
            import io
            img = nav_overlay.render({"name": "Onyx Facility S2B6", "dist": 113400, "turn": -24.0, "heading": 62.0, "ship": 86.0},
                                     RES / "ui" / "fonts", nav_overlay.SIZES.get(c["size"], 1.0) * 0.8, c["color"],
                                     style if style in nav_overlay.STYLES else c["style"])
            raw = bytearray(img.tobytes())          # premultiplied for the window: undo that for a picture
            for i in range(0, len(raw), 4):
                a = raw[i + 3]
                if 0 < a < 255:
                    raw[i] = min(255, raw[i] * 255 // a)
                    raw[i + 1] = min(255, raw[i + 1] * 255 // a)
                    raw[i + 2] = min(255, raw[i + 2] * 255 // a)
            from PIL import Image
            pic = Image.frombytes("RGBA", img.size, bytes(raw))
            buf = io.BytesIO()
            pic.save(buf, "PNG")
            return {"ok": True, "image": "data:image/png;base64," + base64.b64encode(buf.getvalue()).decode(),
                    "w": pic.size[0], "h": pic.size[1]}
        except Exception as e:
            return {"ok": False, "error": str(e)}

    def preview_nav_overlay(self):
        """Show the guide for 15 seconds (once you click back into Star Citizen), turning, to see how it looks."""
        self._nav_preview_until = time.time() + 15
        return {"ok": True, "available": nav_overlay.AVAILABLE}

    # ------------------------------------------------------------ the overlay
    def _nav_guide_loop(self):
        if not nav_overlay.AVAILABLE:
            return
        self._nav_guide = nav_overlay.NavOverlay(RES / "ui" / "fonts")
        while True:
            try:
                now = time.time()
                c = self._nav_cfg()
                look = {"color": c["color"], "style": c["style"], "opacity": c["opacity"]}
                info = None
                if now < getattr(self, "_nav_preview_until", 0):
                    turn = 50 * math.sin(now / 2)
                    info = {"name": "Onyx Facility S2B6", "dist": 113400 - (15 - (self._nav_preview_until - now)) * 900,
                            "turn": turn, "heading": 62.0, "ship": (62.0 - turn) % 360}
                elif c["on"] and self._game_on():
                    with self._lock:
                        L = self._nav_target()
                        arrived = self._nav_landed_at(L)
                        if arrived and L is not None and self._guide == L.name:
                            # Guide me is done: you've landed there (the city clock says so too)
                            self._guide = None
                            self._save_settings()
                        nav = self._nav_from_here(L, now) if L is not None and not arrived else None
                        if not arrived and self._nav_hangar_at(L, nav, now):
                            arrived, nav = True, None     # your hangar's assigned: the guide's job is done
                            if self._guide == L.name:
                                self._guide = None
                                self._save_settings()
                    tel = getattr(self, "_tel", None)
                    v = (tel.state().get("vehicle") or {}) if tel is not None and tel.enabled else {}
                    if v.get("landed"):
                        nav = None                        # sat on the ground (a pad, a hangar): nothing to steer
                    # only flying (a heading from the ship), in the air over the place's planet or moon, and not there yet
                    if nav and nav["turn"] is not None and nav["in_air"] and nav["ground"] > NAV_ARRIVED_M:
                        info = {"name": L.name, "dist": nav["ground"], "turn": nav["turn"], "heading": nav["heading"],
                                "ship": nav["ship"], "icon": self._nav_icons_().get(L.name)}
                if info:
                    self._nav_guide.show(info, c["position"], None, c["size"], (c["x"], c["y"]), look)
                else:
                    self._nav_guide.hide()
                self._nav_showing = bool(info)
            except Exception:
                try:
                    from game import watcher
                    watcher.log_error("navigation guide")
                except Exception:
                    pass
                time.sleep(2)
            time.sleep(0.1)                               # new readings 10 times a second; the window eases between them
