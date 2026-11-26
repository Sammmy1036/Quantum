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
        try:
            return ImageFont.truetype(str(os.path.join(font_dir, f"Orbitron-{weight}.ttf")), max(8, int(size * scale)))
        except OSError:
            return ImageFont.load_default()

    f_big, f_mid, f_small = font(700, 30), font(500, 17), font(500, 13)
    turn = info.get("turn")
    turn = 0.0 if turn is None else float(turn)
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
            dia = [(mx, y - S(12)), (mx + S(10), y), (mx, y + S(12)), (mx - S(10), y)]
            d.polygon(dia, fill=main + (250,))
        else:                                             # off the strip: an arrowhead at its end
            ex = x1 + S(6) if turn > 0 else x0 - S(6)
            sgn = 1 if turn > 0 else -1
            d.polygon([(ex + sgn * S(14), y), (ex, y - S(10)), (ex, y + S(10))], fill=main + (250,))

    yy = top
    for t, f, col in lines:
        if t:
            tw = sum(f.getlength(ch) for ch in t) + 0.08 * f.size * max(0, len(t) - 1)
            x = (w - tw) / 2
            for ch in t:
                d.text((x, yy), ch, font=f, fill=col + (255,))
                x += f.getlength(ch) + 0.08 * f.size
        yy += f.getbbox("HG09")[3] + S(8)

    # Glow and a dark soft shadow, as the clock has, so it reads on snow and on night sky alike
    a = img.getchannel("A")
    glow = Image.new("RGBA", (w, h), glow_rgb + (0,))
    glow.putalpha(a.filter(ImageFilter.GaussianBlur(8 * scale)).point(lambda v: int(v * 0.85)))
    shade = Image.new("RGBA", (w, h), (0, 8, 20, 0))
    shade.putalpha(a.filter(ImageFilter.GaussianBlur(4 * scale)).point(lambda v: int(v * 0.55)))
    out = Image.alpha_composite(Image.alpha_composite(shade, glow), img)
    r, g, b, al = out.split()
    return Image.merge("RGBA", (ImageChops.multiply(r, al), ImageChops.multiply(g, al), ImageChops.multiply(b, al), al))


class NavOverlay(CityClock):
    WCLASS, WTITLE, THREAD = "QuantumNavGuide", "Quantum navigation guide", "nav-guide"

    def __init__(self, font_dir):
        super().__init__(font_dir)
        self.position = "bottom"
        self.look = {"color": "blue", "style": "arrow", "opacity": 100}

    def _set_look(self, look):
        self.look = {"color": look.get("color") if look.get("color") in COLORS else "blue",
                     "style": look.get("style") if look.get("style") in STYLES else "arrow",
                     "opacity": look.get("opacity") if look.get("opacity") in OPACITIES else 100}

    def _key(self, want, scale, h24, look):
        turn = want.get("turn")
        return (look["style"], look["color"], round(scale, 2), want.get("name"), dist_text(want.get("dist")),
                None if turn is None else round(turn / 2), round((want.get("ship") or 0) / 2) if look["style"] == "tape" else 0)

    def _render(self, want, scale, h24, look):
        return render(want, self.font_dir, scale, look["color"], look["style"])
