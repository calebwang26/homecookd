"""A stand-in for Convex's /glasses/* routes, to test server.py without a deployment.

    GLASSES_SECRET=… python convex_stub.py [--port 8791] [--recording stubrec1] [--status recording]

It holds one glasses recording. POST /_status {"status": "ended"} changes it (what the phone would do);
GET /_finished lists the /glasses/finished bodies it got.
"""
from __future__ import annotations

import argparse
import json
import os
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

LIVE = {"intro", "recording", "wrapping_up"}


def serve(port: int, recording: str, status: str) -> None:
    secret = os.environ.get("GLASSES_SECRET", "")
    state = {"status": status, "finished": []}

    class Handler(BaseHTTPRequestHandler):
        def reply(self, code: int, body: object | None = None) -> None:
            raw = json.dumps(body).encode() if body is not None else b""
            self.send_response(code)
            self.send_header("Content-Type", "application/json")
            self.send_header("Content-Length", str(len(raw)))
            self.end_headers()
            self.wfile.write(raw)

        def do_GET(self) -> None:
            self.reply(200, state["finished"]) if self.path == "/_finished" else self.reply(404, {"error": "no"})

        def do_POST(self) -> None:
            body = json.loads(self.rfile.read(int(self.headers.get("Content-Length") or 0)) or b"{}")
            if self.path == "/_status":
                state["status"] = body["status"]
                print(f"stub: recording is now {state['status']}", flush=True)
                return self.reply(200, {"ok": True})
            if self.headers.get("x-glasses-secret") != secret:
                return self.reply(401, {"error": "wrong secret"})
            row = {"recordingId": recording, "status": state["status"], "startedAt": 1}
            if self.path == "/glasses/active":
                if "recordingId" in body:
                    return self.reply(200, row) if body["recordingId"] == recording else self.reply(404, {"error": "no"})
                return self.reply(200, row) if state["status"] in LIVE else self.reply(204)
            if self.path == "/glasses/finished":
                ok = (body.get("recordingId") == recording and body.get("uploadPath") == f"glasses-{recording}/"
                      and isinstance(body.get("videoStartedAt"), int) and body.get("durationS", 0) > 0)
                if not ok:
                    return self.reply(400, {"error": f"bad body {body}"})
                state["finished"].append(body)
                print(f"stub: finished {body}", flush=True)
                return self.reply(200, {"jobId": "stubjob1", "recipeId": "stubrecipe1"})
            self.reply(404, {"error": "no such route"})

        def log_message(self, *_: object) -> None:
            pass

    print(f"stub on :{port}, recording {recording} is {status}", flush=True)
    ThreadingHTTPServer(("127.0.0.1", port), Handler).serve_forever()


if __name__ == "__main__":
    p = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    p.add_argument("--port", type=int, default=8791)
    p.add_argument("--recording", default="stubrec1")
    p.add_argument("--status", default="recording")
    a = p.parse_args()
    serve(a.port, a.recording, a.status)
