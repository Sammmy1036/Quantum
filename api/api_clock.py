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
        return c

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
        if not (city.split(" (")[0].lower() in nav_core.CITIES and city in self._db.locations):
            return None
        return city

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
                    self._clock.show({"city": city, "body": body, "hours": hours}, cfg["position"], cfg["h24"], cfg["size"], (cfg["x"], cfg["y"]))
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

    def city_clock_image(self, city="New Babbage"):
        """The clock as it looks now, as a picture (for placing it in Settings): its size at 1080p."""
        with self._lock:
            c = self._clock_cfg()
            city = city if city in self._db.locations else "New Babbage"
            hours, body = self._city_local_hours(city), self._db.locations[city].body
        try:
            import base64, io
            img = city_clock.render({"city": city, "body": body, "hours": hours or 12.0}, RES / "ui" / "fonts",
                                    city_clock.SIZES.get(c["size"], 1.0), c["h24"])
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
        self._clock.show({"city": city, "body": body, "hours": hours}, c["position"], c["h24"], c["size"], (c["x"], c["y"]))
        return {"ok": True, "available": city_clock.AVAILABLE}

    def set_option(self, key, value):
        """Simple on/off settings shown in the Settings panel."""
        if key not in ("clear_log_on_start",):
            return {"ok": False}
        self._settings[key] = bool(value)
        self._save_settings()
        return {"ok": True}

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
