"""Api, part of: The city clock overlay.

A mixin of app.py's Api (class Api(... ClockMixin ...)): the methods are the Api's, `self` is the one Api.
Module-level names come from qbase.py."""
from qbase import *  # noqa: F401,F403


class ClockMixin:
    # ------------------------------------------------------------ city clock overlay
    def _clock_cfg(self):
        c = {"mode": "10", "position": "top", "h24": True, "size": "large", "again": "seat", "x": 0.5, "y": 0.07,
             **(self._settings.get("city_clock") or {})}
        if c["again"] not in ("seat", "hangar", "both", "none"):
            c["again"] = "seat"
        if c["mode"] not in city_clock.MODES:
            c["mode"] = "10"
        if c["size"] not in city_clock.SIZES:
            c["size"] = "large"
        c["color"] = c.get("color") if c.get("color") in city_clock.COLORS else "blue"
        c["style"] = c.get("style") if c.get("style") in city_clock.STYLES else "full"
        c["opacity"] = c.get("opacity") if c.get("opacity") in city_clock.OPACITIES else 100
        c["where"] = c.get("where") if c.get("where") in city_clock.WHERE else "cities"
        return c

    def _clock_look(self, c):
        return {k: c[k] for k in ("color", "style", "opacity")}

    def _city_local_hours(self, city, t=None):
        """Local time of day (0-24) in a city, from its planet's spin and where its star is."""
        L = self._db.locations.get(city)
        b = self._db.bodies.get(L.body) if L is not None and L.body else None
        star = next((s for s in self._db.bodies.values() if s.kind == "star" and b is not None and s.system == b.system), None)
        if L is None or b is None or star is None or L.kind != "surface" or not b.rotation_period_h:
            return None
        return nav_core.local_solar_time(b, tuple(L.pos), tuple(star.center), t or time.time())

    def _city_now(self):
        """The city the log says you're in right now (its spaceport counts), or None."""
        if not self._game_on():
            return None
        tr = self._tracker
        cur = tr.cur or {}
        # Only once you're in the game world, and only for where this session's log puts you: not over the
        # launcher, loading screens or main menu because of where you were last time.
        if not tr.in_pu or tr.loading or cur.get("at", 0) < tr.pu_at:
            return None                                   # (the loading screen: you aren't in the world yet)
        if not cur.get("landing") and (cur.get("left") or cur.get("jump")):
            return None                                   # took off / in quantum: not in a city any more
        spot, spot_at, how = self._log_spot(cur)
        if not spot or how not in ("landed", "log"):
            return None
        city = spaceport_city(spot) or spot
        if city.split(" (")[0].lower() in nav_core.CITIES and city in self._db.locations:
            return city
        # "Other known locations" (Settings): any place on a planet or moon the log puts you at, with a local time
        # (outposts, settlements, distribution centres, Levski…). Only once you've landed or the log names it.
        if self._clock_cfg().get("where") == "all":
            L = self._db.locations.get(city)
            if L is not None and L.kind == "surface" and L.body and L.source != "user" and self._city_local_hours(city) is not None:
                return city
        return None

    def _city_confirmed(self, city, since):
        """A city named only by the log's inventory location ("Location[Stanton1_Lorville]") isn't proof you're
        there: the game names the planet's city for a wide area, so it came up on Hurston's and ArcCorp's moons
        and flying low over the planet. It counts when something else agrees: you're inside an armistice zone
        (cities are one), and your latest /showlocation, if there's a recent one, is near the city."""
        tr = self._tracker
        arm = getattr(tr, "armistice", None)
        if not arm or not arm[0] or arm[1] < since - 600:
            return False                                  # not inside an armistice zone since the log named it
        L = self._db.locations.get(city)
        w = tr.where or {}
        if L is not None and L.body and w.get("body") and w.get("body") != L.body and (w.get("at") or 0) >= since:
            return False                                  # the log puts you on another planet or moon since
        if self._player and self._player_t and time.time() - self._player_t < 900 and self._player_t >= since - 60 \
                and L is not None and self._player_sys == L.system:
            try:
                if dist(self._player, self._db.global_pos(L, self._player_t)) > 60_000:
                    return False                          # your own reading has you somewhere else
            except Exception:
                pass
        return True

    def _city_clock_loop(self):
        while True:
            try:
                with self._lock:
                    cfg = self._clock_cfg()
                    city = self._city_now() if cfg["mode"] != "off" else None
                    now = time.time()
                    if city != self._clock_city:
                        self._clock_city, self._clock_since = city, now     # arrived (or left)
                    # The city is known as soon as you enter its airspace, minutes before you touch down. Getting
                    # out of the pilot's seat there (you've landed) shows the clock again, when you'll see it.
                    veh = self._tracker.vehicle or {}
                    seat_left = veh.get("at") if veh.get("seat") is False else None
                    if seat_left and seat_left != self._clock_seat:
                        self._clock_seat = seat_left
                        if city and now - seat_left < 60 and cfg["again"] in ("seat", "both"):
                            self._clock_since = now
                    # Respawned (after dying, at a city's medical centre, say): you're arriving again
                    spawned = self._tracker.spawned_at
                    if spawned and spawned != getattr(self, "_clock_spawn", None) and (city or now - spawned >= 60):
                        self._clock_spawn = spawned                # (waits a moment for the log to say where you are)
                        if city and now - spawned < 60 and cfg["again"] != "none":
                            self._clock_since = now
                    # Cleared to land: "Hangar Request Completed" (a minute or so before you touch down)
                    hangar = self._tracker.hangar_at
                    if hangar and hangar != getattr(self, "_clock_hangar", None):
                        self._clock_hangar = hangar
                        if city and now - hangar < 60 and cfg["again"] in ("hangar", "both"):
                            self._clock_since = now
                    hours = self._city_local_hours(city, now) if city else None
                    body = self._db.locations[city].body if city else None
                if now < getattr(self, "_clock_preview_until", 0):
                    time.sleep(1)
                    continue                                  # a preview from Settings is showing
                keep = cfg["mode"] == "city" or (cfg["mode"].isdigit() and now - self._clock_since < int(cfg["mode"]))
                if city and hours is not None and keep:
                    self._clock.show({"city": city, "body": body, "hours": hours}, cfg["position"], cfg["h24"], cfg["size"],
                                     (cfg["x"], cfg["y"]), self._clock_look(cfg))
                else:
                    self._clock.hide()
            except Exception:
                watcher_mod.log_error("city clock")
            time.sleep(1)

    def set_city_clock(self, mode=None, position=None, h24=None, size=None, again=None, x=None, y=None):
        """Location clock overlay: mode off / 5 / 10 / 15 (seconds after arriving) / city (the whole time there)."""
        with self._lock:
            c = self._clock_cfg()
            if mode in city_clock.MODES:
                c["mode"] = mode
            if position in city_clock.POSITIONS:
                c["position"] = position
            if h24 is not None:
                c["h24"] = bool(h24)
            if size in city_clock.SIZES:
                c["size"] = size
            if again in ("seat", "hangar", "both", "none"):
                c["again"] = again
            for k, v in (("x", x), ("y", y)):
                if isinstance(v, (int, float)) and not isinstance(v, bool):
                    c[k] = round(min(1.0, max(0.0, float(v))), 4)
            self._settings["city_clock"] = c
            self._save_settings()
        return {"ok": True, **c}

    def set_city_clock_look(self, prefs):
        """Settings > Location Clock Overlay: colour, layout (full / compact / time only), opacity, and where it
        shows (the four cities, or every known place on a planet or moon)."""
        prefs = prefs or {}
        with self._lock:
            c = self._clock_cfg()
            for k, ok in (("color", city_clock.COLORS), ("style", city_clock.STYLES), ("where", city_clock.WHERE)):
                if prefs.get(k) in ok:
                    c[k] = prefs[k]
            try:
                op = int(prefs.get("opacity")) if prefs.get("opacity") is not None else None
            except (TypeError, ValueError):
                op = None
            if op in city_clock.OPACITIES:
                c["opacity"] = op
            self._settings["city_clock"] = c
            self._save_settings()
        return {"ok": True, **c}

    def city_clock_image(self, city="New Babbage"):
        """The clock as it looks now, as a picture (for placing it in Settings): its size at 1080p."""
        with self._lock:
            c = self._clock_cfg()
            city = city if city in self._db.locations else "New Babbage"
            hours, body = self._city_local_hours(city), self._db.locations[city].body
        try:
            import base64, io
            img = city_clock.render({"city": city, "body": body, "hours": hours or 12.0}, RES / "ui" / "fonts",
                                    city_clock.SIZES.get(c["size"], 1.0), c["h24"], c["color"], c["style"])
            raw = bytearray(img.tobytes())          # the overlay's colours are premultiplied: undo that for a picture
            for i in range(0, len(raw), 4):
                a = raw[i + 3]
                if 0 < a < 255:
                    raw[i] = min(255, raw[i] * 255 // a)
                    raw[i + 1] = min(255, raw[i + 1] * 255 // a)
                    raw[i + 2] = min(255, raw[i + 2] * 255 // a)
            from PIL import Image
            img = Image.frombytes("RGBA", img.size, bytes(raw))
            buf = io.BytesIO()
            img.save(buf, "PNG")
            return {"ok": True, "image": "data:image/png;base64," + base64.b64encode(buf.getvalue()).decode(),
                    "w": img.size[0], "h": img.size[1]}
        except Exception as e:
            return {"ok": False, "error": str(e)}

    def preview_city_clock(self, city="New Babbage"):
        """Show the clock for a few seconds (once you click back into Star Citizen) to see how it looks."""
        with self._lock:
            c = self._clock_cfg()
            city = city if city in self._db.locations else "New Babbage"
            hours, body = self._city_local_hours(city), self._db.locations[city].body
        if hours is None:
            return {"ok": False, "error": "That city's planet has no day length in the map data"}
        self._clock_preview_until = time.time() + 15
        self._clock.show({"city": city, "body": body, "hours": hours}, c["position"], c["h24"], c["size"], (c["x"], c["y"]),
                         self._clock_look(c))
        return {"ok": True, "available": city_clock.AVAILABLE}

    def set_option(self, key, value):
        """Simple on/off settings shown in the Settings panel."""
        if key not in ("clear_log_on_start",):
            return {"ok": False}
        self._settings[key] = bool(value)
        self._save_settings()
        return {"ok": True}

    # The order of the sections in the left-hand rail, as the user dragged them (group names, top to bottom).
    # Empty: the default order.
    def rail_order(self):
        o = self._settings.get("rail_order")
        return {"ok": True, "order": o if isinstance(o, list) else []}

    def rail_order_set(self, order):
        order = [g[:30] for g in order if isinstance(g, str)][:40] if isinstance(order, list) else []
        if order:
            self._settings["rail_order"] = order
        else:
            self._settings.pop("rail_order", None)
        self._save_settings()
        return {"ok": True, "order": order}

    # Quantum's own title bar (Settings > Window). "quantum": the page draws the bar, "windows": the normal
    # Windows frame. Chosen when the window opens, so a change takes effect at the next start.
    def window_style(self):
        from desktop import frameless
        style = "windows" if self._settings.get("window_style") == "windows" or not frameless.AVAILABLE else "quantum"
        return {"ok": True, "style": style, "active": bool(getattr(self, "_frameless", False)),
                "max": frameless.is_maximised(), "available": frameless.AVAILABLE}

    def set_window_style(self, style):
        self._settings["window_style"] = "windows" if style == "windows" else "quantum"
        self._save_settings()
        return self.window_style()

    def win_minimize(self):
        from desktop import frameless
        return frameless.minimise()

    def win_toggle_max(self):
        from desktop import frameless
        return {"max": frameless.toggle_maximise()}

    def win_close(self):
        from desktop import frameless
        return frameless.close()

    def win_drag(self, edge="caption"):
        from desktop import frameless
        return frameless.drag(edge)

    def test_autoloc(self, delay=5):
        self._sender.send_after(delay)
        return {"ok": True}

    def get_services(self, name):
        """Services, jurisdiction and in-game description for one place (None if unknown), plus fuel
        prices from UEX when there's a token."""
        r = self._services.get(name)
        out = dict(r, pad=services.pad_from(r["amenities"])) if r else None
        fuel = self._fuel_at(name)
        if fuel:
            out = dict(out or {"amenities": [], "pad": None}, fuel=fuel)
        return out
