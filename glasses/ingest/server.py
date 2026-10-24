"""The glasses ingest server (glasses/INGEST.md). One port (8090) serves:

    WS  /ingest?device=<GLASSES_DEVICE_KEY>   the glasses stream JPEG frames + PCM here
    GET /frame/latest?recording=<id>          newest JPEG for homie (x-glasses-secret)
    GET /health

Every 2 s it asks Convex which glasses recording is live. While that one is "recording" or "wrapping_up" it
saves what the glasses send (store.py); once it's "ended" (or 60 s go by with no data while wrapping up) it
makes the MP4 (mux.py), uploads it to gs://<GCS_UPLOAD_BUCKET>/glasses-<id>/01.mp4 and calls /glasses/finished.

    GLASSES_SECRET=… GLASSES_DEVICE_KEY=… CONVEX_SITE_URL=… GCS_UPLOAD_BUCKET=… python server.py [--dry-upload]
"""
from __future__ import annotations

import argparse
import asyncio
import hmac
import json
import logging
import os
import time
from dataclasses import dataclass
from http import HTTPStatus
from pathlib import Path
from urllib.parse import parse_qs, urlparse

from websockets.asyncio.server import ServerConnection, serve
from websockets.datastructures import Headers
from websockets.exceptions import ConnectionClosed
from websockets.http11 import Request, Response

import cloud
import mux
from store import Recording

log = logging.getLogger("glasses")
CAPTURING = {"recording", "wrapping_up"}
HEADER = 13
POLL_S = 2
QUIET_S = 60  # wrapping up with no data this long: the glasses died or walked off; finish without them
RETRY_S = 30
FRESH_S = 30  # /frame/latest serves nothing older than this


@dataclass
class Config:
    secret: str
    device_key: str
    convex_url: str
    bucket: str
    root: Path
    port: int
    dry_upload: bool


class Ingest:
    def __init__(self, cfg: Config):
        self.cfg = cfg
        self.glasses: set[ServerConnection] = set()
        self.active: dict | None = None  # what Convex last said
        self.current: Recording | None = None
        self.last_data = 0.0  # monotonic time current last got something
        self.latest: tuple[float, bytes] | None = None  # (monotonic, jpeg), for homie
        self.offset_ms: float | None = None  # wall-clock ms minus device ms
        self.last_dev_us = 0
        self.todo: set[str] = set()  # stopped, not yet turned into a job
        self.orphans: set[str] = set()  # half-recorded when the service last stopped
        self.busy: set[str] = set()
        self.retry_at: dict[str, float] = {}
        cfg.root.mkdir(parents=True, exist_ok=True)
        for d in cfg.root.iterdir():
            meta = _meta(d)
            if meta is None or "finished" in meta or "abandoned" in meta or "failed" in meta:
                continue
            (self.todo if "stopped" in meta else self.orphans).add(d.name)

    # ---- Convex ----

    async def convex(self, path: str, body: dict) -> tuple[int, dict | None]:
        return await asyncio.to_thread(cloud.convex_post, self.cfg.convex_url, self.cfg.secret, path, body)

    async def status_of(self, rid: str) -> str:
        code, body = await self.convex("/glasses/active", {"recordingId": rid})
        if code == 404:
            return "abandoned"  # the row is gone
        if code != 200 or not body:
            raise RuntimeError(f"/glasses/active answered {code}")
        return body["status"]

    async def poll(self) -> None:
        while True:
            try:
                await self.tick()
            except Exception as e:  # Convex down or Wi-Fi blip: keep recording, try again
                log.warning("poll: %s", e)
            await asyncio.sleep(POLL_S)

    async def tick(self) -> None:
        code, body = await self.convex("/glasses/active", {})
        if code not in (200, 204):
            raise RuntimeError(f"/glasses/active answered {code}: {body}")
        a = self.active = body if code == 200 else None

        if self.current:
            rid = self.current.id
            status = a["status"] if a and a["recordingId"] == rid else await self.status_of(rid)
            quiet = time.monotonic() - self.last_data > QUIET_S
            if status == "ended" or (status == "wrapping_up" and quiet):
                await self.stop(upload=True, why=status if status == "ended" else "no data for 60 s")
            elif status == "abandoned":
                await self.stop(upload=False, why="abandoned")

        if not self.current and a and a["status"] in CAPTURING and not _stopped(self.cfg.root / a["recordingId"]):
            await self.start(a["recordingId"])

        for rid in list(self.orphans - {self.current.id if self.current else ""}):
            status = await self.status_of(rid)
            if status in CAPTURING and a and a["recordingId"] == rid:
                continue  # it'll be resumed as current
            self.orphans.discard(rid)
            rec = Recording(self.cfg.root, rid)
            rec.close()
            if status == "abandoned":
                rec.mark("abandoned")
            else:
                rec.mark("stopped")
                self.todo.add(rid)
            log.info("%s: left over from before a restart, now %s", rid, status)

        for rid in list(self.todo - self.busy):
            if time.monotonic() >= self.retry_at.get(rid, 0):
                self.busy.add(rid)
                asyncio.create_task(self.finish(rid))

    # ---- one recording ----

    async def start(self, rid: str) -> None:
        self.current = Recording(self.cfg.root, rid)
        self.orphans.discard(rid)
        self.last_data = time.monotonic()
        resumed = f" (resuming at frame {self.current.frames})" if self.current.frames else ""
        log.info("%s: recording%s", rid, resumed)
        await self.tell({"type": "recording", "recordingId": rid})

    async def stop(self, upload: bool, why: str) -> None:
        rec, self.current = self.current, None
        assert rec
        rec.close()
        rec.mark("stopped" if upload else "abandoned")
        log.info("%s: stopped (%s) after %d frames, %.1f s of audio", rec.id, why, rec.frames,
                 rec.audio_bytes / 32_000)
        await self.tell({"type": "stopped"})
        if upload:
            self.todo.add(rec.id)

    async def finish(self, rid: str) -> None:
        """Mux, upload, create the job. Each step leaves a mark in meta.json, so a retry skips what's done."""
        rec = Recording(self.cfg.root, rid)
        rec.close()
        try:
            if not rec.marked("muxed"):
                t0 = time.monotonic()
                mp4, started, duration = await mux.mux(rec.dir, rec.meta)
                rec.mark("muxed", videoStartedAt=started, durationS=duration)
                log.info("%s: made %s (%.1f s of video, %.1f MB) in %.0f s", rid, mp4.name, duration,
                         mp4.stat().st_size / 1e6, time.monotonic() - t0)
            muxed = rec.marked("muxed")
            name = f"glasses-{rid}/01.mp4"
            if not rec.marked("uploaded"):
                if self.cfg.dry_upload:
                    log.info("%s: dry upload; would put %s at gs://%s/%s", rid, rec.dir / "out.mp4",
                             self.cfg.bucket or "<GCS_UPLOAD_BUCKET>", name)
                else:
                    result = await asyncio.to_thread(cloud.upload, self.cfg.bucket, name, rec.dir / "out.mp4")
                    log.info("%s: %s gs://%s/%s", rid, result, self.cfg.bucket, name)
                rec.mark("uploaded")
            body = {"recordingId": rid, "uploadPath": f"glasses-{rid}/", **muxed}
            code, res = await self.convex("/glasses/finished", body)
            if code == 200 and res:
                rec.mark("finished", **res)
                self.todo.discard(rid)
                log.info("%s: job %s queued", rid, res["jobId"])
            elif code in (400, 404):
                rec.mark("failed", error=str((res or {}).get("error")))
                self.todo.discard(rid)
                log.error("%s: Convex refused the job (%d): %s", rid, code, (res or {}).get("error"))
            else:
                raise RuntimeError(f"/glasses/finished answered {code}")
        except Exception as e:
            self.retry_at[rid] = time.monotonic() + RETRY_S
            log.error("%s: finishing failed, retrying in %d s: %s", rid, RETRY_S, e)
        finally:
            self.busy.discard(rid)

    # ---- the glasses ----

    async def tell(self, msg: dict) -> None:
        text = json.dumps(msg)
        for ws in list(self.glasses):
            try:
                await ws.send(text)
            except ConnectionClosed:
                pass

    async def handle(self, ws: ServerConnection) -> None:
        self.glasses.add(ws)
        log.info("glasses connected (%d now)", len(self.glasses))
        try:
            await ws.send(json.dumps({"type": "ready"}))
            if self.current:
                await ws.send(json.dumps({"type": "recording", "recordingId": self.current.id}))
            async for msg in ws:
                if isinstance(msg, str):
                    self.on_text(msg)
                else:
                    self.on_binary(msg)
        except ConnectionClosed:
            pass
        finally:
            self.glasses.discard(ws)
            log.info("glasses disconnected (%d left)", len(self.glasses))

    def on_text(self, msg: str) -> None:
        try:
            hello = json.loads(msg)
        except ValueError:
            return
        if isinstance(hello, dict) and hello.get("type") == "hello":
            log.info("hello: fw %s, %sx%s at %s fps", hello.get("fw"), hello.get("w"), hello.get("h"), hello.get("fps"))

    def wall_ms(self, dev_us: int) -> int:
        """Device time to wall clock, fixed from the first message, so reconnects keep the same mapping.
        Device time going backwards means the glasses rebooted: map again."""
        if self.offset_ms is None or dev_us < self.last_dev_us - 1_000_000:
            self.offset_ms = time.time() * 1000 - dev_us / 1000
            self.last_dev_us = dev_us
        self.last_dev_us = max(self.last_dev_us, dev_us)
        return int(self.offset_ms + dev_us / 1000)

    def on_binary(self, msg: bytes) -> None:
        at = 0
        while len(msg) - at >= HEADER:  # one record per message by contract; more are fine too
            kind = msg[at]
            dev_us = int.from_bytes(msg[at + 1:at + 9], "little")
            length = int.from_bytes(msg[at + 9:at + 13], "little")
            payload = msg[at + HEADER:at + HEADER + length]
            at += HEADER + length
            if len(payload) != length:
                log.warning("dropped a short message (%d of %d bytes)", len(payload), length)
                return
            wall = self.wall_ms(dev_us)
            if kind == 1 and payload[:2] == b"\xff\xd8":
                self.latest = (time.monotonic(), payload)
                if self.current and self.current.add_frame(wall, payload):
                    self.last_data = time.monotonic()
            elif kind == 2 and self.current:
                self.current.add_audio(wall, payload)
                self.last_data = time.monotonic()

    # ---- HTTP on the same port ----

    def process_request(self, connection: ServerConnection, request: Request) -> Response | None:
        url = urlparse(request.path)
        q = parse_qs(url.query)
        if url.path == "/ingest":
            if not _same((q.get("device") or [""])[0], self.cfg.device_key):
                log.warning("refused glasses with the wrong device key")
                return connection.respond(HTTPStatus.UNAUTHORIZED, "wrong device key\n")
            return None
        if url.path == "/health":
            cur = self.current
            return _json({
                "ok": True,
                "glasses": len(self.glasses),
                "recording": cur.id if cur else None,
                "frames": cur.frames if cur else 0,
                "lastFrameAgeS": round(time.monotonic() - self.latest[0], 1) if self.latest else None,
                "waiting": sorted(self.todo),
            })
        if url.path == "/frame/latest":
            if not _same(request.headers.get("x-glasses-secret", ""), self.cfg.secret):
                return connection.respond(HTTPStatus.UNAUTHORIZED, "wrong secret\n")
            rid = (q.get("recording") or [""])[0]
            live = {self.current.id if self.current else None, self.active and self.active["recordingId"]}
            if rid not in live or not self.latest or time.monotonic() - self.latest[0] > FRESH_S:
                return connection.respond(HTTPStatus.NOT_FOUND, "no fresh frame for that recording\n")
            jpeg = self.latest[1]
            return Response(200, "OK", Headers([("Content-Type", "image/jpeg"), ("Content-Length", str(len(jpeg))),
                                                ("Cache-Control", "no-store")]), jpeg)
        return connection.respond(HTTPStatus.NOT_FOUND, "not found\n")


def _same(given: str, expected: str) -> bool:
    return bool(expected) and hmac.compare_digest(given.encode(), expected.encode())


def _json(body: dict) -> Response:
    raw = json.dumps(body).encode()
    return Response(200, "OK", Headers([("Content-Type", "application/json"), ("Content-Length", str(len(raw)))]), raw)


def _stopped(folder: Path) -> bool:
    meta = _meta(folder) or {}
    return any(k in meta for k in ("stopped", "abandoned", "finished", "failed"))


def _meta(folder: Path) -> dict | None:
    try:
        return json.loads((folder / "meta.json").read_text())
    except (OSError, ValueError):
        return None


async def main(cfg: Config) -> None:
    ingest = Ingest(cfg)
    async with serve(ingest.handle, "0.0.0.0", cfg.port, process_request=ingest.process_request,
                     ping_interval=15, ping_timeout=20, max_size=2 ** 21):
        log.info("listening on :%d, saving to %s%s", cfg.port, cfg.root, " (dry upload)" if cfg.dry_upload else "")
        await ingest.poll()


if __name__ == "__main__":
    p = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    p.add_argument("--port", type=int, default=int(os.environ.get("GLASSES_PORT", "8090")))
    p.add_argument("--dir", default=os.environ.get("GLASSES_DIR", "/var/glasses"))
    p.add_argument("--dry-upload", action="store_true", help="keep the MP4 on disk and log where it would go")
    args = p.parse_args()
    logging.basicConfig(format="%(asctime)s %(levelname)s %(message)s", level=logging.INFO)
    logging.getLogger("websockets").setLevel(logging.WARNING)
    env = os.environ
    missing = [k for k in ("GLASSES_SECRET", "GLASSES_DEVICE_KEY", "CONVEX_SITE_URL") if not env.get(k)]
    if not args.dry_upload and not env.get("GCS_UPLOAD_BUCKET"):
        missing.append("GCS_UPLOAD_BUCKET")
    if missing:
        raise SystemExit(f"missing env: {', '.join(missing)}")
    asyncio.run(main(Config(env["GLASSES_SECRET"], env["GLASSES_DEVICE_KEY"], env["CONVEX_SITE_URL"],
                            env.get("GCS_UPLOAD_BUCKET", ""), Path(args.dir), args.port, args.dry_upload)))
