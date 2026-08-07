"""Static test server that mounts the repository at /surriculum/."""

from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.parse import unquote, urlsplit
import sys


REPO_ROOT = Path(__file__).resolve().parent.parent
LEGACY_WORKER = b"""
self.addEventListener('install', event => event.waitUntil(self.skipWaiting()));
self.addEventListener('activate', event => event.waitUntil(self.clients.claim()));
// Intentionally no message handler: this models the worker deployed before
// active-plan CACHE_PLAN_URLS warmup existed.
"""


class PagesHandler(SimpleHTTPRequestHandler):
    def __init__(self, *args, **kwargs):
        super().__init__(*args, directory=str(REPO_ROOT), **kwargs)

    @staticmethod
    def _scoped_parts(path):
        request_path = unquote(urlsplit(path).path)
        if "\\" in request_path or "\0" in request_path:
            return None
        if request_path != "/surriculum" and not request_path.startswith("/surriculum/"):
            return None

        relative_parts = request_path[len("/surriculum") :].split("/")
        if any(part in {".", ".."} or part.startswith(".") for part in relative_parts if part):
            return None
        return [part for part in relative_parts if part]

    def translate_path(self, path):
        parts = self._scoped_parts(path)
        if parts is None:
            return str(REPO_ROOT / "__not_served_outside_surriculum__")

        # Map the already-decoded components ourselves. Passing them to
        # SimpleHTTPRequestHandler.translate_path would decode a second time,
        # allowing paths such as %252egit to become .git after validation.
        repo_root = REPO_ROOT.resolve()
        candidate = repo_root.joinpath(*parts).resolve()
        if candidate != repo_root and repo_root not in candidate.parents:
            return str(repo_root / "__not_served_outside_surriculum__")
        return str(candidate)

    def _serve_legacy_worker(self, include_body):
        if unquote(urlsplit(self.path).path) == "/surriculum/legacy-sw.js":
            self.send_response(200)
            self.send_header("Content-Type", "application/javascript")
            self.send_header("Cache-Control", "no-store")
            self.send_header("Content-Length", str(len(LEGACY_WORKER)))
            self.end_headers()
            if include_body:
                self.wfile.write(LEGACY_WORKER)
            return True
        return False

    def _reject_unscoped_request(self):
        if self._scoped_parts(self.path) is not None:
            return False
        self.send_error(404, "Only /surriculum/ is mounted by this test server")
        return True

    def list_directory(self, path):
        self.send_error(404, "Directory listings are disabled")
        return None

    def do_GET(self):
        if self._reject_unscoped_request() or self._serve_legacy_worker(True):
            return
        super().do_GET()

    def do_HEAD(self):
        if self._reject_unscoped_request() or self._serve_legacy_worker(False):
            return
        super().do_HEAD()


if __name__ == "__main__":
    port = int(sys.argv[1]) if len(sys.argv) > 1 else 8001
    ThreadingHTTPServer(("127.0.0.1", port), PagesHandler).serve_forever()
