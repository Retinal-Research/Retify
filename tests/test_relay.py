"""Unit tests of the relay: sessions by name, keys, validation, later-time-wins, the append-only log,
progress without answers, CORS, and the backup with a fake uploader.

    python tests/test_relay.py
"""
import json
import sys
import tempfile
import threading
import time
import types
import unittest
import urllib.error
import urllib.request
from http.server import ThreadingHTTPServer
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "relay"))
import relay  # noqa: E402

PAGE = "https://retinal-research.github.io"


class RelayTest(unittest.TestCase):
    def setUp(self):
        self.tmp = Path(tempfile.mkdtemp())
        data = self.tmp / "data"
        data.mkdir()
        (data / "manifest.json").write_text(json.dumps({"sets": [{"id": "s1", "dir": "a/", "cases": ["1_left.jpg", "2_right.jpg", "3_left.jpg"]}]}))
        self.s = {**relay.DEFAULTS, "data_url": data.as_uri() + "/", "data_dir": str(self.tmp / "answers"),
                  "origins": [PAGE, "http://127.0.0.1:*"], "port": 0, "sessions_per_day": 3}
        self.store = relay.Store(self.s)
        self.server = ThreadingHTTPServer(("127.0.0.1", 0), relay.make_handler(self.store, relay.Limiter(self.s), self.s))
        threading.Thread(target=self.server.serve_forever, daemon=True).start()
        self.base = f"http://127.0.0.1:{self.server.server_address[1]}/api/retify"

    def tearDown(self):
        self.server.shutdown()
        self.server.server_close()

    def call(self, method, path, body=None, key="", origin=PAGE):
        req = urllib.request.Request(self.base + path, method=method, data=None if body is None else json.dumps(body).encode(),
                                     headers={"Content-Type": "application/json", "Origin": origin, "X-Retify-Key": key})
        try:
            with urllib.request.urlopen(req) as r:
                return r.status, json.loads(r.read()), r.headers
        except urllib.error.HTTPError as e:
            return e.code, json.loads(e.read() or b"{}"), e.headers

    def answer(self, image, v, t="2026-11-07T10:00:00", note=""):
        return {"image": image, "hallucination": v, "note": note, "time": t}

    def test_sessions_by_name(self):
        st, a, _ = self.call("POST", "/sessions", {"name": "Wang, Yalin"})
        self.assertEqual(st, 200)
        self.assertTrue(relay.SESSION.match(a["id"]) and len(a["key"]) == 32)
        for typed in ("wang", "YALIN", "Yalin Wang", "wáng"):
            st, f, _ = self.call("POST", "/sessions/find", {"name": typed})
            self.assertEqual([m["id"] for m in f["matches"]], [a["id"]], typed)
        _, f, _ = self.call("POST", "/sessions/find", {"name": "Smith"})
        self.assertEqual(f["matches"], [])
        # entering again gives another key; both work
        _, b, _ = self.call("POST", "/sessions/enter", {"id": a["id"]})
        for k in (a["key"], b["key"]):
            self.assertEqual(self.call("GET", f"/labels?set=s1&session={a['id']}", key=k)[0], 200)
        # the keys never leave the machine in clear
        self.assertNotIn(a["key"], (self.tmp / "answers" / "sessions.json").read_text())

    def test_keys_separate_sessions(self):
        _, a, _ = self.call("POST", "/sessions", {"name": "Reviewer One"})
        _, b, _ = self.call("POST", "/sessions", {"name": "Reviewer Two"})
        st, _, _ = self.call("POST", "/labels", {"set": "s1", "session": a["id"], "answers": [self.answer("1_left.jpg", 1)]}, key=b["key"])
        self.assertEqual(st, 403)
        st, r, _ = self.call("POST", "/labels", {"set": "s1", "session": a["id"], "answers": [self.answer("1_left.jpg", 1)]}, key=a["key"])
        self.assertEqual((st, r["stored"]), (200, 1))

    def test_validation(self):
        _, a, _ = self.call("POST", "/sessions", {"name": "Val Idator"})
        bad = [
            {"set": "nope", "answers": [self.answer("1_left.jpg", 0)]},
            {"set": "s1", "answers": [self.answer("9_left.jpg", 0)]},
            {"set": "s1", "answers": [self.answer("1_left.jpg", 2)]},
            {"set": "s1", "answers": [self.answer("1_left.jpg", True)]},
            {"set": "s1", "answers": [self.answer("1_left.jpg", 0, note="x" * 501)]},
            {"set": "s1", "answers": [self.answer("1_left.jpg", 0, t="yesterday")]},
            {"set": "s1", "answers": []},
            {"set": "s1", "answers": [self.answer("1_left.jpg", 0), self.answer("9_left.jpg", 0)]},  # one bad item rejects the batch
        ]
        for b in bad:
            st, _, _ = self.call("POST", "/labels", {**b, "session": a["id"]}, key=a["key"])
            self.assertEqual(st, 400, b)
        self.assertEqual(self.store.labels("s1", a["id"]), {})
        big = {"set": "s1", "session": a["id"], "answers": [self.answer("1_left.jpg", 0, note="x" * 400)] * 700}
        self.assertEqual(self.call("POST", "/labels", big, key=a["key"])[0], 413)
        self.assertEqual(self.call("POST", "/sessions", {"name": "   "})[0], 400)

    def test_later_time_wins_and_log_is_kept(self):
        _, a, _ = self.call("POST", "/sessions", {"name": "Time Keeper"})
        post = lambda *ans: self.call("POST", "/labels", {"set": "s1", "session": a["id"], "answers": list(ans)}, key=a["key"])
        post(self.answer("1_left.jpg", 1, "2026-11-07T10:00:05"))
        post(self.answer("1_left.jpg", 0, "2026-11-07T10:00:01"))  # an older answer arriving late
        post(self.answer("2_right.jpg", 0, "2026-11-07T10:00:02"), self.answer("2_right.jpg", 1, "2026-11-07T10:00:09"))
        _, got, _ = self.call("GET", f"/labels?set=s1&session={a['id']}", key=a["key"])
        self.assertEqual(got["labels"]["1_left.jpg"]["hallucination"], 1)
        self.assertEqual(got["labels"]["2_right.jpg"]["hallucination"], 1)
        log = (self.tmp / "answers" / "log" / "s1" / f"{a['id']}.jsonl").read_text().splitlines()
        self.assertEqual(len(log), 4)
        self.assertTrue(all(len(json.loads(x)["ip"]) == 16 and "127.0.0.1" not in x for x in log))
        # a new store reads the same answers back from disk
        self.assertEqual(relay.Store(self.s).labels("s1", a["id"]), got["labels"])

    def test_progress_shows_counts_not_answers(self):
        _, a, _ = self.call("POST", "/sessions", {"name": "Alpha Reviewer"})
        self.call("POST", "/sessions", {"name": "Typo Nobody"})  # never answers: not listed
        self.call("POST", "/labels", {"set": "s1", "session": a["id"], "answers": [self.answer("1_left.jpg", 1), self.answer("3_left.jpg", 0)]}, key=a["key"])
        st, p, _ = self.call("GET", "/progress?set=s1")
        self.assertEqual(st, 200)
        self.assertEqual(p["cases"], 3)
        self.assertEqual([(r["name"], r["answered"]) for r in p["reviewers"]], [("Alpha Reviewer", 2)])
        self.assertNotIn("hallucination", json.dumps(p))

    def test_cors_and_limits(self):
        st, _, h = self.call("GET", "/status")
        self.assertEqual((st, h["Access-Control-Allow-Origin"]), (200, PAGE))
        self.assertEqual(self.call("GET", "/status", origin="https://evil.example")[0], 403)
        self.assertEqual(self.call("GET", "/status", origin="http://127.0.0.1:8811")[0], 200)
        req = urllib.request.Request(self.base + "/labels", method="OPTIONS", headers={"Origin": PAGE, "Access-Control-Request-Method": "POST"})
        with urllib.request.urlopen(req) as r:
            self.assertIn("X-Retify-Key", r.headers["Access-Control-Allow-Headers"])
        codes = [self.call("POST", "/sessions", {"name": f"Many Names{i}"})[0] for i in range(5)]
        self.assertEqual(codes, [200, 200, 200, 429, 429])  # sessions_per_day = 3

    def test_backup_batches_and_hides_keys(self):
        _, a, _ = self.call("POST", "/sessions", {"name": "Backup Person"})
        self.call("POST", "/labels", {"set": "s1", "session": a["id"], "answers": [self.answer("1_left.jpg", 0)]}, key=a["key"])
        commits = []

        class FakeApi:
            def create_commit(self, repo, ops, **kw):
                commits.append({o.path_in_repo: o.data for o in ops})

        class Op:
            def __init__(self, path, data):
                self.path_in_repo, self.data = path, data

        sys.modules["huggingface_hub"] = types.SimpleNamespace(HfApi=FakeApi, CommitOperationAdd=Op)
        relay.time.sleep, real_sleep = (lambda s: real_sleep(0.05)), relay.time.sleep
        try:
            b = relay.Backup(self.store, {**self.s, "hf": {**self.s["hf"], "repo": "x/y", "every_minutes": 1}})
            b.start()
            real_sleep(0.5)
        finally:
            relay.time.sleep = real_sleep
        self.assertEqual(len(commits), 1)  # one commit for all changes, none while nothing changed
        files = commits[0]
        self.assertEqual(sorted(files), ["current/s1/%s.json" % a["id"], "log/s1/%s.jsonl" % a["id"], "sessions.json"])
        self.assertNotIn("keys", json.loads(files["sessions.json"])[a["id"]])


if __name__ == "__main__":
    unittest.main(verbosity=1)
