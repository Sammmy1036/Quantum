"""Encrypted backups of what you've set up in Quantum: your fleet and its component swaps, waypoints,
planned trade routes and the stations you mapped. Never tokens or keys.

Everything is encrypted here, on your PC, before it's sent, with keys made from your UEX Bearer Token
(which everyone using the UEX tabs has, datarunner or not). The same token also picks which backup
slot on the server is yours, so nobody can find, read or replace your backup without it. The Quantum
server only stores scrambled bytes it can't read, and the token itself is never sent to it.

Only the fields below are ever backed up or restored, each checked for its type and size (see
clean()): a backup holds plain data, never files, and nothing in one can be run.

No dependencies: HMAC-SHA256 is used as the keystream (counter mode, a fresh random nonce for every
backup) and to authenticate the result (encrypt-then-MAC). A changed or damaged backup is refused.
"""
import base64
import hashlib
import hmac
import json
import os
import zlib

MAGIC = b"QB2"
MAX_BYTES = 512 * 1024          # the compressed, encrypted backup; a huge fleet is a few KB


def keys(token):
    """{slot, enc, mac, auth} for this UEX Bearer Token. slot and auth are sent; enc and mac never are."""
    base = hmac.new(token.strip().encode(), b"quantum-backup-v2", hashlib.sha256).digest()
    k = lambda label: hmac.new(base, label, hashlib.sha256).digest()
    return {"slot": k(b"slot").hex(), "enc": k(b"enc"), "mac": k(b"mac"), "auth": k(b"auth").hex()}


def _stream(key, nonce, n):
    out, i = bytearray(), 0
    while len(out) < n:
        out += hmac.new(key, nonce + i.to_bytes(8, "big"), hashlib.sha256).digest()
        i += 1
    return bytes(out[:n])


def encrypt(token, payload):
    k = keys(token)
    data = zlib.compress(json.dumps(clean(payload), separators=(",", ":")).encode("utf-8"), 9)
    nonce = os.urandom(16)
    ct = bytes(a ^ b for a, b in zip(data, _stream(k["enc"], nonce, len(data))))
    tag = hmac.new(k["mac"], MAGIC + nonce + ct, hashlib.sha256).digest()
    blob = base64.b64encode(MAGIC + nonce + tag + ct).decode("ascii")
    if len(blob) > MAX_BYTES:
        raise ValueError("the backup is larger than the server accepts")
    return blob


def decrypt(token, blob):
    """The payload (cleaned), or ValueError if it isn't yours or was changed."""
    k = keys(token)
    raw = base64.b64decode(blob, validate=True)
    if raw[:3] != MAGIC or len(raw) < 3 + 16 + 32:
        raise ValueError("not a Quantum backup")
    nonce, tag, ct = raw[3:19], raw[19:51], raw[51:]
    if not hmac.compare_digest(tag, hmac.new(k["mac"], MAGIC + nonce + ct, hashlib.sha256).digest()):
        raise ValueError("this backup was made with a different UEX Bearer Token, or it was changed")
    d = zlib.decompressobj()
    data = d.decompress(bytes(a ^ b for a, b in zip(ct, _stream(k["enc"], nonce, len(ct)))), 8 * 1024 * 1024)
    if d.unconsumed_tail:
        raise ValueError("the backup is too large")
    return clean(json.loads(data.decode("utf-8")))


def fingerprint(payload):
    """A hash of the content, to upload only when something changed."""
    return hashlib.sha256(json.dumps(clean(payload), sort_keys=True, separators=(",", ":")).encode()).hexdigest()


# ---------------------------------------------------------------- what a backup may hold
# Plain data only: strings, numbers, true/false, and lists and objects of them, with every string,
# list and object capped. Anything else (or anything too big) is dropped, both before uploading and
# after restoring, so a damaged or tampered settings file can't put anything odd into a backup.
MAX_STR, MAX_LIST, MAX_KEYS, MAX_DEPTH = 2000, 500, 200, 6
LIMITS = {"fleet": 200, "trade_runs": 500, "waypoints": 2000, "places": 500}


def _plain(v, depth=0):
    if v is None or isinstance(v, bool):
        return v
    if isinstance(v, (int, float)):
        return v if v == v and abs(v) < 1e18 else None          # no NaN, no absurd numbers
    if isinstance(v, str):
        return v[:MAX_STR]
    if depth >= MAX_DEPTH:
        return None
    if isinstance(v, list):
        return [_plain(x, depth + 1) for x in v[:MAX_LIST]]
    if isinstance(v, dict):
        return {str(k)[:100]: _plain(x, depth + 1) for k, x in list(v.items())[:MAX_KEYS]}
    return None


def clean(payload):
    """Only the known sections, each the right shape and size."""
    p = payload if isinstance(payload, dict) else {}
    out = {"v": 2}
    for key in ("fleet", "trade_runs", "waypoints"):
        items = p.get(key) if isinstance(p.get(key), list) else []
        out[key] = [_plain(x) for x in items[:LIMITS[key]] if isinstance(x, dict)]
    places = p.get("places") if isinstance(p.get("places"), dict) else {}
    out["places"] = {str(k)[:200]: _plain(v) for k, v in list(places.items())[:LIMITS["places"]] if isinstance(v, dict)}
    return out
