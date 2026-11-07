"""Retify relay: keeps every reviewer's answers on the lab machine, so they are not only in one browser.

    python relay/relay.py [settings.json]        (default: relay/relay.local.json next to this file)

The review page (GitHub Pages) calls it through the lab's Cloudflare tunnel, under /api/retify/ only.
Python's standard library is enough to run it; the backup to a private Hugging Face dataset also needs
huggingface_hub, and is skipped (with a note in the log) without it or without a token.

Reviewers come in by name, as the owner chose: the page sends what the reviewer typed, the relay lists
the sessions whose name shares a word with it, and the reviewer enters one or makes a new one. Entering
gives that browser a key; answers are accepted only with a key of their session, so one reviewer's
browser cannot write into another's session by accident. Anyone who types another reviewer's name can
still enter that session; every answer is therefore appended to a log that is never rewritten, with the
time and a salted hash of the caller's IP, so a change can be traced and undone.

Everyone may see everyone's progress (how many cases each session answered), never the answers, so
that reviewers judge each case independently, and never session ids (an id is enough to enter a
session). Names in it are masked, as the owner chose ("Tina" -> "Ti*a", "Sai" -> "S*i"): enough for
the team to recognise each other, not the full name.

Files in data_dir (outside the repository):
  sessions.json                       sessions: id, name, created, hashes of their keys
  log/<set>/<session>.jsonl           every accepted answer, appended
  current/<set>/<session>.json        the latest answer per image (the later "time" wins)
"""

from __future__ import annotations

import hashlib
import hmac
import json
import os
import re
import secrets
import sys
import threading
import time
import unicodedata
import urllib.request
from collections import defaultdict, deque
from datetime import datetime, timezone
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.parse import parse_qs, urlparse

VERSION = 1
HERE = Path(__file__).resolve().parent
PREFIX = "/api/retify"
MAX_BODY = 256 * 1024
MAX_BATCH = 200
MAX_NOTE = 500
MAX_NAME = 80
TIME = re.compile(r"^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d")
SESSION = re.compile(r"^s[0-9a-f]{8}$")

DEFAULTS = {
    "data_url": "",                     # the image data folder (its manifest.json lists the sets and cases)
    "data_dir": "",                     # where the answers are kept, outside the repository
    "host": "127.0.0.1",
    "port": 8096,
    "origins": ["https://retinal-research.github.io"],   # pages that may call the relay; "http://127.0.0.1:*" for tests
    "per_second": 10,                   # requests per IP, averaged over 10 s
    "answers_per_day": 5000,            # per IP
    "sessions_per_day": 50,             # new sessions per IP
    "hf": {"repo": "", "token_env": "RETIFY_HF_TOKEN", "token_file": "", "every_minutes": 5},
}


def now() -> str:
    return datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")


def masked(name: str) -> str:
    """A name with the middle of each word hidden: the first half and the last letter stay. "Tina" -> "Ti*a",
    "Sai" -> "S*i", "Vascullensky" -> "Vascul*****y", "Wang," -> "Wa*g,"."""
    def one(w: str) -> str:
        core = w.rstrip(",.;")
        tail = w[len(core):]
        n = len(core)
        if n <= 1:
            return w
        if n == 2:
            return core[0] + "*" + tail
        keep = n // 2
        return core[:keep] + "*" * (n - keep - 1) + core[-1] + tail
    return " ".join(one(w) for w in name.split())


def words(name: str) -> set[str]:
    """The words of a name, without case, accents or punctuation: "Wang, Yalin" -> {"wang", "yalin"}."""
    plain = unicodedata.normalize("NFKD", name).encode("ascii", "ignore").decode().lower()
    found = {w for w in re.split(r"[^a-z0-9]+", plain) if len(w) >= 2}
    # names in other scripts (Chinese, for one) have no ASCII letters: keep them whole
    return found or {name.strip().lower()} - {""}


class HttpError(Exception):
    def __init__(self, status: int, message: str):
        super().__init__(message)
        self.status = status


class Store:
    """Sessions and answers on disk, behind one lock."""

    def __init__(self, s: dict):
        self.s = s
        self.dir = Path(s["data_dir"]).expanduser()
        self.dir.mkdir(parents=True, exist_ok=True)
        self.lock = threading.Lock()
        self.sessions: dict[str, dict] = {}
        p = self.dir / "sessions.json"
        if p.exists():
            self.sessions = json.loads(p.read_text(encoding="utf-8"))
        salt = self.dir / ".salt"
        if not salt.exists():
            salt.write_text(secrets.token_hex(16))
            os.chmod(salt, 0o600)
        self.salt = salt.read_text().strip()
        self.current: dict[tuple[str, str], dict] = {}
        self.dirty: set[Path] = set()
        self.cases: dict[str, set[str]] = {}
        self.order: dict[str, list[str]] = {}
        self.manifest_at = 0.0

    # ---------------------------------------------------------------- the image sets
    def sets(self) -> dict[str, set[str]]:
        """The cases of each set, from the data folder's manifest (fetched again every hour)."""
        if time.time() - self.manifest_at > 3600 or not self.cases:
            cache = self.dir / "manifest.json"
            try:
                with urllib.request.urlopen(self.s["data_url"].rstrip("/") + "/manifest.json", timeout=20) as r:
                    m = json.loads(r.read())
                cache.write_text(json.dumps(m))
            except Exception as e:  # offline: the last copy will do
                if not cache.exists():
                    raise HttpError(503, f"the image list is not reachable ({e})")
                m = json.loads(cache.read_text())
            self.order = {x["id"]: list(x["cases"]) for x in m.get("sets", [])}
            self.cases = {k: set(v) for k, v in self.order.items()}
            self.manifest_at = time.time()
        return self.cases

    # ---------------------------------------------------------------- sessions
    def _save_sessions(self):
        p = self.dir / "sessions.json"
        tmp = p.with_suffix(".tmp")
        tmp.write_text(json.dumps(self.sessions, indent=1, ensure_ascii=False), encoding="utf-8")
        tmp.replace(p)
        self.dirty.add(p)

    def find(self, name: str) -> list[dict]:
        want = words(name)
        with self.lock:
            hits = [(len(want & set(x["words"])), sid, x) for sid, x in self.sessions.items() if want & set(x["words"])]
            hits.sort(key=lambda h: (-h[0], h[2]["name"].lower()))
            return [{"id": sid, "name": x["name"], "answered": self.answered(sid), "created": x["created"]} for _, sid, x in hits[:10]]

    def _key(self, sid: str) -> str:
        key = secrets.token_hex(16)
        self.sessions[sid]["keys"].append(hashlib.sha256(key.encode()).hexdigest())
        self.sessions[sid]["keys"] = self.sessions[sid]["keys"][-20:]  # the browsers it was entered from lately
        return key

    def create(self, name: str) -> dict:
        name = " ".join(name.split())
        if not name or len(name) > MAX_NAME or not words(name):
            raise HttpError(400, f"a name of 1 to {MAX_NAME} characters")
        with self.lock:
            sid = "s" + secrets.token_hex(4)
            while sid in self.sessions:
                sid = "s" + secrets.token_hex(4)
            self.sessions[sid] = {"name": name, "words": sorted(words(name)), "created": now(), "keys": []}
            key = self._key(sid)
            self._save_sessions()
        return {"id": sid, "name": name, "key": key}

    def enter(self, sid: str) -> dict:
        with self.lock:
            if sid not in self.sessions:
                raise HttpError(404, "no such session")
            key = self._key(sid)
            self._save_sessions()
            return {"id": sid, "name": self.sessions[sid]["name"], "key": key}

    def check(self, sid: str, key: str):
        x = self.sessions.get(sid) if isinstance(sid, str) else None
        h = hashlib.sha256(str(key).encode()).hexdigest()
        if not x or not any(hmac.compare_digest(h, k) for k in x["keys"]):
            raise HttpError(403, "this browser has not entered that session; enter it again by name")

    # ---------------------------------------------------------------- answers
    def _current(self, set_id: str, sid: str) -> dict:
        k = (set_id, sid)
        if k not in self.current:
            p = self.dir / "current" / set_id / f"{sid}.json"
            self.current[k] = json.loads(p.read_text(encoding="utf-8"))["labels"] if p.exists() else {}
        return self.current[k]

    def answered(self, sid: str, set_id: str | None = None) -> int:
        sets = [set_id] if set_id else [p.name for p in (self.dir / "current").glob("*") if p.is_dir()]
        return sum(1 for s in sets for v in self._current(s, sid).values() if v.get("hallucination") is not None)

    def labels(self, set_id: str, sid: str) -> dict:
        with self.lock:
            return dict(self._current(set_id, sid))

    def put(self, set_id: str, sid: str, answers: list[dict], ip: str) -> int:
        cases = self.sets().get(set_id)
        if cases is None:
            raise HttpError(400, f"no image set {set_id!r}")
        clean = []
        for a in answers:
            if not isinstance(a, dict) or a.get("image") not in cases:
                raise HttpError(400, "every answer names an image of the set")
            v, note, t = a.get("hallucination"), a.get("note") or "", a.get("time")
            if v not in (0, 1, None) or isinstance(v, bool):
                raise HttpError(400, "hallucination is 0, 1 or null")
            if not isinstance(note, str) or len(note) > MAX_NOTE:
                raise HttpError(400, f"a note of at most {MAX_NOTE} characters")
            if not isinstance(t, str) or not TIME.match(t):
                raise HttpError(400, "time is an ISO date and time")
            clean.append({"image": a["image"], "hallucination": v, "note": note, "time": t[:19]})
        who = hashlib.sha256((self.salt + ip).encode()).hexdigest()[:16]
        received = now()
        with self.lock:
            cur = self._current(set_id, sid)
            log = self.dir / "log" / set_id / f"{sid}.jsonl"
            log.parent.mkdir(parents=True, exist_ok=True)
            with log.open("a", encoding="utf-8") as f:
                for a in clean:
                    f.write(json.dumps({**a, "received": received, "ip": who}, ensure_ascii=False) + "\n")
                    old = cur.get(a["image"])
                    if not old or a["time"] >= (old.get("time") or ""):
                        cur[a["image"]] = {"hallucination": a["hallucination"], "note": a["note"], "time": a["time"]}
            p = self.dir / "current" / set_id / f"{sid}.json"
            p.parent.mkdir(parents=True, exist_ok=True)
            p.write_text(json.dumps({"set": set_id, "session": sid, "name": self.sessions[sid]["name"], "labels": cur},
                                    indent=1, ensure_ascii=False), encoding="utf-8")
            self.dirty.update({p, log})
        return len(clean)

    def _first(self, set_id: str, sid: str) -> str:
        """When the session first answered in the set: the first line of its log, which is never rewritten."""
        k = ("first", set_id, sid)
        if k not in self.current:
            log = self.dir / "log" / set_id / f"{sid}.jsonl"
            first = ""
            if log.exists():
                with log.open(encoding="utf-8") as f:
                    line = f.readline()
                first = json.loads(line)["received"] if line.strip() else ""
            if not first:
                return ""
            self.current[k] = first
        return self.current[k]

    def progress(self, set_id: str, me: str = "") -> dict:
        """Each reviewer's count with the masked name, in the order they first answered; the caller's marked "you"."""
        cases = self.sets().get(set_id)
        if cases is None:
            raise HttpError(400, f"no image set {set_id!r}")
        with self.lock:
            rows = []
            for sid in self.sessions:
                n = self.answered(sid, set_id)
                if n:  # sessions that never answered (a mistyped name, say) are left out
                    last = max((v.get("time") or "" for v in self._current(set_id, sid).values()), default="")
                    rows.append({"sid": sid, "first": self._first(set_id, sid), "answered": n, "last": last})
        rows.sort(key=lambda r: (r["first"], r["sid"]))
        out = [{"annotator": i + 1, "name": masked(self.sessions[r["sid"]]["name"]), "answered": r["answered"], "last": r["last"],
                **({"you": True} if r["sid"] == me else {})} for i, r in enumerate(rows)]
        return {"set": set_id, "cases": len(cases), "reviewers": out}


class Limiter:
    def __init__(self, s: dict):
        self.s = s
        self.hits: dict[str, deque] = defaultdict(deque)
        self.day = ""
        self.count: dict[tuple[str, str], int] = defaultdict(int)
        self.lock = threading.Lock()

    def take(self, ip: str, what: str = "", n: int = 0, limit: int = 0):
        with self.lock:
            t = time.time()
            q = self.hits[ip]
            while q and q[0] < t - 10:
                q.popleft()
            if len(q) >= self.s["per_second"] * 10:
                raise HttpError(429, "too many requests; wait a few seconds")
            q.append(t)
            if what:
                today = datetime.now(timezone.utc).strftime("%Y-%m-%d")
                if today != self.day:
                    self.day, self.count = today, defaultdict(int)
                if self.count[(ip, what)] + n > limit:
                    raise HttpError(429, f"the daily limit of {what} from this address is reached")
                self.count[(ip, what)] += n


class Backup(threading.Thread):
    """Copies changed files to a private Hugging Face dataset, one commit every few minutes at most."""

    def __init__(self, store: Store, s: dict):
        super().__init__(daemon=True)
        self.store, self.s = store, s["hf"]

    def token(self) -> str:
        if self.s.get("token_env") and os.environ.get(self.s["token_env"]):
            return os.environ[self.s["token_env"]]
        if self.s.get("token_file"):
            return Path(self.s["token_file"]).expanduser().read_text().strip()
        return ""

    def run(self):
        try:
            from huggingface_hub import CommitOperationAdd, HfApi
        except ImportError:
            print("backup off: huggingface_hub is not installed", flush=True)
            return
        api, every = HfApi(), max(1, int(self.s.get("every_minutes", 5))) * 60
        while True:
            time.sleep(every)
            with self.store.lock:
                changed, self.store.dirty = set(self.store.dirty), set()
                public = {sid: {k: v for k, v in x.items() if k != "keys"} for sid, x in self.store.sessions.items()}
            if not changed:
                continue
            try:
                ops = []
                for p in sorted(changed):
                    rel = p.relative_to(self.store.dir).as_posix()
                    if rel == "sessions.json":  # the keys stay on this machine
                        ops.append(CommitOperationAdd(rel, json.dumps(public, indent=1, ensure_ascii=False).encode()))
                    else:
                        ops.append(CommitOperationAdd(rel, p.read_bytes()))
                api.create_commit(self.s["repo"], ops, repo_type="dataset", token=self.token(),
                                  commit_message=f"answers up to {now()}")
                print(f"backup: {len(ops)} files to {self.s['repo']}", flush=True)
            except Exception as e:  # the files here are the record; try again next time
                with self.store.lock:
                    self.store.dirty |= changed
                print(f"backup failed, will retry: {type(e).__name__}: {e}", flush=True)


def make_handler(store: Store, limiter: Limiter, s: dict):
    def allowed(origin: str) -> bool:
        for o in s["origins"]:
            if o.endswith(":*") and re.fullmatch(re.escape(o[:-2]) + r":\d+", origin):
                return True
            if origin == o:
                return True
        return False

    class Handler(BaseHTTPRequestHandler):
        server_version = "retify-relay"

        def log_message(self, *a):
            pass

        def ip(self) -> str:
            host = self.client_address[0]
            # through the Cloudflare tunnel every request comes from this machine; Cloudflare names the visitor
            if host in ("127.0.0.1", "::1") and self.headers.get("CF-Connecting-IP"):
                return self.headers["CF-Connecting-IP"]
            return host

        def send(self, status: int, body: dict):
            data = json.dumps(body, ensure_ascii=False).encode()
            self.send_response(status)
            origin = self.headers.get("Origin", "")
            if origin and allowed(origin):
                self.send_header("Access-Control-Allow-Origin", origin)
                self.send_header("Vary", "Origin")
            self.send_header("Content-Type", "application/json; charset=utf-8")
            self.send_header("Cache-Control", "no-store")
            self.send_header("Content-Length", str(len(data)))
            self.end_headers()
            self.wfile.write(data)

        def body(self) -> dict:
            n = int(self.headers.get("Content-Length") or 0)
            if n > MAX_BODY:
                raise HttpError(413, "the request is too large")
            try:
                v = json.loads(self.rfile.read(n) or b"{}")
            except ValueError:
                raise HttpError(400, "the body is not JSON")
            if not isinstance(v, dict):
                raise HttpError(400, "the body is a JSON object")
            return v

        def handle_one(self, method: str):
            origin = self.headers.get("Origin")
            if origin and not allowed(origin):
                raise HttpError(403, "this page may not use the relay")
            u = urlparse(self.path)
            path, q = u.path, {k: v[0] for k, v in parse_qs(u.query).items()}
            if not path.startswith(PREFIX + "/"):
                raise HttpError(404, "not found")
            path = path[len(PREFIX):]
            ip = self.ip()
            limiter.take(ip)
            if method == "GET" and path == "/status":
                return {"ok": True, "version": VERSION, "sets": sorted(store.sets())}
            if method == "GET" and path == "/progress":
                sid = q.get("session", "")
                if sid:  # only a browser holding that session's key learns which row is its own
                    try:
                        store.check(sid, self.headers.get("X-Retify-Key", ""))
                    except HttpError:
                        sid = ""
                return store.progress(q.get("set", ""), sid)
            if method == "POST" and path == "/sessions/find":
                name = str(self.body().get("name", ""))[:MAX_NAME]
                return {"matches": store.find(name)}
            if method == "POST" and path == "/sessions":
                b = self.body()
                limiter.take(ip, "new sessions", 1, s["sessions_per_day"])
                return store.create(str(b.get("name", "")))
            if method == "POST" and path == "/sessions/enter":
                sid = str(self.body().get("id", ""))
                if not SESSION.match(sid):
                    raise HttpError(400, "a session id")
                return store.enter(sid)
            if method == "GET" and path == "/labels":
                sid = q.get("session", "")
                store.check(sid, self.headers.get("X-Retify-Key", ""))
                if q.get("set") not in store.sets():
                    raise HttpError(400, "no such image set")
                return {"set": q["set"], "labels": store.labels(q["set"], sid)}
            if method == "POST" and path == "/labels":
                b = self.body()
                sid, answers = b.get("session"), b.get("answers")
                store.check(sid, self.headers.get("X-Retify-Key", ""))
                if not isinstance(answers, list) or not 1 <= len(answers) <= MAX_BATCH:
                    raise HttpError(400, f"answers: a list of 1 to {MAX_BATCH}")
                limiter.take(ip, "answers", len(answers), s["answers_per_day"])
                return {"stored": store.put(str(b.get("set", "")), sid, answers, ip), "server_time": now()}
            raise HttpError(404, "not found")

        def run(self, method: str):
            try:
                self.send(200, self.handle_one(method))
            except HttpError as e:
                self.send(e.status, {"error": str(e)})
            except Exception as e:
                print(f"error: {type(e).__name__}: {e}", flush=True)
                self.send(500, {"error": "the relay failed; your answers are still in your browser"})

        def do_GET(self):
            self.run("GET")

        def do_POST(self):
            self.run("POST")

        def do_OPTIONS(self):
            origin = self.headers.get("Origin", "")
            self.send_response(204 if allowed(origin) else 403)
            if allowed(origin):
                self.send_header("Access-Control-Allow-Origin", origin)
                self.send_header("Access-Control-Allow-Methods", "GET, POST")
                self.send_header("Access-Control-Allow-Headers", "Content-Type, X-Retify-Key")
                self.send_header("Access-Control-Max-Age", "600")
                self.send_header("Vary", "Origin")
            self.end_headers()

    return Handler


def settings(path: Path) -> dict:
    s = {**DEFAULTS, **json.loads(path.read_text(encoding="utf-8"))}
    s["hf"] = {**DEFAULTS["hf"], **s.get("hf", {})}
    if not s["data_url"] or not s["data_dir"]:
        sys.exit(f"{path}: data_url and data_dir are required")
    return s


def main() -> int:
    path = Path(sys.argv[1]) if len(sys.argv) > 1 else HERE / "relay.local.json"
    s = settings(path)
    store = Store(s)
    if s["hf"]["repo"]:
        Backup(store, s).start()
    else:
        print("backup off: no hf.repo in the settings", flush=True)
    server = ThreadingHTTPServer((s["host"], s["port"]), make_handler(store, Limiter(s), s))
    print(f"retify relay on http://{s['host']}:{s['port']}{PREFIX}/status, answers in {store.dir}", flush=True)
    server.serve_forever()
    return 0


if __name__ == "__main__":
    sys.exit(main())
