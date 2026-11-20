"""Quantum's own title bar (Settings > Window): the Windows frame is left off and the page draws its own bar
with minimise / maximise / close. This file does the window side of it, on Windows only:

  - moving and resizing go through Windows itself (the same message the frame would send), so dragging
    the bar moves the window smoothly and its edges resize it, like any window
  - maximising fills the screen's work area, not the whole screen: a window without a frame would
    otherwise cover the taskbar
  - letting go of the bar at the top of the screen maximises it, at the left or right edge it takes that half
    (Windows' Snap, which it only does for windows with a frame)
  - the minimise / maximise styles stay set, so clicking Quantum on the taskbar still minimises it

Everything that touches the window runs on its own UI thread (the page's calls come in on other threads).
"""
import os

AVAILABLE = os.name == "nt"
HIT = {"caption": 2, "left": 10, "right": 11, "top": 12, "topleft": 13, "topright": 14,
       "bottom": 15, "bottomleft": 16, "bottomright": 17}

if AVAILABLE:
    import ctypes
    from ctypes import wintypes
    _u32 = ctypes.WinDLL("user32", use_last_error=True)
    _u32.SendMessageW.argtypes = (wintypes.HWND, wintypes.UINT, wintypes.WPARAM, wintypes.LPARAM)
    _u32.GetWindowLongW.argtypes = (wintypes.HWND, ctypes.c_int)
    _u32.SetWindowLongW.argtypes = (wintypes.HWND, ctypes.c_int, ctypes.c_long)
    _u32.IsZoomed.argtypes = (wintypes.HWND,)


def _window():
    import webview
    return webview.windows[0] if webview.windows else None


def _form():
    w = _window()
    return getattr(w, "native", None) if w else None


def _hwnd(form):
    return wintypes.HWND(int(form.Handle.ToInt64()))


def _on_ui(fn, wait=False):
    """Run fn on the window's UI thread (WinForms)."""
    form = _form()
    if form is None:
        return False
    from System import Action
    if not form.InvokeRequired:
        fn(form)
    elif wait:
        form.Invoke(Action(lambda: fn(form)))
    else:
        form.BeginInvoke(Action(lambda: fn(form)))
    return True


def _fit_maximised(form):
    """Maximised = the work area of the screen the window is on (WinForms reads it relative to that screen)."""
    from System.Windows.Forms import Screen
    from System.Drawing import Rectangle
    sc = Screen.FromControl(form)
    wa, b = sc.WorkingArea, sc.Bounds
    form.MaximizedBounds = Rectangle(wa.X - b.X, wa.Y - b.Y, wa.Width, wa.Height)


def setup():
    """Once, after the window opens: taskbar minimise and Win+arrow keep working, and maximise keeps to the
    work area wherever the window goes."""
    if not AVAILABLE:
        return False

    def go(form):
        h = _hwnd(form)
        style = _u32.GetWindowLongW(h, -16)                              # GWL_STYLE
        _u32.SetWindowLongW(h, -16, style | 0x00020000 | 0x00010000)     # WS_MINIMIZEBOX | WS_MAXIMIZEBOX
        _fit_maximised(form)
        from System import EventHandler
        form.Move += EventHandler(lambda s, e: _fit_maximised(form))
    try:
        return _on_ui(go)
    except Exception:
        return False


def drag(edge="caption"):
    """Start moving the window (edge "caption") or resizing it from an edge or corner, as the mouse is held
    down. Windows takes over from there until the button comes up."""
    if not AVAILABLE or edge not in HIT:
        return False

    def go(form):
        _u32.ReleaseCapture()                        # the page had the mouse: give it to Windows
        _u32.SendMessageW(_hwnd(form), 0x00A1, HIT[edge], 0)    # WM_NCLBUTTONDOWN: returns once the button is let go
        if edge == "caption":
            try:
                _snap(form)
            except Exception:
                pass
    try:
        return _on_ui(go)
    except Exception:
        return False


def _snap(form):
    """Windows' Snap, which a window without a frame doesn't get: let go of the bar with the mouse at the top of a
    screen and the window is maximised, at its left or right edge and it takes that half of the screen."""
    from System.Windows.Forms import Cursor, Screen, FormWindowState
    from System.Drawing import Rectangle
    pt = Cursor.Position
    sc = Screen.FromPoint(pt)
    b, wa = sc.Bounds, sc.WorkingArea
    if pt.Y <= b.Top + 1:
        _fit_maximised(form)
        form.WindowState = FormWindowState.Maximized
    elif pt.X <= b.Left + 1 or pt.X >= b.Right - 2:
        half = wa.Width // 2
        form.WindowState = FormWindowState.Normal
        form.Bounds = Rectangle(wa.X if pt.X <= b.Left + 1 else wa.X + wa.Width - half, wa.Y, half, wa.Height)


def is_maximised():
    form = _form()
    if not AVAILABLE or form is None:
        return False
    try:
        return bool(_u32.IsZoomed(_hwnd(form)))
    except Exception:
        return False


def toggle_maximise():
    if not AVAILABLE:
        return False
    result = {}

    def go(form):
        from System.Windows.Forms import FormWindowState
        if form.WindowState == FormWindowState.Maximized:
            form.WindowState = FormWindowState.Normal
        else:
            _fit_maximised(form)
            form.WindowState = FormWindowState.Maximized
        result["max"] = form.WindowState == FormWindowState.Maximized
    try:
        _on_ui(go, wait=True)
    except Exception:
        return is_maximised()
    return result.get("max", is_maximised())


def minimise():
    w = _window()
    if w:
        w.minimize()
    return True


def close():
    w = _window()
    if w:
        w.destroy()
    return True
