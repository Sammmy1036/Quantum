"""Polls the clipboard for /showlocation output. Read-only, never touches the game."""
import threading
import time

import pyperclip

from nav_core import parse_showlocation


class ClipboardWatcher(threading.Thread):
    def __init__(self, on_position, interval=0.25):
        super().__init__(daemon=True)
        self.on_position = on_position
        self.interval = interval
        self._last = None
        self._stop = threading.Event()

    def run(self):
        try:        # whatever's on the clipboard already is old (maybe last session's /showlocation)
            self._last = pyperclip.paste()
        except Exception:
            pass
        while not self._stop.is_set():
            try:
                text = pyperclip.paste()
            except Exception:
                text = None  # Windows clipboard can be briefly locked by other apps
            if text and text != self._last:
                self._last = text
                pos = parse_showlocation(text)
                if pos:
                    self.on_position(pos, time.time())
            self._stop.wait(self.interval)

    def stop(self):
        self._stop.set()
