"""Updates from GitHub Releases (github.com/Sammmy1036/Quantum/releases).

At start-up Quantum asks GitHub for the latest release. If its tag (v1.4.0) is newer than VERSION
below, the page offers the update with your release notes. Updating:
  1. downloads the installer (Quantum-Setup-<version>.exe) and its .sig from the release, to the
     temp folder;
  2. checks the signature: an Ed25519 signature, made on your PC with sign_release.py, over
     "Quantum <version>" and the file's SHA-256. Quantum only runs what that key signed,
     so even someone with access to the GitHub account can't push a different file;
  3. runs the installer silently into the folder Quantum is installed in and closes. The installer
     replaces Quantum.exe and _internal (the UI lives there too) and starts the new version.
The whole installer is used rather than Quantum.exe alone: a PyInstaller folder build keeps the UI,
libraries and data in _internal, and an exe on its own would leave those at the old version.
Settings, fleet and reports live in files beside the exe and the installer leaves them alone.

Running from source (python app.py), it only tells you an update exists and links to the release.
No dependencies: Ed25519 verification is the reference algorithm from RFC 8032.
"""
import hashlib
import json
import os
import re
import subprocess
import sys
import threading
import time
import urllib.request
from pathlib import Path

VERSION = "0.0.0.5"                     
REPO = "Sammmy1036/Quantum"
ASSET = re.compile(r"^Quantum-Setup-[\w.\-]+\.exe$", re.I)   

PUBLIC_KEY = "8ac7d1e1fd1d97ff564433a26c5f5a108460f077954606965ab20ea76279759b"

API = f"https://api.github.com/repos/{REPO}/releases/latest"
UA = {"User-Agent": f"Quantum/{VERSION}", "Accept": "application/vnd.github+json"}
# Same request, but GitHub also sends the release notes rendered to HTML (body_html), exactly as the
# release page shows them: headings, bold, lists, links, images.
UA_FULL = {**UA, "Accept": "application/vnd.github.full+json"}
IMG_MAX = 2_000_000                       # bytes per picture in the notes
IMG_TYPES = {".svg": "image/svg+xml", ".png": "image/png", ".jpg": "image/jpeg", ".jpeg": "image/jpeg",
             ".gif": "image/gif", ".webp": "image/webp"}


def _inline_image(src, tag, timeout=8):
    """A picture from the release notes as a data: URL, so it shows inside Quantum. Relative paths
    ("images/quantum-banner.svg") are files in the repo at that release's tag. None if it can't be had."""
    import base64
    import urllib.parse
    if src.startswith("data:"):
        return src
    if src.startswith("//"):
        src = "https:" + src
    elif src.startswith("/"):                             # "/Sammmy1036/Quantum/raw/v1/images/x.svg"
        src = "https://github.com" + src
    if not re.match(r"https?://", src):                  # relative to the repo, as on the release page
        path = src.lstrip("./")
        return (_inline_image(f"https://raw.githubusercontent.com/{REPO}/{tag}/{path}", tag, timeout) if tag else None) \
            or _inline_image(f"https://raw.githubusercontent.com/{REPO}/HEAD/{path}", tag, timeout)
    m = re.match(r"https://github\.com/([^/]+/[^/]+)/(?:blob|raw)/(.+)$", src)
    if m:
        src = f"https://raw.githubusercontent.com/{m.group(1)}/{m.group(2)}"
    host = urllib.parse.urlparse(src).hostname or ""
    if not (host.endswith("githubusercontent.com") or host.endswith("github.com")):
        return None                                      # only GitHub's own hosts
    try:
        with urllib.request.urlopen(urllib.request.Request(src, headers={"User-Agent": UA["User-Agent"]}),
                                    timeout=timeout) as r:
            data = r.read(IMG_MAX + 1)
            ctype = (r.headers.get("Content-Type") or "").split(";")[0].strip()
    except Exception:
        return None
    if len(data) > IMG_MAX:
        return None
    ext = os.path.splitext(urllib.parse.urlparse(src).path)[1].lower()
    # raw.githubusercontent.com sends every file as text/plain: go by the file name there
    mime = IMG_TYPES.get(ext) or (ctype if ctype.startswith("image/") else None)
    if not mime:
        return None
    return f"data:{mime};base64," + base64.b64encode(data).decode("ascii")


def notes_html(html, tag):
    """GitHub's rendered release notes, made safe and self-contained for the update box: no scripts
    or event handlers, links open in your browser, pictures inlined."""
    if not html:
        return ""
    html = re.sub(r"(?is)<(script|style|iframe|object|embed|form)\b.*?(</\1>|$)", "", html)
    html = re.sub(r"(?i)\s+on[a-z]+\s*=\s*(\"[^\"]*\"|'[^']*'|[^\s>]+)", "", html)

    def link(m):
        attrs = m.group(1)
        h = re.search(r'href\s*=\s*"([^"]*)"', attrs)
        url = h.group(1) if h else ""
        if url.startswith("/"):
            url = "https://github.com" + url
        if not url.startswith("https://"):
            return "<a>"
        return f'<a data-ext="{url}" title="{url}">'
    html = re.sub(r"(?i)<a\b([^>]*)>", link, html)

    def img(m):
        tagtxt = m.group(0)
        s = re.search(r'\bsrc\s*=\s*"([^"]*)"', tagtxt)
        orig = re.search(r'\bdata-canonical-src\s*=\s*"([^"]*)"', tagtxt)
        data = (_inline_image(orig.group(1), tag) if orig else None) or (_inline_image(s.group(1), tag) if s else None)
        if not data:
            alt = re.search(r'\balt\s*=\s*"([^"]*)"', tagtxt)
            return f'<span class="muted">{alt.group(1) if alt else ""}</span>'
        alt = re.search(r'\balt\s*=\s*"([^"]*)"', tagtxt)
        width = re.search(r'\bwidth\s*=\s*"([^"]*)"', tagtxt)
        return (f'<img src="{data}" alt="{alt.group(1) if alt else ""}"'
                + (f' width="{width.group(1)}"' if width else "") + ">")
    return re.sub(r"(?i)<img\b[^>]*>", img, html)


# ---------------------------------------------------------------- Ed25519 (RFC 8032, verify + sign)
_p = 2 ** 255 - 19
_L = 2 ** 252 + 27742317777372353535851937790883648493
_d = -121665 * pow(121666, _p - 2, _p) % _p
_I = pow(2, (_p - 1) // 4, _p)


def _inv(x):
    return pow(x, _p - 2, _p)


def _xrecover(y):
    xx = (y * y - 1) * _inv(_d * y * y + 1)
    x = pow(xx, (_p + 3) // 8, _p)
    if (x * x - xx) % _p:
        x = x * _I % _p
    return _p - x if x % 2 else x


_By = 4 * _inv(5) % _p
_B = (_xrecover(_By), _By, 1, _xrecover(_By) * _By % _p)


def _add(P, Q):
    A = (P[1] - P[0]) * (Q[1] - Q[0]) % _p
    B = (P[1] + P[0]) * (Q[1] + Q[0]) % _p
    C = 2 * P[3] * Q[3] * _d % _p
    D = 2 * P[2] * Q[2] % _p
    E, F, G, H = B - A, D - C, D + C, B + A
    return (E * F % _p, G * H % _p, F * G % _p, E * H % _p)


def _mul(s, P):
    Q = (0, 1, 1, 0)
    while s:
        if s & 1:
            Q = _add(Q, P)
        P = _add(P, P)
        s >>= 1
    return Q


def _enc(P):
    zi = _inv(P[2])
    x, y = P[0] * zi % _p, P[1] * zi % _p
    return int.to_bytes(y | ((x & 1) << 255), 32, "little")


def _dec(b):
    y = int.from_bytes(b, "little")
    sign, y = y >> 255, y & ((1 << 255) - 1)
    if y >= _p:
        raise ValueError("bad point")
    x = _xrecover(y)
    if (x & 1) != sign:
        x = _p - x
    P = (x, y, 1, x * y % _p)
    if (-x * x + y * y - 1 - _d * x * x * y * y) % _p:
        raise ValueError("not on curve")
    return P


def _h(m):
    return int.from_bytes(hashlib.sha512(m).digest(), "little")


def _eq(P, Q):
    return (P[0] * Q[2] - Q[0] * P[2]) % _p == 0 and (P[1] * Q[2] - Q[1] * P[2]) % _p == 0


def public_key(seed):
    h = hashlib.sha512(seed).digest()
    a = int.from_bytes(h[:32], "little") & ((1 << 254) - 8) | (1 << 254)
    return _enc(_mul(a, _B))


def sign(seed, msg):
    h = hashlib.sha512(seed).digest()
    a = int.from_bytes(h[:32], "little") & ((1 << 254) - 8) | (1 << 254)
    A = _enc(_mul(a, _B))
    r = _h(h[32:] + msg) % _L
    R = _enc(_mul(r, _B))
    S = (r + _h(R + A + msg) * a) % _L
    return R + int.to_bytes(S, 32, "little")


def verify(pub, msg, sig):
    try:
        if len(sig) != 64 or len(pub) != 32:
            return False
        A, R = _dec(pub), _dec(sig[:32])
        S = int.from_bytes(sig[32:], "little")
        if S >= _L:
            return False
        return _eq(_mul(S, _B), _add(R, _mul(_h(sig[:32] + pub + msg) % _L, A)))
    except Exception:
        return False


def signed_message(version, sha256_hex):
    """What a release signature covers: the version and the exact file."""
    return f"Quantum {version}\n{sha256_hex}".encode("utf-8")


# ---------------------------------------------------------------- versions
def parse(v):
    """ "v1.4.0" -> (1, 4, 0); any number of parts, so "0.0.0.1" -> (0, 0, 0, 1)."""
    m = re.match(r"v?(\d+(?:\.\d+)*)", str(v or "").strip())
    return tuple(int(x) for x in m.group(1).split(".")) if m else (0,)


def newer(a, b):
    """Is version a newer than b? Missing parts count as 0, so 1.0 and 1.0.0 are the same."""
    a, b = parse(a), parse(b)
    n = max(len(a), len(b))
    return a + (0,) * (n - len(a)) > b + (0,) * (n - len(b))


# ---------------------------------------------------------------- the updater
class Updater:
    def __init__(self, exe_path=None):
        self.frozen = bool(getattr(sys, "frozen", False))
        self.exe = Path(exe_path or sys.executable).resolve()
        self.latest = None
        self.state = {"stage": "idle"}               # idle | downloading | verifying | ready | error
        self._lock = threading.Lock()

    @staticmethod
    def _dl_dir():
        return Path(os.environ.get("TEMP") or os.environ.get("TMP") or Path.home()) / "QuantumUpdate"

    def cleanup(self):
        """At start: remove what the last update left behind (and files from the old exe-only updater)."""
        for f in [self.exe.parent / "Quantum.old.exe", self.exe.parent / "Quantum.new.exe",
                  *(self._dl_dir().glob("Quantum-Setup-*.exe") if self._dl_dir().exists() else [])]:
            try:
                f.unlink()
            except OSError:
                pass

    def check(self, timeout=8):
        """The latest release, if it's newer than this one: {version, notes, url, exe, sig, can_install}."""
        try:
            with urllib.request.urlopen(urllib.request.Request(API, headers=UA_FULL), timeout=timeout) as r:
                rel = json.loads(r.read().decode("utf-8"))
        except Exception as e:
            return {"available": False, "current": VERSION, "error": str(e)}
        tag = rel.get("tag_name") or ""
        if rel.get("draft") or rel.get("prerelease") or not newer(tag, VERSION):
            return {"available": False, "current": VERSION}
        assets = {a.get("name"): a.get("browser_download_url") for a in rel.get("assets") or []}
        setup = next((n for n in assets if n and ASSET.match(n)), None)
        try:
            rendered = notes_html(rel.get("body_html") or "", tag)
        except Exception:
            rendered = ""                                 # fall back to the plain text
        self.latest = {"available": True, "current": VERSION, "version": tag.lstrip("v"), "notes": rel.get("body") or "",
                       "notes_html": rendered,
                       "url": rel.get("html_url"), "exe": assets.get(setup) if setup else None,
                       "sig": assets.get(setup + ".sig") if setup else None, "file": setup,
                       "published": rel.get("published_at")}
        self.latest["can_install"] = bool(self.frozen and PUBLIC_KEY and self.latest["exe"] and self.latest["sig"])
        if not PUBLIC_KEY:
            self.latest["why_not"] = "This build has no update key, so it can't install updates itself"
        elif not (self.latest["exe"] and self.latest["sig"]):
            self.latest["why_not"] = "The release is missing Quantum-Setup-<version>.exe or its .sig"
        elif not self.frozen:
            self.latest["why_not"] = "Running from source: download it from GitHub"
        return dict(self.latest)

    def _set(self, **kw):
        with self._lock:
            self.state = dict(kw)

    def progress(self):
        with self._lock:
            return dict(self.state)

    def download(self):
        """Fetch and verify the new exe, in the background. Poll progress()."""
        rel = self.latest
        if not rel or not rel.get("can_install"):
            return {"ok": False, "error": (rel or {}).get("why_not") or "No update to install"}
        if self.progress().get("stage") in ("downloading", "verifying"):
            return {"ok": True}
        threading.Thread(target=self._download, args=(rel,), daemon=True).start()
        return {"ok": True}

    def _download(self, rel):
        self._dl_dir().mkdir(parents=True, exist_ok=True)
        new = self._dl_dir() / f"Quantum-Setup-{rel['version']}.exe"
        try:
            self._set(stage="downloading", done=0, total=0)
            with urllib.request.urlopen(urllib.request.Request(rel["sig"], headers=UA), timeout=30) as r:
                sig = bytes.fromhex(r.read().decode("ascii").strip())
            h = hashlib.sha256()
            with urllib.request.urlopen(urllib.request.Request(rel["exe"], headers=UA), timeout=60) as r, open(new, "wb") as out:
                total, done = int(r.headers.get("Content-Length") or 0), 0
                while True:
                    chunk = r.read(256 * 1024)
                    if not chunk:
                        break
                    out.write(chunk)
                    h.update(chunk)
                    done += len(chunk)
                    self._set(stage="downloading", done=done, total=total)
            self._set(stage="verifying")
            if not verify(bytes.fromhex(PUBLIC_KEY), signed_message(rel["version"], h.hexdigest()), sig):
                new.unlink(missing_ok=True)
                return self._set(stage="error", error="The download isn't signed by Quantum's release key, so it wasn't installed")
            self._set(stage="ready", version=rel["version"], file=str(new))
        except Exception as e:
            try:
                new.unlink(missing_ok=True)
            except OSError:
                pass
            self._set(stage="error", error=f"Download failed: {e}")

    def install_and_restart(self):
        """Run the verified installer silently into this install's folder. It closes Quantum,
        replaces the program files and starts the new version. The caller closes Quantum right after."""
        st = self.progress()
        if st.get("stage") != "ready" or not st.get("file") or not Path(st["file"]).exists():
            return {"ok": False, "error": "The update isn't downloaded yet"}
        args = [st["file"], "/VERYSILENT", "/SUPPRESSMSGBOXES", "/NORESTART", "/CLOSEAPPLICATIONS",
                f"/DIR={self.exe.parent}"]
        flags = 0x00000008 | 0x00000200 if os.name == "nt" else 0   # DETACHED_PROCESS | NEW_PROCESS_GROUP
        try:
            subprocess.Popen(args, cwd=str(Path(st["file"]).parent), creationflags=flags, close_fds=True)
        except OSError as e:
            return {"ok": False, "error": f"Couldn't start the installer: {e}"}
        return {"ok": True}
