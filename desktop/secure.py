"""Secrets kept in settings.json, encrypted with Windows' own data protection (DPAPI).

Only the same Windows account on the same PC can decrypt them, so a copy of settings.json (a backup, a file sent
along with a bug report, a synced folder) is of no use anywhere else. Standard library only (ctypes); on other
systems (development), values are kept as they are, marked so they're still read back correctly.
"""
import base64
import ctypes
import sys

_PREFIX_DPAPI, _PREFIX_PLAIN = "dpapi:", "plain:"

if sys.platform == "win32":
    from ctypes import wintypes

    class _Blob(ctypes.Structure):
        _fields_ = [("cbData", wintypes.DWORD), ("pbData", ctypes.POINTER(ctypes.c_char))]

    _crypt32, _kernel32 = ctypes.windll.crypt32, ctypes.windll.kernel32
    _UI_FORBIDDEN = 0x1                                  # never show a prompt

    def _call(fn, data):
        buf = ctypes.create_string_buffer(data, len(data))
        inp, out = _Blob(len(data), ctypes.cast(buf, ctypes.POINTER(ctypes.c_char))), _Blob()
        if not fn(ctypes.byref(inp), None, None, None, None, _UI_FORBIDDEN, ctypes.byref(out)):
            raise OSError(ctypes.get_last_error() or "DPAPI call failed")
        try:
            return ctypes.string_at(out.pbData, out.cbData)
        finally:
            _kernel32.LocalFree(out.pbData)

    def _encrypt(data):
        return _call(_crypt32.CryptProtectData, data)

    def _decrypt(data):
        return _call(_crypt32.CryptUnprotectData, data)
else:
    _encrypt = _decrypt = None


def protect(text):
    """Text to keep in settings.json."""
    if text is None:
        return None
    if _encrypt:
        try:
            return _PREFIX_DPAPI + base64.b64encode(_encrypt(text.encode("utf-8"))).decode("ascii")
        except OSError:
            pass
    return _PREFIX_PLAIN + text


def unprotect(value):
    """The text back, or None if it can't be read here (another PC or Windows account, or damaged)."""
    if not isinstance(value, str):
        return None
    if value.startswith(_PREFIX_PLAIN):
        return value[len(_PREFIX_PLAIN):]
    if value.startswith(_PREFIX_DPAPI) and _decrypt:
        try:
            return _decrypt(base64.b64decode(value[len(_PREFIX_DPAPI):])).decode("utf-8")
        except (OSError, ValueError):
            return None
    return None
