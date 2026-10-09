"""The tray icon (Show / Hide and Exit), and keeping Quantum to one running copy.

Tray: pystray, in its own thread. Show and hide go through pywebview's own window calls, so the
embedded browser (WebView2) is told when it's visible again and doesn't come back black. Without
pystray installed there's simply no tray icon.

One copy: two Quantums would both read Game.log and write the same settings, contracts and reports,
and fight over the F9/F10 hotkeys and the auto /showlocation. So a second launch hands over to the
running one (which comes to the front, out of the tray if it was hidden there) and closes. Windows
only; `--multi` skips the check (e.g. a second copy for testing).
"""
import os
import sys
import threading

NAME = "microTech.Quantum"


# ---------------------------------------------------------------- one running copy
class SingleInstance:
    """Windows named mutex. first: this is the only Quantum. Others call notify() and exit."""

    def __init__(self):
        self.first, self._mutex, self._event = True, None, None
        if os.name != "nt" or "--multi" in sys.argv:
            return
        import ctypes
        from ctypes import wintypes
        k32 = ctypes.WinDLL("kernel32", use_last_error=True)
        k32.CreateMutexW.restype = wintypes.HANDLE
        k32.CreateEventW.restype = wintypes.HANDLE
        k32.CreateMutexW.argtypes = (ctypes.c_void_p, wintypes.BOOL, wintypes.LPCWSTR)
        k32.CreateEventW.argtypes = (ctypes.c_void_p, wintypes.BOOL, wintypes.BOOL, wintypes.LPCWSTR)
        k32.SetEvent.argtypes = (wintypes.HANDLE,)
        k32.WaitForSingleObject.argtypes = (wintypes.HANDLE, wintypes.DWORD)
        self._k32 = k32
        self._mutex = k32.CreateMutexW(None, False, f"Local\\{NAME}")
        self.first = ctypes.get_last_error() != 183           # ERROR_ALREADY_EXISTS
        self._event = k32.CreateEventW(None, False, False, f"Local\\{NAME}.Show")   # auto-reset

    def notify(self):
        """From a second launch: ask the running Quantum to come to the front."""
        if self._event:
            self._k32.SetEvent(self._event)

    def on_show_request(self, callback):
        """In the running Quantum: call callback whenever another launch asks for it."""
        if not self._event:
            return

        def wait():
            while True:
                if self._k32.WaitForSingleObject(self._event, 0xFFFFFFFF) == 0:
                    try:
                        callback()
                    except Exception:
                        pass
        threading.Thread(target=wait, daemon=True, name="quantum-show-request").start()


# ---------------------------------------------------------------- tray icon
def _icon_image(ico_path):
    from PIL import Image, ImageDraw
    try:
        if ico_path and os.path.isfile(ico_path):
            return Image.open(ico_path)
    except Exception:
        pass
    img = Image.new("RGBA", (64, 64), (0, 0, 0, 0))          # no icon file: a simple Quantum-blue badge
    d = ImageDraw.Draw(img)
    d.ellipse((4, 4, 60, 60), outline=(79, 160, 255, 255), width=8)
    d.line((40, 42, 56, 58), fill=(79, 160, 255, 255), width=8)
    return img


class Tray:
    """Show / Hide (also a left click on the icon) and Exit."""

    def __init__(self, window, ico_path=None, on_show=None):
        self.window, self.on_show, self.visible, self.icon = window, on_show, True, None
        try:
            import pystray
        except Exception:
            return                                            # not installed: no tray icon
        self._pystray = pystray
        menu = pystray.Menu(
            pystray.MenuItem(lambda item: "Hide Quantum" if self.is_visible() else "Show Quantum", self.toggle, default=True),
            pystray.Menu.SEPARATOR,
            pystray.MenuItem("Exit Quantum", self.exit))
        self.icon = pystray.Icon("Quantum", _icon_image(ico_path), "Quantum", menu)

    def start(self):
        if self.icon:
            threading.Thread(target=self.icon.run, daemon=True, name="quantum-tray").start()

    def show(self):
        try:
            self.window.show()
            self.window.restore()
        except Exception:
            pass
        self.visible = True
        if self.on_show:
            self.on_show()
        self._refresh()

    def hide(self):
        try:
            self.window.hide()
        except Exception:
            pass
        self.visible = False
        self._refresh()

    def is_visible(self):
        """Whether the window is really showing (F9 can show it too), as far as Windows says."""
        try:
            import overlay
            v = overlay.is_shown()
        except Exception:
            v = None
        return self.visible if v is None else v

    def toggle(self, *_):
        self.hide() if self.is_visible() else self.show()

    def exit(self, *_):
        self.stop()
        try:
            self.window.destroy()                              # closes like the X: settings are saved on the way out
        except Exception:
            os._exit(0)

    def stop(self):
        if self.icon:
            try:
                self.icon.stop()
            except Exception:
                pass

    def _refresh(self):
        if self.icon:
            try:
                self.icon.update_menu()
            except Exception:
                pass
