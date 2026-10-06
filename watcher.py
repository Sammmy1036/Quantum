"""Polls the clipboard for /showlocation output. Read-only, never touches the game."""
import os
import sys
import threading
import time
import traceback
from pathlib import Path

import pyperclip

from nav_core import parse_showlocation

# Next to Quantum.exe (or app.py when run from source), so it's easy to find and send.
ERROR_LOG = (Path(sys.executable).parent if getattr(sys, "frozen", False) else Path(__file__).resolve().parent) \
    / "quantum_errors.log"


def _seq_reader():
    """Windows' clipboard sequence number: it changes on every copy, even when the text is the same
    (docked at a station, /showlocation twice gives identical coordinates). None elsewhere."""
    if os.name != "nt":
        return None
    try:
        import ctypes
        fn = ctypes.windll.user32.GetClipboardSequenceNumber
        fn.restype = ctypes.c_uint32
        return fn
    except Exception:
        return None


def log_error(where):
    try:
        with ERROR_LOG.open("a", encoding="utf-8") as f:
            f.write(f"--- {time.strftime('%Y-%m-%d %H:%M:%S')} {where}\n{traceback.format_exc()}\n")
    except OSError:
        pass


class ClipboardWatcher(threading.Thread):
    def __init__(self, on_position, interval=0.25):
        super().__init__(daemon=True)
        self.on_position = on_position
        self.interval = interval
        self._last = None
        self._seq = _seq_reader()
        self._last_seq = None
        self._stop = threading.Event()
        self.last_error = None

    def run(self):
        try:        # whatever's on the clipboard already is old (maybe last session's /showlocation)
            self._last = pyperclip.paste()
            self._last_seq = self._seq() if self._seq else None
        except Exception:
            pass
        while not self._stop.is_set():
            try:
                self._tick()
            except Exception:                   # never let one bad reading stop the watcher for good
                self.last_error = time.time()
                log_error("clipboard watcher")
            self._stop.wait(self.interval)

    def _tick(self):
        seq = self._seq() if self._seq else None
        if seq is not None and seq == self._last_seq:
            return                              # nothing copied since last time
        try:
            text = pyperclip.paste()
        except Exception:
            return                              # Windows clipboard can be briefly locked by other apps
        new_copy = seq is not None and seq != self._last_seq
        self._last_seq = seq
        if text and (text != self._last or new_copy):
            self._last = text
            pos = parse_showlocation(text)
            if pos:
                self.on_position(pos, time.time())

    def stop(self):
        self._stop.set()
