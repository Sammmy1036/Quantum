"""Api, part of: Jobs (daily and weekly goals for every role, server: jobs.py) and keeping your session stats and
earnings log with your Quantum account (server: statsync.py).

A mixin of app.py's Api (class Api(... JobsMixin ...)): the methods are the Api's, `self` is the one Api.
Module-level names come from qbase.py.

Jobs: every role (Cargo Hauler, Delivery Courier, Bounty Hunter, Mercenary, Salvager, Miner, Refueler, Trader) has 3
jobs a day, and the week has 5 weekly missions that mix roles (steps from 3 or 4 of them), leaning toward your
preferred role if you mark one. New at 08:00 Pacific (missions on Mondays), with 3 swaps a day. The server
makes them and counts them from the balance changes Quantum writes down (earnings.json, game/session_stats.py).

Stats: earnings.json (balance changes, finished sessions and the one running now) is sent every few minutes while
you're signed in and something changed, and put together with the account's copy, which comes back. So the stats
survive an update or a reinstall and are the same on every PC. Signed out, they stay on this PC as before."""
from qbase import *  # noqa: F401,F403

JOBS_SEND_MAX = 3000            # balance changes sent at most (a busy week)
STATS_EVERY = 5 * 60            # s between syncs while something changed (and once at start)
STATS_ENTRY_KEYS = ("t", "delta", "balance", "label", "kind", "what", "ship", "session", "code", "ctype", "giver", "pos", "src",
                    "sold")


class JobsMixin:
    # ---------------------------------------------------------------- jobs
    def _jobs_call(self, path="mine", body=None):
        tok = self._account_token()
        if not tok:
            return {"ok": False, "status": "signed_out", "error": "Sign in to your Quantum account to get jobs"}
        com = getattr(self, "_community", None)
        if not com:
            return {"ok": False, "error": "The Quantum server is off in Settings"}
        try:
            r = com.jobs(tok, path, body)
        except Exception as e:
            return {"ok": False, "error": f"Couldn't reach the Quantum server ({e})"}
        if r.get("status") == "ok":
            self._jobs_last = r
            return dict(r, ok=True)
        if r.get("status") in ("not_found", "http_404"):
            return {"ok": False, "status": "not_found", "error": "The Quantum server doesn't have jobs yet"}
        return dict(r, ok=False, error=r.get("detail") or r.get("message") or r.get("status") or "Something went wrong")

    def jobs_state(self):
        return self._jobs_call("mine")

    def jobs_badges_show(self, show=True):
        """Show your job badges on your profile, or not (kept with the account on the server)."""
        return self._jobs_call("badges", {"show": bool(show)})

    def jobs_prefer(self, role=None):
        """Mark a preferred role for the weekly missions ("" / None: none). Missions not started yet are made again."""
        return self._jobs_call("prefer", {"role": str(role or "")[:24]})

    def jobs_reroll(self, jid):
        return self._jobs_call("reroll", {"id": str(jid or "")[:24]})

    def jobs_log_mark(self):
        """A cheap check the page makes every few seconds: how many balance rises the session log has, and the last
        one's time. When it changes, a job may have moved, so the page syncs (the pinned jobs on Home, Jobs)."""
        sess = getattr(self, "_sess", None)
        log = list(getattr(sess, "log", None) or []) if sess else []
        ups = [e for e in log if (e.get("delta") or 0) > 0]
        return {"ok": True, "n": len(ups), "t": (ups[-1].get("t") or 0) if ups else 0}

    def jobs_sync(self):
        """Send this week's balance changes; every role's jobs come back with their progress."""
        last = getattr(self, "_jobs_last", None) or self._jobs_call("mine")
        if not last or not (last.get("ok") or last.get("status") == "ok"):
            return last
        since = (last.get("weekly_from") or 0) - 60
        sess = getattr(self, "_sess", None)
        log = list(getattr(sess, "log", None) or []) if sess else []
        ents = [{k: e[k] for k in ("t", "delta", "kind", "label", "what", "ship", "code", "ctype", "giver", "pos", "src", "session",
                                   "sold")
                if k in e}
                for e in log if (e.get("t") or 0) >= since and (e.get("delta") or 0) > 0][-JOBS_SEND_MAX:]
        for e in ents:
            if e.get("label"):
                e["label"] = e["label"][:80]
        return self._jobs_call("progress", {"entries": ents})

    # ---------------------------------------------------------------- stats kept with the account
    def _stats_sync_loop(self):
        time.sleep(20)                                   # after start-up (and after the account sign-in check)
        while True:
            try:
                sess = getattr(self, "_sess", None)
                due = sess and (sess.dirty or not getattr(self, "_stats_synced", 0))
                if due and self._account_token():
                    self.stats_sync()
            except Exception:
                watcher_mod.log_error("stats sync")
            time.sleep(STATS_EVERY)

    def stats_sync(self):
        """Put this PC's session stats and earnings log together with the account's. {ok, entries, sessions, at}."""
        sess, tok, com = getattr(self, "_sess", None), self._account_token(), getattr(self, "_community", None)
        if not sess:
            return {"ok": False, "error": "Game telemetry isn't running"}
        if not tok or not com:
            return {"ok": False, "status": "signed_out", "error": "Sign in to your Quantum account to keep your stats with it"}
        snap = sess.snapshot()
        snap["entries"] = [{k: e[k] for k in STATS_ENTRY_KEYS if k in e} for e in snap["entries"]]
        sess.dirty = False
        try:
            r = com.stats(tok, "sync", snap)
        except Exception as e:
            sess.dirty = True
            return {"ok": False, "error": f"Couldn't reach the Quantum server ({e})"}
        if r.get("status") != "ok":
            sess.dirty = True
            if r.get("status") in ("not_found", "http_404"):
                return {"ok": False, "status": "not_found", "error": "The Quantum server doesn't keep stats yet"}
            return {"ok": False, "error": r.get("detail") or r.get("status") or "Couldn't sync"}
        sess.merge(r.get("entries"), r.get("sessions"))
        self._stats_synced = int(time.time())
        return {"ok": True, "at": self._stats_synced, "entries": len(sess.log), "sessions": len(sess.history)}

    def stats_status(self):
        return {"ok": True, "synced_at": getattr(self, "_stats_synced", 0) or None, "signed_in": bool(self._account_token())}
