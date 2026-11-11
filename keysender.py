"""Types /showlocation into Star Citizen for you: on a global hotkey (default F9) and/or on a timer.

Windows only, pure ctypes (no extra packages). Keystrokes are only sent when Star Citizen is the
foreground window, and they're sent as keyboard scan codes because the game reads raw keyboard input.
The game then copies your coordinates to the clipboard, where watcher.py picks them up as usual.

Sequence: [open chat key] -> "/showlocation" -> Enter.
Note: the hotkey is read from the key's state, so the game also still sees that key press.

Hidden chat: the game's chat show/hide key (F12 by default) hides the chat window, and then Enter no
longer opens a chat box: "/showlocation" would land on your key bindings instead (s, h, o, w...). The
game doesn't log when chat is shown or hidden, so Quantum watches that key itself while the game is
focused and won't type while it thinks chat is hidden. If it gets out of step (you hid chat before
Quantum started, say), press the /showlocation key twice within a few seconds to send anyway; that
also tells Quantum chat is showing.
"""
import os
import random
import threading
import time

AVAILABLE = os.name == "nt"
COMMAND = "/showlocation"
FKEYS = {f"F{i}": 0x6F + i for i in range(1, 13)}          # F1 = 0x70 ... F12 = 0x7B
SC_ENTER, SC_LSHIFT = 0x1C, 0x2A

if AVAILABLE:
    import ctypes
    from ctypes import wintypes

    user32 = ctypes.WinDLL("user32", use_last_error=True)
    INPUT_KEYBOARD, KEYEVENTF_KEYUP, KEYEVENTF_SCANCODE = 1, 0x0002, 0x0008
    WM_HOTKEY, WM_QUIT, MOD_NOREPEAT = 0x0312, 0x0012, 0x4000

    class KEYBDINPUT(ctypes.Structure):
        _fields_ = [("wVk", wintypes.WORD), ("wScan", wintypes.WORD), ("dwFlags", wintypes.DWORD),
                    ("time", wintypes.DWORD), ("dwExtraInfo", ctypes.c_size_t)]

    class MOUSEINPUT(ctypes.Structure):
        _fields_ = [("dx", wintypes.LONG), ("dy", wintypes.LONG), ("mouseData", wintypes.DWORD),
                    ("dwFlags", wintypes.DWORD), ("time", wintypes.DWORD), ("dwExtraInfo", ctypes.c_size_t)]

    class HARDWAREINPUT(ctypes.Structure):
        _fields_ = [("uMsg", wintypes.DWORD), ("wParamL", wintypes.WORD), ("wParamH", wintypes.WORD)]

    class _INPUTUNION(ctypes.Union):
        _fields_ = [("ki", KEYBDINPUT), ("mi", MOUSEINPUT), ("hi", HARDWAREINPUT)]

    class INPUT(ctypes.Structure):
        _fields_ = [("type", wintypes.DWORD), ("u", _INPUTUNION)]

    user32.SendInput.argtypes = (wintypes.UINT, ctypes.POINTER(INPUT), ctypes.c_int)
    user32.VkKeyScanW.argtypes = (wintypes.WCHAR,)
    user32.VkKeyScanW.restype = ctypes.c_short
    user32.MapVirtualKeyW.argtypes = (wintypes.UINT, wintypes.UINT)
    user32.GetForegroundWindow.restype = wintypes.HWND
    user32.GetWindowTextW.argtypes = (wintypes.HWND, wintypes.LPWSTR, ctypes.c_int)
    user32.GetAsyncKeyState.argtypes = (ctypes.c_int,)
    user32.GetAsyncKeyState.restype = ctypes.c_short
    user32.PostThreadMessageW.argtypes = (wintypes.DWORD, wintypes.UINT, wintypes.WPARAM, wintypes.LPARAM)
    user32.FindWindowW.argtypes = (wintypes.LPCWSTR, wintypes.LPCWSTR)
    user32.FindWindowW.restype = wintypes.HWND
    user32.SetForegroundWindow.argtypes = (wintypes.HWND,)
    user32.ShowWindow.argtypes = (wintypes.HWND, ctypes.c_int)

    _k32 = ctypes.WinDLL("kernel32", use_last_error=True)
    _k32.OpenProcess.restype = wintypes.HANDLE
    _k32.OpenProcess.argtypes = (wintypes.DWORD, wintypes.BOOL, wintypes.DWORD)
    _k32.QueryFullProcessImageNameW.argtypes = (wintypes.HANDLE, wintypes.DWORD, wintypes.LPWSTR,
                                                ctypes.POINTER(wintypes.DWORD))
    _k32.CloseHandle.argtypes = (wintypes.HANDLE,)
    user32.GetWindowThreadProcessId.argtypes = (wintypes.HWND, ctypes.POINTER(wintypes.DWORD))
    user32.IsWindowVisible.argtypes = (wintypes.HWND,)
    _WNDENUMPROC = ctypes.WINFUNCTYPE(wintypes.BOOL, wintypes.HWND, wintypes.LPARAM)
    user32.EnumWindows.argtypes = (_WNDENUMPROC, wintypes.LPARAM)

    def _window_exe(h):
        """The program file name (lower case) behind a window, or ""."""
        pid = wintypes.DWORD()
        user32.GetWindowThreadProcessId(h, ctypes.byref(pid))
        ph = _k32.OpenProcess(0x1000, False, pid.value)             # PROCESS_QUERY_LIMITED_INFORMATION
        if not ph:
            return ""
        try:
            buf, n = ctypes.create_unicode_buffer(1024), wintypes.DWORD(1024)
            return os.path.basename(buf.value).lower() if _k32.QueryFullProcessImageNameW(ph, 0, buf, ctypes.byref(n)) else ""
        finally:
            _k32.CloseHandle(ph)

    def _title(h):
        buf = ctypes.create_unicode_buffer(256)
        user32.GetWindowTextW(h, buf, 256)
        return buf.value

    def find_game_window():
        """The game's main window. Found by its program (StarCitizen.exe), not its exact title: the title
        isn't exactly "Star Citizen" on every build/PC, and an exact-title lookup (FindWindow) then found
        nothing, so anti-AFK sat waiting for a game window forever and never sent a thing."""
        found = []

        def each(h, _):
            if user32.IsWindowVisible(h):
                exe = _window_exe(h)
                if exe == "starcitizen.exe" or (not exe and "star citizen" in _title(h).lower()):
                    found.append(h)
                    return False
            return True
        try:
            user32.EnumWindows(_WNDENUMPROC(each), 0)
        except Exception:
            pass
        return found[0] if found else user32.FindWindowW(None, "Star Citizen")

    def game_window_open():
        """Is there a Star Citizen window at all (focused or not)?"""
        return bool(find_game_window())

    VK_F13, SC_F13, SC_F1, VK_MENU = 0x7C, 0x64, 0x3B, 0x12
    MOUSEEVENTF_MOVE, INPUT_MOUSE = 0x0001, 0

    def _vk_tap(vk, scan, hold=0.04):
        """A key the game hasn't bound (F13): sent with both its virtual key and scan code."""
        for up in (False, True):
            inp = INPUT(type=INPUT_KEYBOARD)
            inp.u.ki = KEYBDINPUT(vk, scan, KEYEVENTF_KEYUP if up else 0, 0, 0)
            user32.SendInput(1, ctypes.byref(inp), ctypes.sizeof(INPUT))
            time.sleep(hold)

    def _mouse_nudge():
        """Move the mouse one pixel and straight back: real input to the game, but nothing moves."""
        for dx in (1, -1):
            inp = INPUT(type=INPUT_MOUSE)
            inp.u.mi = MOUSEINPUT(dx, 0, 0, MOUSEEVENTF_MOVE, 0, 0)
            user32.SendInput(1, ctypes.byref(inp), ctypes.sizeof(INPUT))
            time.sleep(0.05)

    def focus_game():
        """Bring Star Citizen to the front (Windows only lets a program do this right after a key press,
        so Alt is tapped first, the usual way around that)."""
        h = find_game_window()
        if not h:
            return False
        _vk_tap(VK_MENU, 0x38, 0.02)
        user32.ShowWindow(h, 9)                    # SW_RESTORE
        user32.SetForegroundWindow(h)
        time.sleep(0.4)
        return game_in_focus()

    def _scan(code, up=False):
        inp = INPUT(type=INPUT_KEYBOARD)
        inp.u.ki = KEYBDINPUT(0, code, KEYEVENTF_SCANCODE | (KEYEVENTF_KEYUP if up else 0), 0, 0)
        user32.SendInput(1, ctypes.byref(inp), ctypes.sizeof(INPUT))

    def _tap(code, hold=0.03):
        _scan(code)
        time.sleep(hold)
        _scan(code, up=True)

    def _type(text, gap=0.025):
        for ch in text:
            vks = user32.VkKeyScanW(ch)
            if vks == -1:
                continue
            vk, shift = vks & 0xFF, (vks >> 8) & 1
            code = user32.MapVirtualKeyW(vk, 0)          # MAPVK_VK_TO_VSC: follows your keyboard layout
            if shift:
                _scan(SC_LSHIFT)
            _tap(code, 0.02)
            if shift:
                _scan(SC_LSHIFT, up=True)
            time.sleep(gap)

    def foreground_title():
        buf = ctypes.create_unicode_buffer(256)
        user32.GetWindowTextW(user32.GetForegroundWindow(), buf, 256)
        return buf.value

    def game_in_focus():
        h = user32.GetForegroundWindow()
        if not h:
            return False
        # By program first: a browser tab titled "Star Citizen ..." isn't the game, and keys typed
        # there (/showlocation) would go into the web page.
        exe = _window_exe(h)
        return exe == "starcitizen.exe" or (not exe and "star citizen" in _title(h).lower())

    kernel32 = ctypes.WinDLL("kernel32", use_last_error=True)
    advapi32 = ctypes.WinDLL("advapi32", use_last_error=True)

    def we_are_admin():
        try:
            return bool(ctypes.windll.shell32.IsUserAnAdmin())
        except Exception:
            return False

    def foreground_elevated():
        """True if the focused window's process runs as administrator (or we can't even look at it,
        which in practice means it's elevated and we aren't)."""
        pid = wintypes.DWORD()
        user32.GetWindowThreadProcessId(user32.GetForegroundWindow(), ctypes.byref(pid))
        h = kernel32.OpenProcess(0x1000, False, pid.value)          # PROCESS_QUERY_LIMITED_INFORMATION
        if not h:
            return True
        try:
            tok = wintypes.HANDLE()
            if not advapi32.OpenProcessToken(h, 0x0008, ctypes.byref(tok)):   # TOKEN_QUERY
                return True
            try:
                elev, size = wintypes.DWORD(), wintypes.DWORD()
                if not advapi32.GetTokenInformation(tok, 20, ctypes.byref(elev), 4, ctypes.byref(size)):
                    return False                                     # 20 = TokenElevation
                return bool(elev.value)
            finally:
                kernel32.CloseHandle(tok)
        finally:
            kernel32.CloseHandle(h)
else:
    def game_in_focus():
        return False

    def focus_game():
        return False

    def game_window_open():
        return False

    def foreground_title():
        return ""

    def we_are_admin():
        return False

    def foreground_elevated():
        return False


class ShowLocationSender:
    """Hotkey + timer. configure() can be called any time; changes apply immediately."""

    def __init__(self):
        self.hotkey = ""            # show/hide Quantum: "F9", or "" for off
        self.loc_hotkey = ""        # type /showlocation: "F10", or "" for off
        self.shot_hotkey = ""       # datarunner screenshot of the terminal: "F8", or "" for off
        self.on_shot = None         # set by the app: takes the screenshot, returns a short result
        self.interval = 0           # seconds, 0 = off
        self.open_chat = "enter"    # "enter" = press Enter to open chat first, "none" = chat already open
        self.action = "overlay"     # hotkey: "overlay" = show/hide Quantum over the game, "showlocation" = type it
        self.on_overlay = None      # set by the app: toggles the window, returns a short result
        self.qt_only = True         # the timer only runs during quantum travel
        self.on_arrival = False     # ...and optionally sends once when a jump ends
        self.qt_policy = None       # set by the app: -> {"send", "interval", "reason", "arrived"}
        self.chat_key = "F12"       # the game's chat show/hide key, watched so we don't type into hidden chat ("" = off)
        self.chat_hidden = False    # what that key's presses (in game) say about the chat window
        self._refused_at = 0.0      # last send refused because chat looked hidden: a quick second press sends anyway
        self._arrival_sent = None
        self.last_sent = None
        self.last_result = "idle"
        self.events = []            # recent attempts, newest last, shown in Settings for troubleshooting
        # Anti-AFK: while on, a harmless input every 1 to 4 minutes (random), so the game doesn't log you out
        self.afk_hotkey = ""        # toggles it ("" = only from Settings)
        self.afk_on = False
        self.afk_action = "nudge"   # "nudge" = mouse 1 px and back, "f13" = an unbound key, "mobiglas" = F1 twice
        self.afk_focus = False      # bring the game to the front first (otherwise it waits until the game is focused)
        self.afk_min, self.afk_max = 60, 240
        self.afk_next = None
        self.afk_last = None
        self._afk_wake = threading.Event()
        self._lock = threading.Lock()
        self._hk_thread = None
        self._hk_stop = threading.Event()
        self._stop = threading.Event()
        self._timer = threading.Thread(target=self._timer_loop, daemon=True)
        self._timer.start()
        threading.Thread(target=self._afk_loop, daemon=True).start()

    # ------------------------------------------------------------ settings
    def configure_afk(self, hotkey=None, on=None, action=None, focus=None):
        """Anti-AFK settings; the toggle key mustn't clash with the other hotkeys."""
        if action in ("nudge", "f13", "mobiglas"):
            self.afk_action = action
        if focus is not None:
            self.afk_focus = bool(focus)
        if on is not None and bool(on) != self.afk_on:
            self.set_afk(bool(on))                     # logged (Settings > Log) whichever way it was switched
        if hotkey is not None:
            hk = hotkey if hotkey in FKEYS and hotkey not in (self.hotkey, self.loc_hotkey, self.shot_hotkey, self.chat_key) else ""
            if hk != self.afk_hotkey:
                self.afk_hotkey = hk
                self._restart_hotkeys()
        return self.status()

    def set_afk(self, on, quiet=False):
        self.afk_on = bool(on)
        self.afk_next = time.time() + random.uniform(self.afk_min, self.afk_max) if on else None
        self._afk_wake.set()
        if not quiet:
            self._event(f"Anti-AFK {'on: a harmless input every 1 to 4 minutes' if on else 'off'}")
        return self.afk_on

    def _afk_loop(self):
        while not self._stop.is_set():
            self._afk_wake.wait(1)
            self._afk_wake.clear()
            if not self.afk_on or not self.afk_next or time.time() < self.afk_next or not AVAILABLE:
                continue
            if not game_window_open():
                self.afk_next = time.time() + 30
                continue
            if not game_in_focus() and not (self.afk_focus and focus_game()):
                self.last_result = "Anti-AFK: waiting for Star Citizen to be the focused window"
                self.afk_next = time.time() + 15           # tries again soon; keeps well inside the game's timer
                continue
            if foreground_elevated() and not we_are_admin():
                self._event("Anti-AFK: blocked. Star Citizen runs as administrator; restart Quantum as administrator")
                self.afk_next = time.time() + 60
                continue
            if not self.afk_on:
                continue                                   # switched off while it waited or brought the game forward
            try:
                with self._lock:
                    if self.afk_action == "f13":
                        _vk_tap(VK_F13, SC_F13)
                    elif self.afk_action == "mobiglas":
                        # The game polls input once a frame and ignores F1 while the mobiGlas is still
                        # opening: a 50 ms press 0.6 s apart could be missed or leave it open. Hold each
                        # press for a few frames and let it finish opening first.
                        _tap(SC_F1, 0.12)
                        time.sleep(2.5)
                        _tap(SC_F1, 0.12)
                    else:
                        _mouse_nudge()
                self.afk_last = time.time()
                self._event(f"Anti-AFK: {'pressed F13' if self.afk_action == 'f13' else 'opened and closed mobiGlas' if self.afk_action == 'mobiglas' else 'nudged the mouse'}")
            except Exception as e:
                self._event(f"Anti-AFK: couldn't send ({e})")
            self.afk_next = time.time() + random.uniform(self.afk_min, self.afk_max) if self.afk_on else None

    def _restart_hotkeys(self):
        self._stop_hotkey()
        if AVAILABLE and (self.hotkey or self.loc_hotkey or self.shot_hotkey or self.afk_hotkey or (self.chat_key and self.loc_hotkey)):
            self._hk_stop = threading.Event()
            self._hk_thread = threading.Thread(target=self._hotkey_loop, daemon=True)
            self._hk_thread.start()

    def configure(self, hotkey=None, interval=None, open_chat=None, action=None, qt_only=None,
                  loc_hotkey=None, on_arrival=None, shot_hotkey=None, chat_key=None):
        """hotkey = show/hide Quantum, loc_hotkey = type /showlocation ("F1".."F12" or "" for off).
        interval = seconds between automatic /showlocations during quantum travel (0 = off)."""
        if qt_only is not None:
            self.qt_only = True               # "always" mode was dropped: quantum travel only
        if on_arrival is not None:
            self.on_arrival = bool(on_arrival)
        if action == "showlocation" and hotkey and loc_hotkey is None:
            loc_hotkey, hotkey = hotkey, ""   # old single-hotkey setting that typed /showlocation
        if interval is not None:
            self.interval = max(0, int(interval))
            if self.interval and self.interval < 5:
                self.interval = 5                   # typing takes about a second; don't flood the chat
        if open_chat in ("enter", "none"):
            self.open_chat = open_chat
        new_hk = hotkey if hotkey is not None else self.hotkey
        new_loc = loc_hotkey if loc_hotkey is not None else self.loc_hotkey
        new_hk = new_hk if new_hk in FKEYS else ""
        new_loc = new_loc if new_loc in FKEYS and new_loc != new_hk else ""
        new_shot = shot_hotkey if shot_hotkey is not None else self.shot_hotkey
        new_shot = new_shot if new_shot in FKEYS and new_shot not in (new_hk, new_loc) else ""
        new_chat = chat_key if chat_key is not None else self.chat_key
        new_chat = new_chat if new_chat in FKEYS and new_chat not in (new_hk, new_loc, new_shot) else ""
        if self.afk_hotkey in (new_hk, new_loc, new_shot, new_chat):
            self.afk_hotkey = ""                     # a key just given to something else
        if new_chat != self.chat_key:
            self.chat_hidden = False
        keys = (new_hk, new_loc, new_shot)
        watch_chat = bool(new_chat and new_loc)      # only matters when Quantum types /showlocation
        if keys != (self.hotkey, self.loc_hotkey, self.shot_hotkey) or new_chat != self.chat_key or \
                (AVAILABLE and not self._hk_thread and any(keys)):
            self._stop_hotkey()
            self.hotkey, self.loc_hotkey, self.shot_hotkey = keys
            self.chat_key = new_chat
            if (any(keys) or watch_chat or self.afk_hotkey) and AVAILABLE:
                self._hk_stop = threading.Event()
                self._hk_thread = threading.Thread(target=self._hotkey_loop, daemon=True)
                self._hk_thread.start()

    def _event(self, text):
        self.last_result = text
        self.events = (self.events + [{"t": time.time(), "text": text}])[-8:]
        return text

    def status(self):
        return {"available": AVAILABLE, "hotkey": self.hotkey, "loc_hotkey": self.loc_hotkey,
                "shot_hotkey": self.shot_hotkey, "chat_key": self.chat_key, "chat_hidden": self.chat_hidden,
                "interval": self.interval, "qt_only": True, "on_arrival": self.on_arrival,
                "open_chat": self.open_chat, "last_sent": self.last_sent, "last_result": self.last_result,
                "events": self.events, "admin": we_are_admin() if AVAILABLE else False,
                "afk": {"hotkey": self.afk_hotkey, "on": self.afk_on, "action": self.afk_action, "focus": self.afk_focus,
                        "next": self.afk_next, "last": self.afk_last}}

    def shutdown(self):
        self._stop.set()
        self._stop_hotkey()

    # ------------------------------------------------------------ sending
    def send(self, reason="hotkey"):
        """Type the command, if the game is the focused window. Returns a short result string."""
        if not AVAILABLE:
            return self._event("Only works on Windows")
        title = foreground_title()
        if "star citizen" not in title.lower():
            return self._event(f"{reason}: skipped, the focused window was “{title or 'nothing'}”, not Star Citizen")
        if foreground_elevated() and not we_are_admin():
            # Windows (UIPI) silently drops keystrokes sent to a program with higher rights.
            return self._event(f"{reason}: blocked. Star Citizen is running as administrator, so Windows "
                               "discards Quantum's keystrokes. Restart Quantum as administrator")
        if self.chat_key and self.chat_hidden:
            now = time.time()
            if reason == self.loc_hotkey and now - self._refused_at < 4:
                self.chat_hidden = False              # pressed twice: you know chat is showing
            else:
                if reason == self.loc_hotkey:
                    self._refused_at = now
                tip = (f" If chat is showing, press {reason} twice to send anyway" if reason == self.loc_hotkey else "")
                return self._event(f"{reason}: skipped, chat looks hidden (you pressed {self.chat_key}). Press "
                                   f"{self.chat_key} to show chat, then try again.{tip}")
        if not self._lock.acquire(blocking=False):
            return "busy"
        try:
            if self.open_chat == "enter":
                _tap(SC_ENTER)
                time.sleep(0.18)                      # give the chat box a moment to take focus
            _type(COMMAND)
            time.sleep(0.05)
            _tap(SC_ENTER)
            self.last_sent = time.time()
            return self._event(f"{reason}: typed /showlocation into Star Citizen")
        finally:
            self._lock.release()

    def send_after(self, delay):
        """For testing: gives you time to click back into the game."""
        threading.Thread(target=lambda: (time.sleep(delay), self.send("test")), daemon=True).start()

    # ------------------------------------------------------------ hotkey thread
    def _hotkey_loop(self):
        """Watch both keys' physical state. Star Citizen reads the keyboard through raw input with system
        hotkeys switched off while it has focus, so RegisterHotKey never fires in game; polling the key
        state (as game overlays do) works whether or not the game is focused."""
        keys = {k: act for k, act in ((self.hotkey, "overlay"), (self.loc_hotkey, "showlocation"),
                                      (self.shot_hotkey, "screenshot")) if k}
        if self.chat_key and self.loc_hotkey:
            keys[self.chat_key] = "chat"
        if self.afk_hotkey and self.afk_hotkey not in keys:
            keys[self.afk_hotkey] = "afk"
        stop = self._hk_stop
        label = {"overlay": "show/hide Quantum", "showlocation": "/showlocation", "screenshot": "terminal screenshot",
                 "chat": "game chat show/hide (watched)", "afk": "anti-AFK on/off"}
        self._event(" · ".join(f"{k}: {label[a]}" for k, a in keys.items()) + " ready (works in game)")
        state = {k: [False, 0.0] for k in keys}
        game_check = 0.0
        while not stop.wait(0.015):
            if "chat" in keys.values() and time.time() - game_check > 2:
                game_check = time.time()
                if self.chat_hidden and not game_window_open():
                    self.chat_hidden = False          # the game closed: chat shows again next launch
            for key, act in keys.items():
                down = bool(user32.GetAsyncKeyState(FKEYS[key]) & 0x8000)
                was, last = state[key]
                if down and not was and time.time() - last > 0.3:      # one press = one action
                    state[key][1] = time.time()
                    if act == "chat":
                        if game_in_focus():           # only presses the game saw toggle its chat
                            self.chat_hidden = not self.chat_hidden
                            self._event(f"{key}: chat {'hidden' if self.chat_hidden else 'showing'} in game")
                    elif act == "overlay" and self.on_overlay:
                        try:
                            self._event(f"{key}: Quantum {self.on_overlay()}")
                        except Exception as e:
                            self._event(f"{key}: couldn't toggle the overlay ({e})")
                    elif act == "screenshot" and self.on_shot:
                        def shoot(key=key):
                            try:
                                self._event(f"{key}: {self.on_shot()}")
                            except Exception as e:
                                self._event(f"{key}: screenshot failed ({e})")
                        threading.Thread(target=shoot, daemon=True).start()
                    elif act == "afk":
                        self.set_afk(not self.afk_on)
                    elif act == "showlocation":
                        self._event(f"{key} pressed")
                        threading.Thread(target=self.send, args=(key,), daemon=True).start()
                state[key][0] = down

    def _stop_hotkey(self):
        if self._hk_thread:
            self._hk_stop.set()
            self._hk_thread.join(timeout=1)
        self._hk_thread = None

    # ------------------------------------------------------------ timer thread
    def _timer_loop(self):
        """Automatic /showlocation, only during quantum travel. The app decides what counts (see
        Api._qt_policy): never while landed, taking off or near a surface; a slow check while a jump is
        plotted; the chosen interval once readings show quantum speed."""
        while not self._stop.wait(1):
            if not self.interval or not self.qt_policy:
                continue
            pol = self.qt_policy(self.interval) or {}
            if self.on_arrival and pol.get("arrived") and pol["arrived"] != self._arrival_sent:
                if game_in_focus():
                    self._arrival_sent = pol["arrived"]
                    self.send("quantum arrival")
                continue
            if not pol.get("send"):
                self.last_result = f"timer: {pol.get('reason', 'waiting for quantum travel')}"
                continue
            every = pol.get("interval") or self.interval
            if self.last_sent is None or time.time() - self.last_sent >= every:
                if game_in_focus():
                    self.send(f"quantum travel ({pol.get('reason', '')})")
                else:
                    self.last_result = "timer: waiting for Star Citizen to be the focused window"
