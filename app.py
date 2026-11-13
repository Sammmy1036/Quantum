"""Quantum - 3D route planner, waypoint finder and contract map for Star Citizen.

Python backend + HTML/WebGL UI in a native window (pywebview / Edge WebView2).
Read-only data sources; nothing touches the game process:
  - /showlocation clipboard text  -> your position
  - Game.log                      -> contracts, exact objective markers, current system/planet
  - locations.json                -> map database (run import_data.py once)
"""
from qbase import *  # noqa: F401,F403  (imports, paths, constants, helpers: see qbase.py)
import api_core
import api_map
import api_backup
import api_gear
import api_social
import api_clock
import api_trade
import api_datarunner
import api_account
import api_updates
import api_catalog
import api_fleet
import api_shopping
import api_contracts
import api_watch
import api_friendmap
import api_cargo
import api_patchhub


# The page's API. Its methods live in the api_*.py mixins by subject; this class keeps start-up (__init__).
# One Api made of mixins, one per subject (api_*.py). No name may be defined in two of them (one would silently
# win): _check_mixins below stops Quantum at start if that ever happens.
class Api(api_contracts.ContractsMixin,
          api_shopping.ShoppingMixin,
          api_fleet.FleetMixin,
          api_catalog.CatalogMixin,
          api_updates.UpdatesMixin,
          api_account.AccountMixin,
          api_datarunner.DatarunnerMixin,
          api_trade.TradeMixin,
          api_clock.ClockMixin,
          api_social.SocialMixin,
          api_gear.GearMixin,
          api_backup.BackupMixin,
          api_map.MapMixin,
          api_core.CoreMixin,
          api_watch.WatchMixin,
          api_friendmap.FriendMapMixin,
          api_cargo.CargoMixin,
          api_patchhub.PatchHubMixin):

    def __init__(self):
        self._lock = threading.RLock()
        self._db = NavDB.load(DB_PATH)
        for _l in self._db.locations.values():         # contract stops saved before they had their own category
            if _l.source == "mission" and not _l.category:
                _l.category = "mission"
        self._db.path = DB_PATH
        if self._db.recovered:                         # an update replaced locations.json: yours are back
            self._db.save()
            n = self._db.recovered
            self._backup_note = f"Brought back {n} waypoint{'s' if n != 1 else ''} the update had left out"
        self._renamed = rename_gateways(self._db)
        self._renamed.update(rename_raw_pois(self._db))
        self._renamed.update(rename_rest_stops(self._db))
        ren, self._unplaced = gateways.apply(self._db, self._learned_places())
        self._renamed.update(ren)
        # Nyx (and anything else the community map data lacks) from the game files, via the Star
        # Citizen Wiki: the shipped snapshot or a newer download. Measured positions win.
        self._starmap_cache = HERE / "uex_cache" / "starmap_snapshot.json"
        try:
            _snap = self._snap = starmap_import.load_snapshot(HERE / "nyx_starmap.json", self._starmap_cache)
            starmap_import.apply(self._db, _snap, keep=self._learned_places())
            # Stanton and Pyro: PAFs, OLPs, security posts, depots... the community data lacks, and Pyro's
            # stations where the game files have them instead of at their Lagrange point
            starmap_import.apply_extra(self._db, _snap, keep=self._learned_places())
            # stations' spots from the game's own layout (tools/build_stations.py), where the data above is off
            self._station_pos = starmap_import.load_positions(HERE / "station_positions.json", RES / "station_positions.json")
            starmap_import.apply_positions(self._db, self._station_pos, keep=self._learned_places())
            # planets the data above only has as a marker (Nyx I), built from the game files themselves
            # (tools/build_game_planet.py): real size, rotation, game code and the places on them
            self._game_bodies = starmap_import.load_bodies(HERE / "game_bodies.json", RES / "game_bodies.json")
            starmap_import.apply_bodies(self._db, self._game_bodies, keep=self._learned_places())
            for name in [n for n, L in self._unplaced.items() if n in self._db.locations]:
                self._unplaced.pop(name, None)               # placed from the game files now
        except Exception:
            watcher_mod.log_error("starmap import")
        threading.Thread(target=starmap_import.refresh, args=(self._starmap_cache,), daemon=True).start()
        nav_core.normalize(self._db)          # after every import: Delamar is an asteroid, Levski a station
        ensure_spaceports(self._db)           # every city's spaceport (Teasa Spaceport at Lorville)
        self._db.save()
        for path in (BUILTIN_CAL_PATH, CAL_PATH):
            if not path.exists():
                continue
            try:
                applied, _ = apply_calibrations(self._db, json.loads(path.read_text(encoding="utf-8")))
                if applied:
                    self._db.save()
            except Exception:
                pass
        self._settings = self._load_settings()
        try:                                   # what datarunners agree on, from the last sync
            _cp = json.loads(COMMUNITY_PLACES_PATH.read_text(encoding="utf-8"))
            self._community_missing, self._community_pads = set(_cp.get("missing") or []), dict(_cp.get("pads") or {})
        except (OSError, ValueError, AttributeError):
            self._community_missing, self._community_pads = set(), {}
        # Stations Quantum's data lacks, from UEX's station list.
        self._uex = uex.Uex(HERE / "uex_cache", self._settings.get("uex_token", ""))
        self._uex_amen = {}
        self._wikiapi = fleet.Wiki(HERE / "uex_cache")
        self._ccu = ccu.Ccu(HERE / "uex_cache")      # ship upgrade (CCU) prices, from RSI's upgrade tool via the wiki
        self._part_images = {}               # wiki page title (lowercase) -> the wiki API's picture of that part
        self._missions = missions_wiki.MissionWiki(HERE / "uex_cache")   # contract details (wiki API)
        # Component numbers from the game files which are preferred over the wiki.
        self._game = fleet.GameData(HERE / "component_stats.json", RES / "component_stats.json")
        self._gear = gear.Gear(HERE / "uex_cache")          # personal weapons, armor and blueprints (wiki)
        self._renamed.update(getattr(self._db, "merged", {}))   # places listed twice, merged (Port Tressler)
        self._renamed.update(self._apply_uex_stations(offline=True))
        ren = self._renamed
        for st in self._settings.get("route_tasks") or []:
            st["place"] = ren.get(st.get("place"), st.get("place"))
        self._settings["route"] = [ren.get(n, n) for n in self._settings.get("route", [])]
        if self._settings.get("guide") in ren:
            self._settings["guide"] = ren[self._settings["guide"]]
        saved = self._settings.get("route_tasks") or [{"place": n, "task": "visit"} for n in self._settings.get("route", [])]
        self._route = [t for t in saved if t.get("place") in self._db.locations]
        self._guide = self._settings.get("guide") if self._settings.get("guide") in self._db.locations else None
        self._player = self._player_t = self._player_sys = None
        # Map data (cities, citylights, planets, terrain) comes from the Quantum server, cached here
        self._assets = assets.AssetCache(HERE / "asset_cache", log=lambda m: watcher_mod.log_error(m))
        self._last_cal_key = None
        self._arrive_seen = None
        self._arrived_note = None
        self._last_check_t = None
        self._calibration = self._settings.get("last_calibration")
        self._static_version = 1
        self._wiki = wiki.load(WIKI_PATH)
        self._service_records = services.load(SERVICES_PATH)
        self._services = self._match_services()
        self._log_cleared = None
        if self._settings.get("clear_log_on_start", True):      # on unless the user turned it off
            self._log_cleared = clear_game_log(self._settings.get("log_path"))
        self._tracker = ContractTracker(MISSIONS_PATH, self._db, self._settings.get("log_path"))
        self._tracker.player_ref = lambda: (self._player, self._player_sys, self._player_t)
        self._tracker.start()
        self._watcher = ClipboardWatcher(self._on_position)
        self._watcher.start()
        # Types /showlocation for you: F9 by default, optional timer (off by default). Windows only.
        self._sender = ShowLocationSender()
        self._sender.on_overlay = lambda: overlay.toggle(restore_cb=self._restore_window, show_cb=self._show_window,
                                                         after_show_cb=self._nudge_redraw)
        a = {"hotkey": "F9", "loc_hotkey": "", "interval": 0, "open_chat": "enter", "on_arrival": False,
             **self._settings.get("autoloc", {})}
        if a.get("action") == "showlocation" and not a.get("loc_hotkey"):
            a["loc_hotkey"], a["hotkey"] = a["hotkey"], "F9" if a["hotkey"] != "F9" else ""
        self._sender.configure(a["hotkey"], 0, a["open_chat"], None, True, a.get("loc_hotkey", ""), False,
                               chat_key=a.get("chat_key", "F12"))
        self._dr = datarunner.Submitter(HERE / "datarunner_test")
        self._dr_shots, self._dr_seq = [], 0
        self._dr_job = {"state": "idle", "n": 0}
        self._dr_terminal = None
        self._community = community.Community(lambda: self._settings.get("community_url"),
                                              lambda: not self._dr.live, self._session_token, self._session_lost)
        if self._dr_cfg().get("secret") and not self._session_token():
            self._sign_in_soon()                              # signs in on first start after updating, too
        self._acct_flow = {"state": "idle"}
        if self._account_token():
            threading.Thread(target=self._load_account_keys if self._keys_in_account() and not self._uex.token
                             else self._account_refresh, daemon=True).start()
        threading.Thread(target=self._account_loop, daemon=True).start()
        threading.Thread(target=self._sync_places, daemon=True).start()
        threading.Thread(target=self._watch_server, daemon=True).start()
        self._notify = None                               # a Windows notification (the tray icon's), set by main()
        self._watch_kick()                                # price alerts (api_watch.py)
        self._fm_start()                                  # the Friend Map (api_friendmap.py)
        threading.Thread(target=self._backup_loop, daemon=True).start()
        threading.Thread(target=self._sync_photos, daemon=True).start()
        threading.Thread(target=self._prefetch_assets, daemon=True).start()
        threading.Thread(target=self._refresh_services, daemon=True).start()
        self._updater = updater.Updater()
        self._updater.cleanup()
        self._update = None
        threading.Thread(target=self._check_update, daemon=True).start()
        # City clock: the local time drawn over the game when you arrive in a city (Settings > In-game overlay)
        self._clock = city_clock.CityClock(RES / "ui" / "fonts")
        self._clock_city, self._clock_since, self._clock_seat = None, 0.0, None
        threading.Thread(target=self._city_clock_loop, daemon=True).start()
        # Pickups and drop-offs the log only puts "inside a station": the wiki's list of places for that contract
        self._obj_suggest, self._wiki_tried = {}, {}
        threading.Thread(target=self._wiki_place_loop, daemon=True).start()
        # Friends and messages (Social): a background check-in with the server, faster while Social is open
        self._soc = {"state": None, "top": None, "focus_until": 0.0, "notes": [], "playing": None, "err": None, "wake": threading.Event(),
                     "lock": threading.Lock()}
        threading.Thread(target=self._social_loop, daemon=True).start()
        self._dr_session = {"reports": 0, "prices": 0, "terminals": [], "days": 0.0, "started": time.time()}
        self._sender.on_shot = lambda: self._dr_start_job(from_button=False)
        self._sender.configure(shot_hotkey=(self._settings.get("datarunner") or {}).get("shot_hotkey", ""))
        af = self._settings.get("antiafk") or {}            # its keys and choices (it always starts off)
        self._sender.configure_afk(af.get("hotkey", ""), False, af.get("action", "nudge"), af.get("focus", False))


def _check_mixins(cls):
    seen = {}
    for base in cls.__mro__[1:-1]:
        for name in vars(base):
            if not name.startswith("__"):
                if name in seen:
                    raise TypeError(f"Api.{name} is defined in both {seen[name]} and {base.__name__}")
                seen[name] = base.__name__
    for name in vars(cls):
        if name in seen and not name.startswith("__"):
            raise TypeError(f"Api.{name} is defined in both Api and {seen[name]}")


_check_mixins(Api)


def main():
    sys.argv = _demo_args(sys.argv)
    if DEMO["auto"]:
        print(f"Demo tour: starts {2.5 + DEMO['delay']:g} s after Quantum loads, at speed {DEMO['speed']:g}. "
              "Space pauses, Esc stops.")
    if "--import" in sys.argv:          
        if FROZEN and os.name == "nt":  
            import ctypes
            ctypes.windll.kernel32.AllocConsole()
            sys.stdout = sys.stderr = open("CONOUT$", "w", buffering=1)
        import import_data
        sys.argv = [a for a in sys.argv if a != "--import"]
        import_data.main()
        if FROZEN:
            input("\nPress Enter to close.")
        return
    single = tray.SingleInstance()
    if not single.first:                 # Quantum's already running: bring it forward instead
        single.notify()
        print("Quantum is already running: it's been brought to the front.")
        return
    overlay.set_app_id()                 # own taskbar icon instead of Python's
    api = Api()
    if not api._db.bodies:
        print("Tip: run `python import_data.py` (or Quantum.exe --import) once to load Stanton, Pyro and Nyx.")
    print("Quantum by microTech - the verse, in your reach.")
    window = webview.create_window("Quantum", str(RES / "ui" / "index.html"), js_api=api,
                                   width=1600, height=960, min_size=(1150, 720),
                                   background_color="#05080f")
    window.events.closed += api.shutdown
    icon = RES / "assets" / "quantum.ico"
    tray_icon = tray.Tray(window, icon, on_show=lambda: (api._nudge_redraw(), overlay.bring_to_front()))
    api._notify = tray_icon.notify                           # price alerts pop up as Windows notifications
    window.events.closed += tray_icon.stop
    single.on_show_request(tray_icon.show)                  # another launch: come to the front

    def started():
        overlay.set_window_icon(icon)
        tray_icon.start()
    # Keep the page's browser cache between launches (pywebview's default private mode throws it away), so
    # pictures and logos downloaded once show at once next time instead of loading again every start.
    cache_dir = HERE / "webview_cache"
    try:
        cache_dir.mkdir(exist_ok=True)
        clear_stale_ui_cache(cache_dir)
        webview.start(func=started, private_mode=False, storage_path=str(cache_dir))
    except TypeError:                                      # an older pywebview without these options
        webview.start(func=started)


if __name__ == "__main__":
    main()
