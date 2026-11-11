"""Api, part of: Quantum's own updates.

A mixin of app.py's Api (class Api(... UpdatesMixin ...)): the methods are the Api's, `self` is the one Api.
Module-level names come from qbase.py."""
from qbase import *  # noqa: F401,F403


class UpdatesMixin:
    # ------------------------------------------------------------ updates
    def _check_update(self, delay=6):
        time.sleep(delay)                          # after start-up, so the window isn't kept waiting
        self._update = self._updater.check()

    def update_status(self, recheck=False):
        if recheck:
            self._update = self._updater.check()
        return {"current": updater.VERSION, "latest": self._update, "progress": self._updater.progress(),
                "skipped": self._settings.get("skip_update"), "just_updated": "--updated" in sys.argv,
                "build": clientid.build_id()}

    def update_download(self):
        return self._updater.download()

    def update_install(self):
        """Swap in the downloaded, verified version and restart into it."""
        r = self._updater.install_and_restart()
        if r.get("ok"):
            def close():
                time.sleep(0.4)
                try:
                    self.shutdown()
                finally:
                    os._exit(0)
            threading.Thread(target=close, daemon=True).start()
        return r

    def update_skip(self, version):
        self._settings["skip_update"] = version
        self._save_settings()
        return {"ok": True}

    def dr_ack(self):
        """The user has read the warning that reports are tied to their UEX account."""
        self._dr_cfg()["ack"] = int(time.time())
        self._save_settings()
        return {"ok": True}

    def dr_open_folder(self):
        self._dr.test_dir.mkdir(parents=True, exist_ok=True)
        if os.name == "nt":
            os.startfile(self._dr.test_dir)
        return {"ok": True, "folder": str(self._dr.test_dir)}
