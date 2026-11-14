"""Api, part of: Patch Hub (new ships, events, LIVE and PTU patch notes, RSI store, upcoming ships).

A mixin of app.py's Api (class Api(... PatchHubMixin ...)): the methods are the Api's, `self` is the one Api.
Module-level names come from qbase.py.

The Quantum server builds the hub (patchhub.py, the same file) and serves it at /v1/patchhub, so one copy is
fetched from RSI and the wiki for everyone. If the server doesn't answer, or doesn't have it, Quantum builds its
own copy in uex_cache/ the same way, so the page works either way."""
from qbase import *  # noqa: F401,F403
import patchhub

PH_SERVER_TTL = 10 * 60          # ask the server again after 10 minutes (it refreshes on its own schedule)


class PatchHubMixin:
    def _ph_local(self):
        if getattr(self, "_ph_hub", None) is None:
            self._ph_hub = patchhub.Hub(HERE / "uex_cache", events_file=HERE / "patchhub_events.json",
                                        log=lambda *a: print("patchhub:", *a, flush=True))
        return self._ph_hub

    def _ph_from_server(self, force=False):
        """(hub, building): the server's copy (kept PH_SERVER_TTL), or (None, status) while the server is still
        building it ({"progress", "partial"}), or (None, None) when the server is off, down or doesn't have it."""
        got = getattr(self, "_ph_srv", None)
        if got and not force and time.time() - got[0] < PH_SERVER_TTL:
            return got[1], None
        com = getattr(self, "_community", None)
        if not com or not com.url:
            return None, None
        try:
            r = com._req("/v1/patchhub", timeout=12, session=False)
        except Exception:
            return (got[1], None) if got else (None, None)
        if not isinstance(r, dict):
            return None, None
        hub = r.get("hub") if r.get("status") == "ok" else None
        if isinstance(hub, dict) and hub.get("v") == patchhub.VERSION:
            self._ph_srv = (time.time(), hub)
            try:                                          # kept on disk: Vehicles adds its new ships UEX lacks
                f = HERE / "uex_cache" / "patchhub_server.json"
                f.parent.mkdir(parents=True, exist_ok=True)
                f.write_text(json.dumps(hub, ensure_ascii=False), encoding="utf-8")
            except Exception:
                pass
            return hub, None
        if r.get("status") == "building":
            part = r.get("partial")
            return None, {"progress": r.get("progress") or {},
                          "partial": part if isinstance(part, dict) and part.get("v") == patchhub.VERSION else None}
        return (got[1], None) if got else (None, None)

    def patchhub_get(self, refresh=False):
        """{ok, hub, source, seen, game, building, progress}. Never waits for a whole build: while one runs (on the
        server, or here when the server doesn't have the hub) it answers at once with what's in so far, and the
        page asks again a moment later."""
        hub, srv = self._ph_from_server(force=refresh)
        source, progress, building = "server", {}, False
        if hub is None and srv is not None:                 # the server is on it: show its progress
            hub, progress, building = srv["partial"], srv["progress"], True
        elif hub is None:
            source = "local"
            try:
                loc = self._ph_local()
                hub = loc.get(wait=False, force=bool(refresh))   # a saved copy now; a fresh one builds in the background
                stt = loc.status()
                if stt["building"] and hub is None:          # nothing saved yet: show the build as it comes in
                    hub, progress, building = stt["partial"], stt["progress"], True
            except Exception as e:
                watcher_mod.log_error("patch hub")
                return {"ok": False, "error": f"Couldn't load the Patch Hub: {e}"}
        game = {}
        try:
            v, env, running = self._dr_game_build()
            game = {"version": v, "env": env, "running": running}
        except Exception:
            pass
        return {"ok": True, "hub": hub, "source": source, "seen": self._settings.get("patchhub_seen") or [],
                "claimed": self._settings.get("patchhub_claimed") or [], "game": game, "building": building, "progress": progress}

    def patchhub_claim(self, key, on=True):
        """Tick (or untick) a Twitch drop reward as claimed. Kept by its key ("campaign|reward name"), so the
        tick stays through restarts and when the campaign's list is fetched again; only the most recent 300 kept."""
        key = str(key or "").strip()[:200]
        if not key:
            return {"ok": False, "error": "No reward given"}
        L = [k for k in self._settings.get("patchhub_claimed") or [] if k != key]
        if on:
            L.append(key)
        self._settings["patchhub_claimed"] = L[-300:]
        self._save_settings()
        return {"ok": True, "claimed": self._settings["patchhub_claimed"]}

    def patchhub_seen(self, keys):
        """The items you've now seen (their keys), so the rail's count only shows what's new to you."""
        if not isinstance(keys, list):
            return {"ok": False}
        old = [k for k in self._settings.get("patchhub_seen") or [] if k not in keys]
        self._settings["patchhub_seen"] = (old + [str(k)[:160] for k in keys])[-600:]
        self._save_settings()
        return {"ok": True}
