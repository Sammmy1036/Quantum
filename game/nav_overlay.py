"""Navigation guide: an arrow drawn over the game pointing to where you're going (Settings > Navigation Guide Overlay).

The same kind of window as the city clock (city_clock.CityClock: borderless, click-through, always on top, only
while Star Citizen is the active window, Borderless or Windowed mode). It shows while you fly over a planet or moon
towards a place on it (your Guide me target, or your next route stop) and Quantum knows where you are: dead
reckoning from your last /showlocation, with your ship's heading from the game's telemetry.

Three looks:
    arrow     a big arrow that turns with you: straight up is straight ahead
    compass   a ring around your ship with a pointer on its edge
    tape      a heading strip like the ship's HUD, with a marker at the place's bearing

    guide = NavOverlay(font_dir)
    guide.show({"name": "Onyx Facility S2B6", "dist": 113400, "turn": -12.0, "heading": 62.0, "ship": 74.0},
               "bottom", None, "large", None, {"color": "blue", "style": "arrow", "opacity": 100})
"""
import math
import os

from game.city_clock import AVAILABLE, COLORS, OPACITIES, POSITIONS, SIZES, CityClock  # noqa: F401

STYLES = ("arrow", "compass", "tape")
_FONTS = {}


def dist_text(m):
    if m is None:
        return ""
    if m < 1000:
        return f"{int(round(m / 10) * 10)} m"
    if m < 100_000:
        return f"{m / 1000:.1f} km"
    return f"{m / 1000:,.0f} km"


def turn_text(turn):
    if turn is None:
        return ""
    if abs(turn) < 3:
        return "AHEAD"
    return f"{abs(round(turn))}° {'RIGHT' if turn > 0 else 'LEFT'}"


def _paste_icon(img, icon, cx, cy, size, rgb):
    """The place's icon (white RGBA from the page), tinted, centred on (cx, cy)."""
    from PIL import Image
    size = max(6, int(size))
    ic = icon.resize((size, size), Image.LANCZOS)
    tint = Image.new("RGBA", ic.size, rgb + (255,))
    tint.putalpha(ic.getchannel("A"))
    img.alpha_composite(tint, (int(cx - size / 2), int(cy - size / 2)))


def _rot(points, cx, cy, deg):
    a = math.radians(deg)
    c, s = math.cos(a), math.sin(a)
    return [(cx + x * c - y * s, cy + x * s + y * c) for x, y in points]


def render(info, font_dir, scale=1.0, color="blue", style="arrow"):
    """The guide's picture (premultiplied-alpha RGBA, Pillow Image) for {name, dist, turn, heading, ship}."""
    from PIL import Image, ImageChops, ImageDraw, ImageFilter, ImageFont
    main, accent, glow_rgb = COLORS.get(color) or COLORS["blue"]
    S = lambda v: v * scale                                  # noqa: E731

    def font(weight, size):
        key = (str(font_dir), weight, max(8, int(size * scale)))
        if key not in _FONTS:                             # loaded once: it's drawn many times a second
            try:
                _FONTS[key] = ImageFont.truetype(str(os.path.join(font_dir, f"Orbitron-{weight}.ttf")), key[2])
            except OSError:
                _FONTS[key] = ImageFont.load_default()
        return _FONTS[key]

    f_big, f_mid, f_small = font(700, 30), font(500, 17), font(500, 13)
    turn = info.get("turn")
    turn = 0.0 if turn is None else float(turn)
    icon = info.get("icon")
    name = (info.get("name") or "").upper()
    if len(name) > 30:
        name = name[:29] + "…"
    lines = [(dist_text(info.get("dist")), f_big, main), (turn_text(info.get("turn")), f_mid, accent), (name, f_small, accent)]

    if style == "tape":
        w, top = int(S(600)), int(S(70))
    else:
        w, top = int(S(280)), int(S(200 if style == "compass" else 170))
    th = sum(f.getbbox("HG09")[3] + S(8) for _, f, _ in lines)
    h = int(top + th + S(24))
    img = Image.new("RGBA", (w, h), (0, 0, 0, 0))
    d = ImageDraw.Draw(img)
    lw = max(1, int(S(2)))

    if style == "arrow":
        cx, cy = w / 2, S(88)
        arrow = [(0, -S(70)), (S(48), S(10)), (S(18), S(-4)), (S(18), S(62)), (-S(18), S(62)), (-S(18), S(-4)), (-S(48), S(10))]
        d.polygon(_rot(arrow, cx, cy, turn), fill=main + (235,))
    elif style == "compass":
        cx, cy, r = w / 2, S(100), S(78)
        d.ellipse((cx - r, cy - r, cx + r, cy + r), outline=accent + (200,), width=lw)
        for k in range(0, 360, 30):                       # ticks every 30°, longer ahead / behind / to the sides
            a = math.radians(k)
            r0 = r - S(12 if k % 90 == 0 else 7)
            d.line((cx + r0 * math.sin(a), cy - r0 * math.cos(a), cx + r * math.sin(a), cy - r * math.cos(a)),
                   fill=accent + (200,), width=lw)
        ship = [(0, -S(16)), (S(11), S(12)), (0, S(6)), (-S(11), S(12))]       # you, always pointing up
        d.polygon(_rot(ship, cx, cy, 0), fill=accent + (230,))
        a = math.radians(turn)                            # the place: a pointer on the ring's edge
        px, py = cx + (r + S(4)) * math.sin(a), cy - (r + S(4)) * math.cos(a)
        if icon is not None:                              # the place's own icon on the ring
            d.ellipse((px - S(17), py - S(17), px + S(17), py + S(17)), fill=(6, 14, 28, 170), outline=main + (230,), width=lw)
            _paste_icon(img, icon, px, py, S(24), main)
        else:
            tri = [(0, -S(20)), (S(13), S(6)), (-S(13), S(6))]
            d.polygon(_rot(tri, px, py, turn), fill=main + (245,))
        d.line((cx + S(22) * math.sin(a), cy - S(22) * math.cos(a), px - S(6) * math.sin(a), py + S(6) * math.cos(a)),
               fill=main + (150,), width=lw)
    else:                                                 # tape: ±60° of your heading across the strip
        ship_h = float(info.get("ship") or 0.0)
        x0, x1, y = S(40), w - S(40), S(40)
        span = 60.0
        px_per = (x1 - x0) / (2 * span)
        d.line((x0, y, x1, y), fill=accent + (150,), width=lw)
        start = math.floor(ship_h - span)
        for k in range(start, int(ship_h + span) + 1):
            if k % 5:
                continue
            x = w / 2 + (k - ship_h) * px_per
            if x < x0 or x > x1:
                continue
            big = k % 30 == 0
            d.line((x, y, x, y - S(14 if big else 9 if k % 15 == 0 else 5)), fill=accent + (210,), width=lw)
            if big:
                kk = k % 360
                lab = {0: "N", 90: "E", 180: "S", 270: "W"}.get(kk, f"{kk:03d}")
                tw = f_small.getlength(lab)
                d.text((x - tw / 2, y - S(34)), lab, font=f_small, fill=main + (230,))
        d.polygon([(w / 2, y + S(3)), (w / 2 - S(7), y + S(13)), (w / 2 + S(7), y + S(13))], fill=accent + (230,))   # you
        if abs(turn) <= span:
            mx = w / 2 + turn * px_per
            if icon is not None:                          # the place's own icon at its bearing
                _paste_icon(img, icon, mx, y, S(26), main)
            else:
                dia = [(mx, y - S(12)), (mx + S(10), y), (mx, y + S(12)), (mx - S(10), y)]
                d.polygon(dia, fill=main + (250,))
        else:                                             # off the strip: an arrowhead at its end
            ex = x1 + S(6) if turn > 0 else x0 - S(6)
            sgn = 1 if turn > 0 else -1
            d.polygon([(ex + sgn * S(14), y), (ex, y - S(10)), (ex, y + S(10))], fill=main + (250,))

    yy = top
    for i, (t, f, col) in enumerate(lines):
        if t:
            tw = sum(f.getlength(ch) for ch in t) + 0.08 * f.size * max(0, len(t) - 1)
            x = (w - tw) / 2
            if i == 2 and icon is not None and style == "arrow":     # the arrow: the place's icon by its name
                isz = f.size * 1.5
                x += isz * 0.6
                _paste_icon(img, icon, x - isz * 0.75, yy + f.size * 0.55, isz, accent)
            for ch in t:
                d.text((x, yy), ch, font=f, fill=col + (255,))
                x += f.getlength(ch) + 0.08 * f.size
        yy += f.getbbox("HG09")[3] + S(8)

    # Glow and a dark soft shadow, as the clock has, so it reads on snow and on night sky alike
    # blurred at half size and scaled back up: the same soft glow for a quarter of the work (it's redrawn
    # many times a second as it turns)
    a = img.getchannel("A")
    small = a.resize((max(1, w // 2), max(1, h // 2)), Image.BILINEAR)
    glow = Image.new("RGBA", (w, h), glow_rgb + (0,))
    glow.putalpha(small.filter(ImageFilter.GaussianBlur(4 * scale)).resize((w, h), Image.BILINEAR).point(lambda v: int(v * 0.85)))
    shade = Image.new("RGBA", (w, h), (0, 8, 20, 0))
    shade.putalpha(small.filter(ImageFilter.GaussianBlur(2 * scale)).resize((w, h), Image.BILINEAR).point(lambda v: int(v * 0.55)))
    out = Image.alpha_composite(Image.alpha_composite(shade, glow), img)
    r, g, b, al = out.split()
    return Image.merge("RGBA", (ImageChops.multiply(r, al), ImageChops.multiply(g, al), ImageChops.multiply(b, al), al))


def _ease(cur, target, k):
    """An angle eased towards another, the short way round."""
    if cur is None or target is None:
        return target
    d = ((target - cur + 540) % 360) - 180
    return cur + d * k


class NavOverlay(CityClock):
    WCLASS, WTITLE, THREAD = "QuantumNavGuide", "Quantum navigation guide", "nav-guide"
    FRAME_S = 1 / 40         # redrawn up to 40 times a second while it turns
    EASE_S = 0.12            # the arrow catches up with each new reading over about this long: smooth, barely late

    def __init__(self, font_dir):
        super().__init__(font_dir)
        self.position = "bottom"
        self.look = {"color": "blue", "style": "arrow", "opacity": 100}
        self._shown = None   # what's drawn now: {turn, ship}, eased towards the latest reading every frame

    def _tick(self, want, dt):
        # Readings come a few times a second, so stepping straight to each one looked choppy as you turned:
        # the arrow (and the tape) glides from where it is to the newest reading instead
        if not want:
            self._shown = None
            return want
        k = 1.0 - math.exp(-max(0.0, dt) / self.EASE_S)
        sh = self._shown
        if sh is None or sh.get("name") != want.get("name"):
            sh = {"name": want.get("name"), "turn": want.get("turn"), "ship": want.get("ship")}
        else:
            t = _ease(sh["turn"], want.get("turn"), k)
            sh = {"name": sh["name"], "turn": None if t is None else ((t + 180) % 360) - 180,
                  "ship": None if _ease(sh["ship"], want.get("ship"), k) is None else _ease(sh["ship"], want.get("ship"), k) % 360}
        self._shown = sh
        return {**want, "turn": sh["turn"], "ship": sh["ship"]}

    def _set_look(self, look):
        self.look = {"color": look.get("color") if look.get("color") in COLORS else "blue",
                     "style": look.get("style") if look.get("style") in STYLES else "arrow",
                     "opacity": look.get("opacity") if look.get("opacity") in OPACITIES else 100}

    def _key(self, want, scale, h24, look):
        turn = want.get("turn")
        return (look["style"], look["color"], round(scale, 2), want.get("name"), id(want.get("icon")), dist_text(want.get("dist")),
                None if turn is None else round(turn * 2), round((want.get("ship") or 0) * 2) if look["style"] == "tape" else 0)

    def _render(self, want, scale, h24, look):
        return render(want, self.font_dir, scale, look["color"], look["style"])
