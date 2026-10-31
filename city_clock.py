"""City clock: the local time of day drawn over the game when you're in Lorville, Area 18, New Babbage or Orison.

A borderless, click-through, always-on-top layered window (Windows only, pure ctypes) holding a picture
drawn with Pillow in Orbitron, so the text is smooth with a soft glow and never takes focus or clicks
from the game. It only shows while Star Citizen is the active window. Like the F9 overlay, nothing can
draw over a true exclusive-fullscreen game: Borderless or Windowed mode.

    clock = CityClock(font_dir)
    clock.show({"city": "New Babbage", "body": "microTech", "hours": 14.53})   # update as often as you like
    clock.hide()
"""
import os
import threading
import time

AVAILABLE = os.name == "nt"

MODES = ("off", "5", "10", "15", "city")     # seconds after arriving, or the whole time you're in the city
POSITIONS = ("top", "upper", "center", "bottom", "top-right", "bottom-right", "custom")
SIZES = {"large": 1.0, "medium": 0.75, "small": 0.5}      # how big, against the original size
FADE_S = 0.45


def part_of_day(h):
    return ("Night" if h < 5 else "Dawn" if h < 7 else "Morning" if h < 12 else "Afternoon" if h < 17
            else "Dusk" if h < 19.5 else "Evening" if h < 22 else "Night")


def clock_text(h, h24=True):
    hh, mm = int(h) % 24, int((h % 1) * 60)
    if h24:
        return f"{hh:02d}:{mm:02d}"
    return f"{(hh % 12) or 12}:{mm:02d} {'AM' if hh < 12 else 'PM'}"


def render(info, font_dir, scale=1.0, h24=True):
    """The overlay picture (premultiplied-alpha RGBA, Pillow Image) for {"city", "body", "hours"}."""
    from PIL import Image, ImageDraw, ImageFilter, ImageFont, ImageChops

    def font(weight, size):
        try:
            return ImageFont.truetype(str(os.path.join(font_dir, f"Orbitron-{weight}.ttf")), max(8, int(size * scale)))
        except OSError:
            return ImageFont.load_default()

    f_city, f_time, f_sub = font(700, 30), font(500, 58), font(500, 15)
    lines = [(info["city"].upper(), f_city, 0.32, (236, 246, 255)),
             (clock_text(info["hours"], h24), f_time, 0.06, (255, 255, 255)),
             (f"{(info.get('body') or '').upper()}  //  LOCAL TIME  //  {part_of_day(info['hours']).upper()}",
              f_sub, 0.30, (150, 215, 255))]

    def spaced_width(text, f, track):
        return sum(f.getlength(ch) for ch in text) + track * f.size * max(0, len(text) - 1)

    pad, gap = int(28 * scale), int(10 * scale)
    widths = [spaced_width(t, f, tr) for t, f, tr, _ in lines]
    heights = [f.getbbox("HG09")[3] for _, f, _, _ in lines]
    rule = int(70 * scale)                       # the thin lines either side of the city name
    w = int(max(widths[0] + 2 * (rule + gap * 2), *widths[1:]) + pad * 2)
    h = int(sum(heights) + gap * 5 + pad * 2)
    text = Image.new("RGBA", (w, h), (0, 0, 0, 0))
    d = ImageDraw.Draw(text)
    y = pad
    for (t, f, track, col), lw, lh in zip(lines, widths, heights):
        x = (w - lw) / 2
        for ch in t:
            d.text((x, y), ch, font=f, fill=col + (255,))
            x += f.getlength(ch) + track * f.size
        if f is f_city:                          # ── NEW BABBAGE ──
            cy = y + lh * 0.55
            lx0, lx1 = (w - lw) / 2 - gap * 2 - rule, (w - lw) / 2 - gap * 2
            rx0, rx1 = (w + lw) / 2 + gap * 2, (w + lw) / 2 + gap * 2 + rule
            d.line((lx0, cy, lx1, cy), fill=(120, 200, 255, 200), width=max(1, int(1.5 * scale)))
            d.line((rx0, cy, rx1, cy), fill=(120, 200, 255, 200), width=max(1, int(1.5 * scale)))
        y += lh + gap * (2 if f is f_city else 1.6 if f is f_time else 1)
    # Glow: the text blurred, tinted HUD blue, under a dark soft shadow that keeps it readable on snow.
    a = text.getchannel("A")
    glow = Image.new("RGBA", (w, h), (80, 180, 255, 0))
    glow.putalpha(a.filter(ImageFilter.GaussianBlur(9 * scale)).point(lambda v: int(v * 0.9)))
    shade = Image.new("RGBA", (w, h), (0, 8, 20, 0))
    shade.putalpha(a.filter(ImageFilter.GaussianBlur(4 * scale)).point(lambda v: int(v * 0.55)))
    out = Image.alpha_composite(Image.alpha_composite(shade, glow), text)
    r, g, b, al = out.split()                     # UpdateLayeredWindow wants premultiplied alpha
    return Image.merge("RGBA", (ImageChops.multiply(r, al), ImageChops.multiply(g, al),
                                ImageChops.multiply(b, al), al))


class CityClock:
    def __init__(self, font_dir):
        self.font_dir = str(font_dir)
        self.position, self.h24, self.size = "top", True, "large"
        self.xy = (0.5, 0.07)        # custom position: the clock's centre across, its top down, as fractions of the game window
        self._want = None            # info to show, or None
        self._lock = threading.Lock()
        self._thread = None

    def show(self, info, position=None, h24=None, size=None, xy=None):
        if not AVAILABLE:
            return
        with self._lock:
            self._want = dict(info)
            if position in POSITIONS:
                self.position = position
            if h24 is not None:
                self.h24 = bool(h24)
            if size in SIZES:
                self.size = size
            if xy:
                self.xy = (min(1.0, max(0.0, float(xy[0]))), min(1.0, max(0.0, float(xy[1]))))
        if self._thread is None:
            self._thread = threading.Thread(target=self._run, daemon=True, name="city-clock")
            self._thread.start()

    def hide(self):
        with self._lock:
            self._want = None

    # ------------------------------------------------------------ window thread (Windows only)
    def _run(self):
        try:
            self._loop()
        except Exception:
            try:
                import watcher
                watcher.log_error("city clock overlay")
            except Exception:
                pass
            self._thread = None

    def _loop(self):
        import ctypes
        from ctypes import wintypes
        import overlay

        u32, g32 = ctypes.WinDLL("user32", use_last_error=True), ctypes.WinDLL("gdi32", use_last_error=True)
        k32 = ctypes.WinDLL("kernel32")
        LRESULT = ctypes.c_ssize_t
        WNDPROC = ctypes.WINFUNCTYPE(LRESULT, wintypes.HWND, wintypes.UINT, wintypes.WPARAM, wintypes.LPARAM)
        u32.DefWindowProcW.argtypes = (wintypes.HWND, wintypes.UINT, wintypes.WPARAM, wintypes.LPARAM)
        u32.DefWindowProcW.restype = LRESULT

        class WNDCLASSW(ctypes.Structure):
            _fields_ = [("style", wintypes.UINT), ("lpfnWndProc", WNDPROC), ("cbClsExtra", ctypes.c_int),
                        ("cbWndExtra", ctypes.c_int), ("hInstance", wintypes.HINSTANCE), ("hIcon", wintypes.HICON),
                        ("hCursor", wintypes.HANDLE), ("hbrBackground", wintypes.HBRUSH),
                        ("lpszMenuName", wintypes.LPCWSTR), ("lpszClassName", wintypes.LPCWSTR)]

        class BLENDFUNCTION(ctypes.Structure):
            _fields_ = [("BlendOp", ctypes.c_ubyte), ("BlendFlags", ctypes.c_ubyte),
                        ("SourceConstantAlpha", ctypes.c_ubyte), ("AlphaFormat", ctypes.c_ubyte)]

        class BITMAPINFOHEADER(ctypes.Structure):
            _fields_ = [("biSize", wintypes.DWORD), ("biWidth", wintypes.LONG), ("biHeight", wintypes.LONG),
                        ("biPlanes", wintypes.WORD), ("biBitCount", wintypes.WORD), ("biCompression", wintypes.DWORD),
                        ("biSizeImage", wintypes.DWORD), ("biXPelsPerMeter", wintypes.LONG),
                        ("biYPelsPerMeter", wintypes.LONG), ("biClrUsed", wintypes.DWORD), ("biClrImportant", wintypes.DWORD)]

        u32.CreateWindowExW.argtypes = (wintypes.DWORD, wintypes.LPCWSTR, wintypes.LPCWSTR, wintypes.DWORD,
                                        ctypes.c_int, ctypes.c_int, ctypes.c_int, ctypes.c_int,
                                        wintypes.HWND, wintypes.HMENU, wintypes.HINSTANCE, wintypes.LPVOID)
        u32.CreateWindowExW.restype = wintypes.HWND
        u32.UpdateLayeredWindow.argtypes = (wintypes.HWND, wintypes.HDC, ctypes.POINTER(wintypes.POINT),
                                            ctypes.POINTER(wintypes.SIZE), wintypes.HDC, ctypes.POINTER(wintypes.POINT),
                                            wintypes.COLORREF, ctypes.POINTER(BLENDFUNCTION), wintypes.DWORD)
        u32.GetDC.restype = wintypes.HDC
        u32.GetDC.argtypes = (wintypes.HWND,)
        u32.ReleaseDC.argtypes = (wintypes.HWND, wintypes.HDC)
        u32.GetWindowRect.argtypes = (wintypes.HWND, ctypes.POINTER(wintypes.RECT))
        u32.GetForegroundWindow.restype = wintypes.HWND
        u32.ShowWindow.argtypes = (wintypes.HWND, ctypes.c_int)
        u32.SetWindowPos.argtypes = (wintypes.HWND, wintypes.HWND, ctypes.c_int, ctypes.c_int,
                                     ctypes.c_int, ctypes.c_int, wintypes.UINT)
        u32.PeekMessageW.argtypes = (ctypes.POINTER(wintypes.MSG), wintypes.HWND, wintypes.UINT, wintypes.UINT, wintypes.UINT)
        u32.IsWindow.argtypes = (wintypes.HWND,)
        g32.CreateCompatibleDC.argtypes = (wintypes.HDC,)
        g32.CreateCompatibleDC.restype = wintypes.HDC
        g32.CreateDIBSection.argtypes = (wintypes.HDC, ctypes.POINTER(BITMAPINFOHEADER), wintypes.UINT,
                                         ctypes.POINTER(ctypes.c_void_p), wintypes.HANDLE, wintypes.DWORD)
        g32.CreateDIBSection.restype = wintypes.HBITMAP
        g32.SelectObject.argtypes = (wintypes.HDC, wintypes.HGDIOBJ)
        g32.SelectObject.restype = wintypes.HGDIOBJ
        g32.DeleteObject.argtypes = (wintypes.HGDIOBJ,)
        k32.GetModuleHandleW.restype = wintypes.HMODULE
        k32.GetModuleHandleW.argtypes = (wintypes.LPCWSTR,)

        proc = WNDPROC(lambda h, m, w, l: u32.DefWindowProcW(h, m, w, l))
        self._proc = proc                                   # keep the callback alive
        hinst = k32.GetModuleHandleW(None)
        wc = WNDCLASSW(lpfnWndProc=proc, hInstance=hinst, lpszClassName="QuantumCityClock")
        u32.RegisterClassW(ctypes.byref(wc))
        EX = 0x00080000 | 0x00000020 | 0x00000008 | 0x00000080 | 0x08000000   # LAYERED TRANSPARENT TOPMOST TOOLWINDOW NOACTIVATE
        hwnd = u32.CreateWindowExW(EX, "QuantumCityClock", "Quantum city clock", 0x80000000,   # WS_POPUP
                                   0, 0, 1, 1, None, None, hinst, None)
        if not hwnd:
            raise OSError("CreateWindowExW failed")
        screen = u32.GetDC(None)
        mem = g32.CreateCompatibleDC(screen)
        bmp, size, key, alpha, shown, last_top = None, (0, 0), None, 0.0, False, 0.0
        msg = wintypes.MSG()
        last = time.monotonic()
        while True:
            while u32.PeekMessageW(ctypes.byref(msg), None, 0, 0, 1):
                u32.TranslateMessage(ctypes.byref(msg))
                u32.DispatchMessageW(ctypes.byref(msg))
            now = time.monotonic()
            dt, last = now - last, now
            with self._lock:
                want, position, h24, sz, xy = self._want, self.position, self.h24, SIZES.get(self.size, 1.0), self.xy
            game = overlay._find_game()
            fg = u32.GetForegroundWindow()
            visible = bool(want and game and fg == game)
            target = 255.0 if visible else 0.0
            step = 255.0 * dt / FADE_S
            alpha = min(target, alpha + step) if alpha < target else max(target, alpha - step)
            if alpha <= 0 and not visible:
                if shown:
                    u32.ShowWindow(hwnd, 0)
                    shown = False
                time.sleep(0.25)
                continue
            if want:
                rc = wintypes.RECT()
                u32.GetWindowRect(game or fg, ctypes.byref(rc))
                gw, gh = max(640, rc.right - rc.left), max(360, rc.bottom - rc.top)
                scale = gh / 1080.0 * sz
                text = clock_text(want["hours"], h24)
                new_key = (want.get("city"), want.get("body"), text, part_of_day(want["hours"]), round(scale, 2), h24)
                if new_key != key:                         # redraw only when what it says changes
                    img = render(want, self.font_dir, scale, h24)
                    size = img.size
                    bih = BITMAPINFOHEADER(biSize=ctypes.sizeof(BITMAPINFOHEADER), biWidth=size[0], biHeight=-size[1],
                                           biPlanes=1, biBitCount=32, biCompression=0)
                    bits = ctypes.c_void_p()
                    nb = g32.CreateDIBSection(screen, ctypes.byref(bih), 0, ctypes.byref(bits), None, 0)
                    data = img.tobytes("raw", "BGRA")
                    ctypes.memmove(bits, data, len(data))
                    old = g32.SelectObject(mem, nb)
                    if bmp:
                        g32.DeleteObject(bmp)
                    bmp, key = nb, new_key
                margin = int(gh * 0.03)
                if position == "custom":
                    x = int(gw * xy[0] - size[0] / 2)
                    y = int(gh * xy[1])
                    pt = wintypes.POINT(rc.left + max(0, min(gw - size[0], x)), rc.top + max(0, min(gh - size[1], y)))
                elif position == "center":
                    pt = wintypes.POINT(rc.left + (gw - size[0]) // 2, rc.top + (gh - size[1]) // 2)
                elif position == "top-right":
                    pt = wintypes.POINT(rc.left + gw - size[0] - margin, rc.top + int(gh * 0.07))
                elif position == "bottom-right":
                    pt = wintypes.POINT(rc.left + gw - size[0] - margin, rc.top + gh - size[1] - int(gh * 0.12))
                else:
                    frac = {"top": 0.07, "upper": 0.20, "bottom": 0.72}.get(position, 0.07)
                    pt = wintypes.POINT(rc.left + (gw - size[0]) // 2, rc.top + int(gh * frac))
            blend = BLENDFUNCTION(0, 0, int(alpha), 1)        # AC_SRC_OVER, AC_SRC_ALPHA
            u32.UpdateLayeredWindow(hwnd, screen, ctypes.byref(pt), ctypes.byref(wintypes.SIZE(*size)), mem,
                                    ctypes.byref(wintypes.POINT(0, 0)), 0, ctypes.byref(blend), 2)   # ULW_ALPHA
            if not shown:
                u32.ShowWindow(hwnd, 4)                        # SW_SHOWNOACTIVATE
                shown = True
            if now - last_top > 2:                             # games like to take the top spot back
                u32.SetWindowPos(hwnd, wintypes.HWND(-1), 0, 0, 0, 0, 0x0001 | 0x0002 | 0x0010)
                last_top = now
            time.sleep(1 / 30 if 0 < alpha < 255 else 0.2)
