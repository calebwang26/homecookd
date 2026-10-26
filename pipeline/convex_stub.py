"""A stand-in for Convex's /worker/* routes, for testing the worker before (or without) a deployment.

    python pipeline/convex_stub.py --upload oatmeal-5372a0/00.mov [--upload ...] [--port 8787]
    CONVEX_SITE_URL=http://127.0.0.1:8787 python pipeline/worker.py --once

Each --upload queues one job (uploadPath = an object or folder in the GCS uploads bucket). The stub checks
x-worker-secret against WORKER_SECRET from .env, the bodies against the shapes in convex/http.ts, prints
every stage with the time since the claim, and saves each published body in data/out/convex-stub/.
"""
from __future__ import annotations

import argparse
import json
import os
import time
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path

from dotenv import load_dotenv

ROOT = Path(__file__).resolve().parent.parent
SAVED = ROOT / "data" / "out" / "convex-stub"
STAGES = {"preparing", "understanding", "writing", "indexing", "done", "failed"}


def serve(uploads: list[str], cook: str, port: int, language: str = "en") -> None:
    load_dotenv(ROOT / ".env")
    secret = os.environ.get("WORKER_SECRET") or ""
    jobs = [{"jobId": f"stubjob{i}", "recipeId": f"stubrecipe{i}", "familyId": "stubfamily",
             "supabaseFamilyId": "", "cookId": "stubcook", "cookName": cook, "uploadPath": path,
             "source": "phone", "language": language, "homieLog": [], "stage": "queued", "claimedAt": None}
            for i, path in enumerate(uploads, 1)]
    by_id = {j["jobId"]: j for j in jobs}

    class Handler(BaseHTTPRequestHandler):
        def send(self, status: int, body: dict | None = None) -> None:
            data = json.dumps(body).encode() if body is not None else b""
            self.send_response(status)
            if body is not None:
                self.send_header("Content-Type", "application/json")
            self.send_header("Content-Length", str(len(data)))
            self.end_headers()
            self.wfile.write(data)

        def do_POST(self) -> None:  # noqa: N802 - http.server's name
            if not secret or self.headers.get("x-worker-secret") != secret:
                return self.send(401, {"error": "wrong secret"})
            body = json.loads(self.rfile.read(int(self.headers.get("Content-Length") or 0)) or b"{}")
            if self.path == "/worker/claim":
                job = next((j for j in jobs if j["stage"] == "queued"), None)
                if job is None:
                    return self.send(204)
                job.update(stage="preparing", claimedAt=time.monotonic())
                print(f"[stub] claimed {job['jobId']} ({job['uploadPath']})", flush=True)
                return self.send(200, {k: v for k, v in job.items() if k not in ("stage", "claimedAt")})
            if self.path == "/worker/deletions/next":  # no deleted accounts to purge here
                return self.send(204)
            job = by_id.get(body.get("jobId"))
            if job is None:
                return self.send(404, {"error": "no such job"})
            since = f"{(time.monotonic() - (job['claimedAt'] or time.monotonic())) / 60:5.1f} min"
            if self.path == "/worker/progress":
                if body.get("stage") not in STAGES or not 0 <= body.get("progress", -1) <= 1:
                    return self.send(400, {"error": "bad stage or progress"})
                job["stage"] = body["stage"]
                print(f"[stub] {since}  {job['jobId']} {body['stage']:<13} {body['progress']:.0%}"
                      + (f"  error: {body['error']}" if body.get("error") else ""), flush=True)
                return self.send(200, {"ok": True})
            if self.path == "/worker/release":  # Convex waits 30 s; the stub queues it again at once
                job.update(stage="queued", claimedAt=None)
                print(f"[stub] {since}  {job['jobId']} released: upload not complete", flush=True)
                return self.send(200, {"ok": True})
            if self.path == "/worker/published":
                recipe = body.get("recipe") or {}
                if not recipe.get("title") or not recipe.get("steps"):
                    return self.send(400, {"error": "recipe needs a title and steps"})
                SAVED.mkdir(parents=True, exist_ok=True)
                (SAVED / f"{job['jobId']}.json").write_text(json.dumps(body, indent=2, ensure_ascii=False))
                job["stage"] = "done"
                print(f"[stub] {since}  {job['jobId']} published {recipe['title']!r}: {len(recipe['steps'])} steps, "
                      f"{len(recipe.get('stories', []))} stories, {len(recipe.get('special', []))} specials; "
                      f"{body.get('recipeJsonUrl')}", flush=True)
                return self.send(200, {"recipeId": job["recipeId"]})
            return self.send(404, {"error": "no such route"})

        def log_message(self, *args) -> None:  # quiet: the prints above say what matters
            pass

    print(f"[stub] {len(jobs)} job(s) queued; listening on http://127.0.0.1:{port}", flush=True)
    ThreadingHTTPServer(("127.0.0.1", port), Handler).serve_forever()


def main() -> None:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--upload", action="append", default=[], help="uploadPath to queue (repeatable)")
    ap.add_argument("--cook", default="Mom")
    ap.add_argument("--port", type=int, default=8787)
    ap.add_argument("--language", default="en", help="the jobs' language (ISO 639-1, e.g. mr)")
    args = ap.parse_args()
    serve(args.upload, args.cook, args.port, args.language)


if __name__ == "__main__":
    main()
