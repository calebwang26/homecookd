"""Unit tests for the VM's state machine (server.Ingest.tick). No network, no ffmpeg, no cloud.

    .venv/bin/python glasses/ingest/test_server.py      # plain runner (pytest is not in the venv)
    pytest glasses/ingest/test_server.py                 # also works if pytest is installed

A fake Convex holds the glasses recordings, a fake clock drives the 60 s quiet timeout and the 30 s retry,
mux and the GCS upload are stand-ins, and every test gets its own temp folder.
"""
from __future__ import annotations

import asyncio
import json
import logging
import shutil
import sys
import tempfile
import unittest
from pathlib import Path
from unittest import mock

sys.path.insert(0, str(Path(__file__).resolve().parent))

import cloud  # noqa: E402
import mux  # noqa: E402
import server  # noqa: E402
from websockets.datastructures import Headers  # noqa: E402
from websockets.http11 import Request  # noqa: E402

server.log.addHandler(logging.NullHandler())  # keep the expected warnings out of the test output
LIVE = ("intro", "recording", "wrapping_up")
JPEG = b"\xff\xd8" + bytes(200) + b"\xff\xd9"
STEP_S = 0.125  # 8 fps
PCM = bytes(int(STEP_S * 32_000))  # the audio that goes with one frame


class Clock:
    """Stands in for the time module in server.py: the wall clock and monotonic time move only when told."""

    def __init__(self) -> None:
        self.wall = 1_800_000_000.0
        self.mono = 1_000.0

    def time(self) -> float:
        return self.wall

    def monotonic(self) -> float:
        return self.mono

    def advance(self, s: float) -> None:
        self.wall += s
        self.mono += s


class FakeConvex:
    """The /glasses/* routes over a dict of recordings (oldest first), like convex/glasses.ts."""

    def __init__(self) -> None:
        self.status: dict[str, str] = {}
        self.stale: set[str] = set()  # over 12 h old: /glasses/active {} no longer reports them
        self.finished: list[dict] = []
        self.jobs: dict[str, str] = {}  # recordings someone else (the laptop bridge) already finished
        self.saved: set[str] = set()  # recordings whose full video the laptop bridge saved (no job)
        self.down = 0  # answer /glasses/finished with a 500 this many more times

    async def __call__(self, path: str, body: dict) -> tuple[int, dict | None]:
        if path == "/glasses/active":
            rid = body.get("recordingId")
            if rid is not None:
                if rid not in self.status:
                    return 404, {"error": "no such glasses recording"}
                row = {"recordingId": rid, "status": self.status[rid]}
                row |= {"jobId": self.jobs[rid]} if rid in self.jobs else {}
                return 200, row | ({"videoSaved": True} if rid in self.saved else {})
            live = [r for r, s in self.status.items() if s in LIVE and r not in self.stale]
            return (200, {"recordingId": live[-1], "status": self.status[live[-1]]}) if live else (204, None)
        if path == "/glasses/finished":
            if self.down:
                self.down -= 1
                return 500, {"error": "Convex is down"}
            rid = body["recordingId"]
            if rid not in self.status:
                return 404, {"error": "no such glasses recording"}
            if self.status[rid] == "abandoned":
                return 400, {"error": "the recording was abandoned"}
            self.finished.append(body)
            return 200, {"jobId": f"job-{rid}", "recipeId": f"recipe-{rid}"}
        raise AssertionError(f"unexpected Convex call {path}")


class Glasses:
    """The glasses: a socket the VM tells things to, and a device clock for what they send."""

    def __init__(self, ingest: server.Ingest, clock: Clock, dev_us: int = 7_000_000) -> None:
        self.ingest, self.clock, self.dev_us = ingest, clock, dev_us
        self.told: list[dict] = []
        ingest.glasses.add(self)  # type: ignore[arg-type]

    async def send(self, text: str) -> None:
        self.told.append(json.loads(text))

    def film(self, seconds: float) -> None:
        """Send `seconds` of 8 fps frames and the audio that goes with them, in real time."""
        for _ in range(round(seconds / STEP_S)):
            for kind, payload in ((1, JPEG), (2, PCM)):
                head = bytes([kind]) + self.dev_us.to_bytes(8, "little") + len(payload).to_bytes(4, "little")
                self.ingest.on_binary(head + payload)
            self.clock.advance(STEP_S)
            self.dev_us += int(STEP_S * 1e6)


async def fake_mux(folder: Path, meta: dict) -> tuple[Path, int, float]:
    lines = (folder / "frames.txt").read_text().splitlines()
    assert lines, "mux should never see a recording without frames"
    first, last = int(lines[0].split()[0]), int(lines[-1].split()[0])
    (folder / "out.mp4").write_bytes(f"mp4 of {len(lines)} frames".encode())
    return folder / "out.mp4", first, round((last - first) / 1000 + STEP_S, 3)


class TickTest(unittest.IsolatedAsyncioTestCase):
    def setUp(self) -> None:
        self.root = Path(tempfile.mkdtemp(prefix="glasses-unit-"))
        self.addCleanup(shutil.rmtree, self.root, True)
        self.clock = Clock()
        self.convex = FakeConvex()
        self.uploads: list[tuple[str, str, bytes]] = []
        for patch in (mock.patch.object(server, "time", self.clock), mock.patch.object(mux, "mux", fake_mux),
                      mock.patch.object(cloud, "upload", self.fake_upload)):
            patch.start()
            self.addCleanup(patch.stop)

    def fake_upload(self, bucket: str, name: str, file: Path) -> str:
        self.uploads.append((bucket, name, file.read_bytes()))
        return "uploaded"

    def vm(self) -> server.Ingest:
        """A fresh start of the service on this test's folder."""
        cfg = server.Config(secret="s3cret", device_key="dev", convex_url="http://convex.invalid",
                            bucket="uploads", root=self.root, port=0, dry_upload=False)
        ingest = server.Ingest(cfg)
        ingest.convex = self.convex  # type: ignore[method-assign]
        self.addCleanup(lambda: ingest.current and ingest.current.close())
        return ingest

    async def tick(self, ingest: server.Ingest) -> None:
        await ingest.tick()
        await asyncio.gather(*ingest.tasks)  # the finish() runs it started

    def meta(self, rid: str) -> dict:
        return json.loads((self.root / rid / "meta.json").read_text())

    def files(self, rid: str) -> list[str]:
        return sorted(p.name for p in (self.root / rid).iterdir())

    def wall_ms(self) -> int:
        return int(self.clock.wall * 1000)

    # ---- the tests ----

    async def bridged_recording(self) -> server.Ingest:
        """Glasses streaming through the laptop bridge, filmed for 2 s, then the cook said "I'm done"."""
        vm = self.vm()
        glasses = Glasses(vm, self.clock)
        vm.on_text(json.dumps({"type": "hello", "fw": "edible-glasses-bridge 0.1", "w": 640, "h": 480, "fps": 8}))
        self.convex.status["A"] = "recording"
        await self.tick(vm)
        glasses.film(2)
        self.convex.status["A"] = "ended"
        await self.tick(vm)
        self.assertIsNone(vm.current)
        self.assertEqual(self.uploads, [])  # the laptop gets its head start
        return vm

    async def test_bridge_finished_first_so_the_vm_only_cleans_up(self) -> None:
        vm = await self.bridged_recording()
        self.convex.jobs["A"] = "job-A"  # the laptop uploaded the full video and made the job
        self.clock.advance(server.BRIDGE_GRACE_S + 1)
        await self.tick(vm)
        self.assertEqual(self.uploads, [])
        self.assertEqual(self.convex.finished, [])
        self.assertEqual(self.meta("A")["finished"], {"jobId": "job-A", "by": "bridge"})
        self.assertEqual(self.files("A"), ["meta.json"])
        self.assertEqual(vm.todo, set())

    async def test_bridge_saved_the_video_so_the_vm_makes_no_job(self) -> None:
        vm = await self.bridged_recording()
        self.convex.saved.add("A")  # the laptop saved the full video for the cook to send herself
        self.clock.advance(server.BRIDGE_GRACE_S + 1)
        await self.tick(vm)
        self.assertEqual(self.uploads, [])
        self.assertEqual(self.convex.finished, [])
        self.assertEqual(self.meta("A")["finished"], {"jobId": None, "by": "bridge"})

    async def test_bridge_never_finished_so_the_vm_uploads_its_copy(self) -> None:
        vm = await self.bridged_recording()
        self.clock.advance(server.BRIDGE_GRACE_S - 10)
        await self.tick(vm)
        self.assertEqual(self.uploads, [])
        self.clock.advance(11)
        await self.tick(vm)
        self.assertEqual(self.uploads, [("uploads", "glasses-A/01.mp4", b"mp4 of 16 frames")])
        self.assertEqual([b["recordingId"] for b in self.convex.finished], ["A"])

    async def test_ended_makes_the_job_and_deletes_the_media(self) -> None:
        vm = self.vm()
        glasses = Glasses(vm, self.clock)
        self.convex.status["A"] = "intro"
        await self.tick(vm)
        self.assertIsNone(vm.current)
        glasses.film(1)  # homie is saying hello: nothing is filmed yet

        self.convex.status["A"] = "recording"
        await self.tick(vm)
        self.assertEqual(vm.current.id, "A")
        started = self.wall_ms()
        glasses.film(3)
        self.assertEqual(self.files("A"), ["audio.pcm", "frames", "frames.txt", "meta.json"])

        self.convex.status["A"] = "ended"
        await self.tick(vm)
        self.assertIsNone(vm.current)
        self.assertEqual(self.uploads, [("uploads", "glasses-A/01.mp4", b"mp4 of 24 frames")])
        self.assertEqual(self.convex.finished, [
            {"recordingId": "A", "uploadPath": "glasses-A/", "videoStartedAt": started, "durationS": 3.0}])
        self.assertEqual(self.meta("A")["finished"], {"jobId": "job-A", "recipeId": "recipe-A"})
        self.assertEqual(self.files("A"), ["meta.json"])
        self.assertEqual(vm.todo, set())
        self.assertEqual(glasses.told, [{"type": "recording", "recordingId": "A"}, {"type": "stopped"}])

    async def test_wrapping_up_finishes_after_60_quiet_seconds(self) -> None:
        vm = self.vm()
        glasses = Glasses(vm, self.clock)
        self.convex.status["A"] = "recording"
        await self.tick(vm)
        glasses.film(2)

        self.convex.status["A"] = "wrapping_up"  # "I'm done": homie's last questions, the glasses keep filming
        await self.tick(vm)
        glasses.film(1)
        self.clock.advance(50)
        await self.tick(vm)
        self.assertEqual(vm.current.id, "A")
        self.assertEqual(self.uploads, [])

        self.clock.advance(11)  # the glasses died or walked off; the phone never said "ended"
        await self.tick(vm)
        self.assertIsNone(vm.current)
        self.assertEqual(self.uploads, [("uploads", "glasses-A/01.mp4", b"mp4 of 24 frames")])
        self.assertEqual([b["recordingId"] for b in self.convex.finished], ["A"])
        self.assertEqual(self.files("A"), ["meta.json"])

    async def test_abandoned_uploads_nothing_and_deletes_the_media(self) -> None:
        vm = self.vm()
        glasses = Glasses(vm, self.clock)
        self.convex.status["A"] = "recording"
        await self.tick(vm)
        glasses.film(2)

        self.convex.status["A"] = "abandoned"
        await self.tick(vm)
        self.assertIsNone(vm.current)
        self.assertTrue(self.meta("A")["abandoned"])
        self.assertEqual(self.files("A"), ["meta.json"])

        self.clock.advance(60)
        await self.tick(vm)
        again = self.vm()  # nor after a restart
        await self.tick(again)
        self.assertEqual((again.todo, again.orphans), (set(), set()))
        self.assertEqual((self.uploads, self.convex.finished), ([], []))
        self.assertEqual(glasses.told, [{"type": "recording", "recordingId": "A"}, {"type": "stopped"}])

    async def test_a_deleted_recording_counts_as_abandoned(self) -> None:
        vm = self.vm()
        glasses = Glasses(vm, self.clock)
        self.convex.status["A"] = "recording"
        await self.tick(vm)
        glasses.film(1)

        del self.convex.status["A"]  # /glasses/active answers 404 for it
        await self.tick(vm)
        self.assertIsNone(vm.current)
        self.assertTrue(self.meta("A")["abandoned"])
        self.assertEqual(self.files("A"), ["meta.json"])
        self.assertEqual(self.uploads, [])

    async def test_restart_mid_recording_resumes_the_same_folder(self) -> None:
        vm = self.vm()
        glasses = Glasses(vm, self.clock)
        self.convex.status["A"] = "recording"
        await self.tick(vm)
        started = self.wall_ms()
        glasses.film(2)
        vm.current.close()  # the service dies: nothing is stopped or marked

        vm = self.vm()
        self.assertEqual(vm.orphans, {"A"})
        glasses = Glasses(vm, self.clock, glasses.dev_us)  # the same glasses reconnect
        await self.tick(vm)
        self.assertEqual((vm.current.id, vm.current.frames, vm.orphans), ("A", 16, set()))
        glasses.film(1)

        self.convex.status["A"] = "ended"
        await self.tick(vm)
        self.assertEqual(self.uploads, [("uploads", "glasses-A/01.mp4", b"mp4 of 24 frames")])
        [body] = self.convex.finished
        self.assertEqual(body["videoStartedAt"], started)
        self.assertEqual(self.files("A"), ["meta.json"])

    async def test_restart_after_the_recording_ended_uploads_it(self) -> None:
        vm = self.vm()
        glasses = Glasses(vm, self.clock)
        self.convex.status["A"] = "recording"
        await self.tick(vm)
        glasses.film(2)
        vm.current.close()  # the service dies, and the cook says "I'm done" while it's down
        self.convex.status["A"] = "ended"

        vm = self.vm()
        self.assertEqual(vm.orphans, {"A"})
        await self.tick(vm)
        self.assertIsNone(vm.current)
        self.assertEqual(vm.orphans, set())
        self.assertEqual(self.uploads, [("uploads", "glasses-A/01.mp4", b"mp4 of 16 frames")])
        self.assertEqual([b["recordingId"] for b in self.convex.finished], ["A"])
        self.assertEqual(self.files("A"), ["meta.json"])

    async def test_a_newer_recording_takes_the_glasses_from_one_that_never_ended(self) -> None:
        vm = self.vm()
        glasses = Glasses(vm, self.clock)
        self.convex.status["A"] = "recording"
        await self.tick(vm)
        glasses.film(2)

        self.convex.status["B"] = "recording"  # A's phone died; she started again. A is still "recording".
        await self.tick(vm)
        self.assertEqual(vm.current.id, "B")
        self.assertTrue(self.meta("A")["finished"])
        self.assertEqual(self.files("A"), ["meta.json"])
        glasses.film(3)
        self.assertEqual(vm.current.frames, 24)

        self.convex.status["B"] = "ended"
        await self.tick(vm)
        self.assertEqual(self.uploads, [("uploads", "glasses-A/01.mp4", b"mp4 of 16 frames"),
                                        ("uploads", "glasses-B/01.mp4", b"mp4 of 24 frames")])
        self.assertEqual([(b["recordingId"], b["uploadPath"]) for b in self.convex.finished],
                         [("A", "glasses-A/"), ("B", "glasses-B/")])
        self.assertEqual(glasses.told, [{"type": "recording", "recordingId": "A"}, {"type": "stopped"},
                                        {"type": "recording", "recordingId": "B"}, {"type": "stopped"}])

    async def test_a_newer_recording_in_its_intro_already_stops_the_old_one(self) -> None:
        vm = self.vm()
        glasses = Glasses(vm, self.clock)
        self.convex.status["A"] = "recording"
        await self.tick(vm)
        glasses.film(1)

        self.convex.status["B"] = "intro"
        await self.tick(vm)
        self.assertIsNone(vm.current)
        glasses.film(1)  # B's intro: nothing is filmed, and none of it goes to A
        self.assertEqual(self.uploads, [("uploads", "glasses-A/01.mp4", b"mp4 of 8 frames")])

        self.convex.status["B"] = "recording"
        await self.tick(vm)
        self.assertEqual((vm.current.id, vm.current.frames), ("B", 0))

    async def test_a_recording_that_never_ended_stops_once_convex_calls_it_stale(self) -> None:
        vm = self.vm()
        glasses = Glasses(vm, self.clock)
        self.convex.status["A"] = "recording"
        await self.tick(vm)
        glasses.film(1)

        self.convex.stale.add("A")  # 12 h later it's still "recording", but no longer live
        await self.tick(vm)
        self.assertIsNone(vm.current)
        self.assertEqual(self.uploads, [("uploads", "glasses-A/01.mp4", b"mp4 of 8 frames")])
        glasses.film(1)
        await self.tick(vm)
        self.assertIsNone(vm.current)
        self.assertEqual(len(self.uploads), 1)

    async def test_no_frames_fails_and_is_never_retried(self) -> None:
        vm = self.vm()
        self.convex.status["A"] = "recording"  # the glasses are off: nothing ever arrives
        await self.tick(vm)
        self.convex.status["A"] = "ended"
        with self.assertLogs("glasses", "WARNING") as logs:
            await self.tick(vm)
        self.assertIn("no frames", logs.output[0])
        self.assertEqual(self.meta("A")["failed"], {"error": "no frames"})
        self.assertEqual(self.files("A"), ["meta.json"])
        self.assertEqual(vm.todo, set())

        self.clock.advance(60)
        await self.tick(vm)
        again = self.vm()
        await self.tick(again)
        self.assertEqual((again.todo, again.orphans), (set(), set()))
        self.assertEqual((self.uploads, self.convex.finished), ([], []))

    async def test_convex_down_retries_after_30_s_without_uploading_twice(self) -> None:
        vm = self.vm()
        glasses = Glasses(vm, self.clock)
        self.convex.status["A"] = "recording"
        await self.tick(vm)
        glasses.film(1)
        self.convex.status["A"] = "ended"
        self.convex.down = 1
        await self.tick(vm)
        self.assertEqual((len(self.uploads), self.convex.finished, vm.todo), (1, [], {"A"}))
        self.assertIn("frames", self.files("A"))  # kept until the job exists

        await self.tick(vm)  # too soon to try again
        self.assertEqual(self.convex.finished, [])
        self.clock.advance(31)
        await self.tick(vm)
        self.assertEqual((len(self.uploads), len(self.convex.finished), vm.todo), (1, 1, set()))
        self.assertEqual(self.files("A"), ["meta.json"])

    async def test_each_recording_maps_device_time_to_the_wall_clock_afresh(self) -> None:
        vm = self.vm()
        glasses = Glasses(vm, self.clock)
        self.convex.status["A"] = "recording"
        await self.tick(vm)
        glasses.film(1)
        self.convex.status["A"] = "ended"
        await self.tick(vm)

        self.clock.advance(86_400)  # a day later the glasses' clock is 2 s behind the VM's
        glasses.dev_us += (86_400 - 2) * 1_000_000
        self.convex.status["B"] = "recording"
        await self.tick(vm)
        started = self.wall_ms()
        glasses.film(1)
        self.convex.status["B"] = "ended"
        await self.tick(vm)
        self.assertEqual(self.convex.finished[1]["videoStartedAt"], started)

    async def test_health_shows_details_only_with_the_secret(self) -> None:
        vm = self.vm()
        self.convex.status["A"] = "recording"
        await self.tick(vm)

        def health(headers: list[tuple[str, str]]) -> dict:
            res = vm.process_request(None, Request("/health", Headers(headers)))  # type: ignore[arg-type]
            return json.loads(res.body)

        self.assertEqual(health([]), {"ok": True, "glasses": 0})
        self.assertEqual(health([("x-glasses-secret", "wrong")]), {"ok": True, "glasses": 0})
        self.assertEqual(health([("x-glasses-secret", "s3cret")]),
                         {"ok": True, "glasses": 0, "recording": "A", "frames": 0, "lastFrameAgeS": None,
                          "waiting": []})


if __name__ == "__main__":
    unittest.main(verbosity=2)
