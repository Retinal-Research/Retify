"""Serve the page and a data folder from one origin, for local tests.

    python tests/serve.py <data folder> [--port 8811]

The page is web/ at /, the data folder at /data/; open http://127.0.0.1:8811/?data=/data/
"""
import argparse
import functools
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path

WEB = Path(__file__).resolve().parents[1] / "web"


class Handler(SimpleHTTPRequestHandler):
    data = Path(".")

    def log_message(self, *a):
        pass

    def translate_path(self, path):
        path = path.split("?", 1)[0].split("#", 1)[0]
        if path.startswith("/data/"):
            return str(self.data / path[len("/data/"):])
        return super().translate_path(path)


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("data", type=Path)
    ap.add_argument("--port", type=int, default=8811)
    a = ap.parse_args()
    Handler.data = a.data.resolve()
    print(f"http://127.0.0.1:{a.port}/?data=/data/", flush=True)
    ThreadingHTTPServer(("127.0.0.1", a.port), functools.partial(Handler, directory=str(WEB))).serve_forever()


if __name__ == "__main__":
    main()
