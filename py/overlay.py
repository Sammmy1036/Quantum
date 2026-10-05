"""F9 overlay: bring Quantum over the game, or tuck it away and hand focus back to Star Citizen.

Windows only, pure ctypes. The game must run in Borderless or Windowed mode; nothing can draw over a
true exclusive-fullscreen game. A process that receives a registered hotkey is allowed to take the
foreground, which is why this works from inside the game.
"""
import os

AVAILABLE = os.name == "nt"
WINDOW_TITLE = "Quantum"

if AVAILABLE:
    import ctypes
    from ctypes import wintypes

    user32 = ctypes.WinDLL("user32", use_last_error=True)
    HWND_TOPMOST, HWND_NOTOPMOST = wintypes.HWND(-1), wintypes.HWND(-2)
    SWP_NOSIZE, SWP_NOMOVE, SWP_SHOWWINDOW = 0x0001, 0x0002, 0x0040
    SW_SHOW, SW_MINIMIZE, SW_RESTORE = 5, 6, 9

    user32.FindWindowW.argtypes = (wintypes.LPCWSTR, wintypes.LPCWSTR)
    user32.FindWindowW.restype = wintypes.HWND
    user32.GetForegroundWindow.restype = wintypes.HWND
    user32.SetWindowPos.argtypes = (wintypes.HWND, wintypes.HWND, ctypes.c_int, ctypes.c_int,
                                    ctypes.c_int, ctypes.c_int, wintypes.UINT)
    user32.ShowWindow.argtypes = (wintypes.HWND, ctypes.c_int)
    user32.SetForegroundWindow.argtypes = (wintypes.HWND,)
    user32.BringWindowToTop.argtypes = (wintypes.HWND,)
    user32.SetActiveWindow.argtypes = (wintypes.HWND,)
    user32.IsIconic.argtypes = (wintypes.HWND,)
    user32.IsWindowVisible.argtypes = (wintypes.HWND,)
    user32.GetWindowTextW.argtypes = (wintypes.HWND, wintypes.LPWSTR, ctypes.c_int)
    EnumProc = ctypes.WINFUNCTYPE(wintypes.BOOL, wintypes.HWND, wintypes.LPARAM)

    def _title(hwnd):
        buf = ctypes.create_unicode_buffer(256)
        user32.GetWindowTextW(hwnd, buf, 256)
        return buf.value

    def _find_game():
        found = []

        def cb(hwnd, _):
            if user32.IsWindowVisible(hwnd) and "star citizen" in _title(hwnd).lower():
                found.append(hwnd)
                return False
            return True

        user32.EnumWindows(EnumProc(cb), 0)
        return found[0] if found else None

    kernel32 = ctypes.WinDLL("kernel32", use_last_error=True)
    user32.GetWindowThreadProcessId.argtypes = (wintypes.HWND, ctypes.POINTER(wintypes.DWORD))
    user32.GetWindowThreadProcessId.restype = wintypes.DWORD
    user32.AttachThreadInput.argtypes = (wintypes.DWORD, wintypes.DWORD, wintypes.BOOL)
    user32.GetWindowLongW.argtypes = (wintypes.HWND, ctypes.c_int)
    GWL_EXSTYLE, WS_EX_TOPMOST, VK_MENU, KEYEVENTF_KEYUP = -20, 0x0008, 0x12, 0x0002

    def _is_overlay_up(hwnd):
        """Up = showing and pinned on top (we only pin it when showing it as the overlay)."""
        return (not user32.IsIconic(hwnd) and user32.IsWindowVisible(hwnd)
                and bool(user32.GetWindowLongW(hwnd, GWL_EXSTYLE) & WS_EX_TOPMOST))

    def _force_foreground(hwnd):
        """Windows won't let a background program take focus from the active one. Joining the active
        window's input queue for a moment lifts that; a quick Alt tap is the last resort."""
        fg = user32.GetForegroundWindow()
        me = kernel32.GetCurrentThreadId()
        other = user32.GetWindowThreadProcessId(fg, None) if fg else 0
        attached = bool(other and other != me and user32.AttachThreadInput(me, other, True))
        try:
            user32.BringWindowToTop(hwnd)
            user32.SetForegroundWindow(hwnd)
            user32.SetActiveWindow(hwnd)
        finally:
            if attached:
                user32.AttachThreadInput(me, other, False)
        if user32.GetForegroundWindow() != hwnd:
            user32.keybd_event(VK_MENU, 0, 0, 0)
            user32.keybd_event(VK_MENU, 0, KEYEVENTF_KEYUP, 0)
            user32.SetForegroundWindow(hwnd)
        return user32.GetForegroundWindow() == hwnd

    def toggle(title=WINDOW_TITLE, restore_cb=None, after_show_cb=None):
        """Show Quantum pinned on top of the game, or send it back behind the game.

        It is never minimised here: Quantum's page is drawn by an embedded browser (WebView2), and a
        window restored from minimised behind the app's back stays black. Hiding just un-pins it and
        gives the game focus, so the borderless game covers it and it comes back instantly.
        restore_cb restores a minimised window through the app itself; after_show_cb nudges a redraw."""
        hwnd = user32.FindWindowW(None, title)
        if not hwnd:
            return "window not found"
        if _is_overlay_up(hwnd):
            user32.SetWindowPos(hwnd, HWND_NOTOPMOST, 0, 0, 0, 0, SWP_NOMOVE | SWP_NOSIZE)
            game = _find_game()
            if game:
                _force_foreground(game)
            return "hidden"
        if user32.IsIconic(hwnd):
            if restore_cb:
                restore_cb()                      # the app's own restore keeps WebView2 drawing
            else:
                user32.ShowWindow(hwnd, SW_RESTORE)
        elif not user32.IsWindowVisible(hwnd):
            user32.ShowWindow(hwnd, SW_SHOW)
        user32.SetWindowPos(hwnd, HWND_TOPMOST, 0, 0, 0, 0, SWP_NOMOVE | SWP_NOSIZE | SWP_SHOWWINDOW)
        focused = _force_foreground(hwnd)
        if after_show_cb:
            try:
                after_show_cb()
            except Exception:
                pass
        if focused:
            return "shown"
        return ("shown on top, but Windows kept the game focused: click Quantum to use it. If it doesn't "
                "appear at all, set the game to Borderless, or restart Quantum as administrator")
    def focus_game(title=WINDOW_TITLE):
        """Un-pin Quantum and give Star Citizen the focus, so keystrokes reach the game.
        Returns True if the game ended up focused."""
        me = user32.FindWindowW(None, title)
        if me and _is_overlay_up(me):
            user32.SetWindowPos(me, HWND_NOTOPMOST, 0, 0, 0, 0, SWP_NOMOVE | SWP_NOSIZE)
        game = _find_game()
        return bool(game) and _force_foreground(game)

    def set_app_id(app_id="microTech.Quantum"):
        """Group Quantum under its own taskbar icon (not Python's). Call before the window opens."""
        try:
            ctypes.windll.shell32.SetCurrentProcessExplicitAppUserModelID(app_id)
        except Exception:
            pass

    def set_window_icon(ico_path, title=WINDOW_TITLE, wait=15.0):
        """Give the Quantum window the Quantum icon (title bar, taskbar, Alt-Tab)."""
        import time
        user32.LoadImageW.argtypes = (wintypes.HINSTANCE, wintypes.LPCWSTR, wintypes.UINT, ctypes.c_int,
                                      ctypes.c_int, wintypes.UINT)
        user32.LoadImageW.restype = wintypes.HANDLE
        user32.SendMessageW.argtypes = (wintypes.HWND, wintypes.UINT, wintypes.WPARAM, wintypes.LPARAM)
        deadline = time.time() + wait
        hwnd = None
        while time.time() < deadline and not hwnd:
            hwnd = user32.FindWindowW(None, title)
            if not hwnd:
                time.sleep(0.2)
        if not hwnd:
            return False
        LR_LOADFROMFILE, IMAGE_ICON, WM_SETICON = 0x10, 1, 0x80
        big = user32.LoadImageW(None, str(ico_path), IMAGE_ICON, 256, 256, LR_LOADFROMFILE)
        small = user32.LoadImageW(None, str(ico_path), IMAGE_ICON, 16, 16, LR_LOADFROMFILE)
        if big:
            user32.SendMessageW(hwnd, WM_SETICON, 1, big)
        if small:
            user32.SendMessageW(hwnd, WM_SETICON, 0, small)
        return bool(big or small)
else:
    def focus_game(title=WINDOW_TITLE):
        return False

    def set_app_id(app_id="microTech.Quantum"):
        pass

    def set_window_icon(ico_path, title=WINDOW_TITLE, wait=15.0):
        return False

    def toggle(title=WINDOW_TITLE, restore_cb=None, after_show_cb=None):
        return "Only works on Windows"
