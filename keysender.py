"""Types /showlocation into Star Citizen for you: on a global hotkey (default F9) and/or on a timer.

Windows only, pure ctypes (no extra packages). Keystrokes are only sent when Star Citizen is the
foreground window, and they're sent as keyboard scan codes because the game reads raw keyboard input.
The game then copies your coordinates to the clipboard, where watcher.py picks them up as usual.

Sequence: [open chat key] -> "/showlocation" -> Enter.
Note: the hotkey is read from the key's state, so the game also still sees that key press.
"""
import os
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
        return "star citizen" in foreground_title().lower()

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
        self.interval = 0           # seconds, 0 = off
        self.open_chat = "enter"    # "enter" = press Enter to open chat first, "none" = chat already open
        self.action = "overlay"     # hotkey: "overlay" = show/hide Quantum over the game, "showlocation" = type it
        self.on_overlay = None      # set by the app: toggles the window, returns a short result
        self.qt_only = True         # the timer only runs during quantum travel
        self.on_arrival = False     # ...and optionally sends once when a jump ends
        self.qt_policy = None       # set by the app: -> {"send", "interval", "reason", "arrived"}
        self._arrival_sent = None
        self.last_sent = None
        self.last_result = "idle"
        self.events = []            # recent attempts, newest last, shown in Settings for troubleshooting
        self._lock = threading.Lock()
        self._hk_thread = None
        self._hk_stop = threading.Event()
        self._stop = threading.Event()
        self._timer = threading.Thread(target=self._timer_loop, daemon=True)
        self._timer.start()

    # ------------------------------------------------------------ settings
    def configure(self, hotkey=None, interval=None, open_chat=None, action=None, qt_only=None,
                  loc_hotkey=None, on_arrival=None):
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
        if (new_hk, new_loc) != (self.hotkey, self.loc_hotkey) or (AVAILABLE and not self._hk_thread and (new_hk or new_loc)):
            self._stop_hotkey()
            self.hotkey, self.loc_hotkey = new_hk, new_loc
            if (self.hotkey or self.loc_hotkey) and AVAILABLE:
                self._hk_stop = threading.Event()
                self._hk_thread = threading.Thread(target=self._hotkey_loop, daemon=True)
                self._hk_thread.start()

    def _event(self, text):
        self.last_result = text
        self.events = (self.events + [{"t": time.time(), "text": text}])[-8:]
        return text

    def status(self):
        return {"available": AVAILABLE, "hotkey": self.hotkey, "loc_hotkey": self.loc_hotkey,
                "interval": self.interval, "qt_only": True, "on_arrival": self.on_arrival,
                "open_chat": self.open_chat, "last_sent": self.last_sent, "last_result": self.last_result,
                "events": self.events, "admin": we_are_admin() if AVAILABLE else False}

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
        keys = {k: act for k, act in ((self.hotkey, "overlay"), (self.loc_hotkey, "showlocation")) if k}
        stop = self._hk_stop
        self._event(" · ".join(f"{k}: {'show/hide Quantum' if a == 'overlay' else '/showlocation'}"
                               for k, a in keys.items()) + " ready (works in game)")
        state = {k: [False, 0.0] for k in keys}
        while not stop.wait(0.015):
            for key, act in keys.items():
                down = bool(user32.GetAsyncKeyState(FKEYS[key]) & 0x8000)
                was, last = state[key]
                if down and not was and time.time() - last > 0.3:      # one press = one action
                    state[key][1] = time.time()
                    if act == "overlay" and self.on_overlay:
                        try:
                            self._event(f"{key}: Quantum {self.on_overlay()}")
                        except Exception as e:
                            self._event(f"{key}: couldn't toggle the overlay ({e})")
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
