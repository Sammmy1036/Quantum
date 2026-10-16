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

BASE_URL = "https://quantumsc.ddnsgeek.com/assets/"
FOLDERS = ("cities/", "citylights/", "planets/", "terrain/")
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

    # ---- manifest
    def manifest(self):
        with self._lock:
            if self._manifest is not None and time.time() - self._manifest_at < MANIFEST_TTL:
                return self._manifest
            saved = self.dir / "manifest.json"
            try:
                data = json.loads(self._fetch("manifest.json"))
                if not isinstance(data.get("files"), dict):
                    raise ValueError("manifest has no files")
                saved.write_text(json.dumps(data), encoding="utf-8")
            except Exception as e:
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
    def _fetch(path, timeout=30, progress=None):
        """Download one file (gzip on the wire). progress(bytes_so_far) is called as it arrives, counted
        in the file's real (unpacked) size, so it lines up with the manifest's size."""
        req = urllib.request.Request(BASE_URL + urllib.parse.quote(path),
                                     headers={"Accept-Encoding": "gzip", "User-Agent": "Quantum"})
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
            try:
                data = self._fetch(path, timeout=60, progress=lambda n: entry.__setitem__("done", n))
            except Exception as e:
                self.log(f"asset download {path}: {e}")
                data = None
            finally:
                with self._lock:
                    self._active.pop(path, None)
            if data is None or len(data) != want["size"] or self._sha(data) != want["sha256"]:
                if data is not None:
                    self.log(f"asset {path}: download didn't match the manifest; not used")
                with self._lock:
                    self._failed[path] = time.time()
                return None
            dest.parent.mkdir(parents=True, exist_ok=True)
            tmp = dest.with_name(dest.name + ".part")
            tmp.write_bytes(data)
            os.replace(tmp, dest)
            dest.with_name(dest.name + ".ok").write_text(want["sha256"])
            return dest

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
