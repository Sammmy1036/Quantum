import zlib
import hashlib
import http.server
import json
import os
import threading
import time
import urllib.parse
import urllib.request
from pathlib import Path

BASE_URL = "https://quantumsc.org/assets/"
FOLDERS = ("cities/", "citylights/", "planets/", "terrain/", "stations/")
MANIFEST_TTL = 600            # re-check the manifest at most every 10 minutes


class AssetCache:
    def __init__(self, cache_dir, log=None):
        self.dir = Path(cache_dir)
        self.dir.mkdir(parents=True, exist_ok=True)
        self.log = log or (lambda msg: None)
        self._manifest, self._manifest_at = None, 0.0
        self._lock = threading.Lock()
        self._file_locks = {}
        self._server = None
        self._active, self._failed = {}, {}       # path -> {done, total}; path -> when it failed
        self._unlisted = {}                       # path -> when the manifest was last re-read for it
        self.last_error, self.manifest_ok, self.last_ok = None, None, None

    # ---- manifest
    def manifest(self, fresh=False):
        with self._lock:
            if not fresh and self._manifest is not None and time.time() - self._manifest_at < MANIFEST_TTL:
                return self._manifest
            saved = self.dir / "manifest.json"
            try:
                data = json.loads(self._fetch("manifest.json", version=int(time.time())))   # always the server's own
                if not isinstance(data.get("files"), dict):
                    raise ValueError("manifest has no files")
                saved.write_text(json.dumps(data), encoding="utf-8")
                self.manifest_ok = time.time()
            except Exception as e:
                self.last_error = f"manifest.json: {e}"
                self.manifest_ok = False
                if self._manifest is None:
                    self.log(f"asset manifest: {e}; using the saved one")
                try:
                    data = json.loads(saved.read_text(encoding="utf-8"))
                except Exception:
                    data = self._manifest or {"files": {}}
            self._manifest, self._manifest_at = data, time.time()
            return data

    # ---- files
    @staticmethod
    def _fetch(path, timeout=30, progress=None, version=None):
        """Download one file (gzip on the wire). progress(bytes_so_far) is called as it arrives, counted
        in the file's real (unpacked) size, so it lines up with the manifest's size. version goes on the URL
        (?v=...): a CDN in front of the server (Cloudflare) caches by the whole URL, so a rebuilt file, with a
        new hash in the manifest, is a new URL and can never come back as the cache's old copy."""
        url = BASE_URL + urllib.parse.quote(path) + (f"?v={urllib.parse.quote(str(version))}" if version else "")
        req = urllib.request.Request(url, headers={"Accept-Encoding": "gzip", "User-Agent": "Quantum",
                                                   "Cache-Control": "no-cache"})
        with urllib.request.urlopen(req, timeout=timeout) as r:
            unzip = zlib.decompressobj(31) if (r.headers.get("Content-Encoding") or "").lower() == "gzip" else None
            parts, got = [], 0
            while True:
                chunk = r.read(256 * 1024)
                if not chunk:
                    break
                if unzip:
                    chunk = unzip.decompress(chunk)
                parts.append(chunk)
                got += len(chunk)
                if progress:
                    progress(got)
            if unzip:
                parts.append(unzip.flush())
        return b"".join(parts)

    def progress(self):
        """Downloads in progress, for the map's status pill: [{path, done, total}], plus recent failures."""
        with self._lock:
            now = time.time()
            self._failed = {k: v for k, v in self._failed.items() if now - v < 20}
            return {"active": [{"path": k, **v} for k, v in self._active.items()],
                    "failed": sorted(self._failed)}

    @staticmethod
    def _sha(data):
        return hashlib.sha256(data).hexdigest()

    def _cached_ok(self, dest, want):
        """The cached file matches the manifest entry. Size first (cheap); the hash is checked once and
        remembered in a .ok file, so a 40 MB city isn't re-hashed on every launch."""
        try:
            st = dest.stat()
        except OSError:
            return False
        if st.st_size != want["size"]:
            return False
        stamp = dest.with_name(dest.name + ".ok")
        try:
            if stamp.read_text() == want["sha256"]:
                return True
        except OSError:
            pass
        if self._sha(dest.read_bytes()) != want["sha256"]:
            return False
        stamp.write_text(want["sha256"])
        return True

    def get(self, path):
        """Local path of a verified copy of `path` (e.g. 'terrain/Hurston.js'), or None."""
        path = path.replace("\\", "/").lstrip("/")
        if ".." in path.split("/") or not path.startswith(FOLDERS):
            return None
        want = self.manifest().get("files", {}).get(path)
        if want is None and time.time() - self._unlisted.get(path, 0) > 60:
            # Not in the manifest this PC read up to 10 minutes ago: the server's may have it by now (a station
            # model uploaded and the manifest rebuilt while Quantum was running). Asked again at most once a minute.
            self._unlisted[path] = time.time()
            want = self.manifest(fresh=True).get("files", {}).get(path)
            if want is None:
                self.log(f"asset {path}: not in the server's manifest.json")
        dest = self.dir / path
        with self._lock:
            flock = self._file_locks.setdefault(path, threading.Lock())
        with flock:                                    # two requests for one file: download it once
            if want is None:
                # Not in the manifest we have (offline with no saved manifest): an older copy will do.
                return dest if dest.is_file() else None
            if self._cached_ok(dest, want):
                return dest
            entry = {"done": 0, "total": want["size"]}
            with self._lock:
                self._active[path] = entry
                self._failed.pop(path, None)
            data = None
            # A big file over a busy connection is sometimes cut off before it starts (a reset during the TLS
            # handshake): tried again twice, a few seconds apart, before giving up on it for now
            for attempt in range(3):
                try:
                    data = self._fetch(path, timeout=60, progress=lambda n: entry.__setitem__("done", n),
                                       version=want["sha256"][:16])
                    break
                except Exception as e:
                    if attempt < 2 and not isinstance(getattr(e, "code", None), int):
                        time.sleep(3 * (attempt + 1))
                        entry["done"] = 0
                        continue
                    self.log(f"asset download {path}: {e}")
                    self.last_error = f"{path}: {e}"
                    data = None
            if data is not None and (len(data) != want["size"] or self._sha(data) != want["sha256"]):
                # The server's file is newer than the manifest this PC has (it was rebuilt and uploaded while
                # Quantum was running): fetch the manifest again, and if its entry changed, download once more
                new = self.manifest(fresh=True).get("files", {}).get(path)
                if new and new != want and len(data) == new["size"] and self._sha(data) == new["sha256"]:
                    want = new
                elif new and new != want:
                    want, entry["total"], entry["done"] = new, new["size"], 0
                    try:
                        data = self._fetch(path, timeout=60, progress=lambda n: entry.__setitem__("done", n),
                                           version=want["sha256"][:16])
                    except Exception as e:
                        self.log(f"asset download {path}: {e}")
                        data = None
            with self._lock:
                self._active.pop(path, None)
            if data is None or len(data) != want["size"] or self._sha(data) != want["sha256"]:
                if data is not None:
                    self.last_error = (f"{path}: the download didn't match manifest.json (got {len(data):,} bytes, "
                                       f"manifest says {want['size']:,}). The file on the server was changed without "
                                       f"rebuilding the manifest, or something in front of the server changed it")
                    self.log(f"asset {path}: download didn't match the manifest; not used (got {len(data):,} bytes "
                             f"sha256 {self._sha(data)[:12]}, manifest says {want['size']:,} bytes sha256 {want['sha256'][:12]})")
                with self._lock:
                    self._failed[path] = time.time()
                return None
            dest.parent.mkdir(parents=True, exist_ok=True)
            tmp = dest.with_name(dest.name + ".part")
            tmp.write_bytes(data)
            os.replace(tmp, dest)
            dest.with_name(dest.name + ".ok").write_text(want["sha256"])
            self.last_ok = time.time()
            return dest

    def status(self):
        """For Settings › Map data: can the server be reached, what its manifest lists, what's on this PC, and
        the last thing that went wrong. Asks the server for its manifest again."""
        with self._lock:
            self._manifest_at = 0
        files = self.manifest().get("files", {})
        groups = {}
        for f in files:
            groups.setdefault(f.split("/", 1)[0], []).append(f)
        cached = sum(1 for f, w in files.items() if (self.dir / f).is_file())
        cities = sorted(f.split("/", 1)[1].rsplit(".js", 1)[0] for f in groups.get("cities", []) if not f.endswith("index.js"))
        return {"ok": bool(self.manifest_ok), "url": BASE_URL, "files": len(files), "cached": cached,
                "groups": {k: len(v) for k, v in groups.items()}, "cities": cities, "error": self.last_error,
                "last_ok": self.last_ok}

    # ---- local server for the map
    def base_url(self):
        """http://127.0.0.1:<port>/ serving verified files, started on first use."""
        with self._lock:
            if self._server is None:
                cache = self

                class Handler(http.server.BaseHTTPRequestHandler):
                    def do_GET(self):
                        rel = urllib.parse.unquote(urllib.parse.urlsplit(self.path).path)
                        p = cache.get(rel)
                        if p is None:
                            self.send_error(404)
                            return
                        body = p.read_bytes()
                        self.send_response(200)
                        self.send_header("Content-Type", "text/javascript; charset=utf-8")
                        self.send_header("Content-Length", str(len(body)))
                        self.send_header("Cache-Control", "no-store")
                        self.end_headers()
                        self.wfile.write(body)

                    def log_message(self, *a):
                        pass

                self._server = http.server.ThreadingHTTPServer(("127.0.0.1", 0), Handler)
                self._server.daemon_threads = True
                threading.Thread(target=self._server.serve_forever, daemon=True).start()
            return f"http://127.0.0.1:{self._server.server_address[1]}/"
