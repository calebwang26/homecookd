"""End-to-end test without hardware or an API key.

    pip install -r requirements.txt pytest
    pytest -q tests

Runs fake glasses -> receiver -> session folder (with a Wi-Fi gap and a mode
change), checks timing and gaps, backfills from the fake SD card, then runs
the Gemini step with a stand-in client and checks the merged recipe.
"""
from __future__ import annotations

import json
import os
import socket
import subprocess
import sys
import time
from pathlib import Path
from types import SimpleNamespace

import numpy as np
import pytest
from PIL import Image

ROOT = Path(__file__).resolve().parent.parent
sys.path[:0] = [str(ROOT / "receiver"), str(ROOT / "pipeline")]
os.environ["EDIBLE_CHUNK_SECONDS"] = "60"
os.environ["EDIBLE_OVERLAP_SECONDS"] = "10"

import session_builder as sb  # noqa: E402
import extract  # noqa: E402
import merge  # noqa: E402


def free_port() -> int:
    s = socket.socket()
    s.bind(("127.0.0.1", 0))
    p = s.getsockname()[1]
    s.close()
    return p


def frame_second(mp4: Path, t: float, tmp: Path) -> int:
    """The fake frames encode int(session_t) % 60 in the red channel (+40)."""
    png = tmp / "f.png"
    subprocess.run(["ffmpeg", "-v", "error", "-ss", f"{t}", "-i", str(mp4), "-frames:v", "1", "-y", str(png)], check=True)
    return Image.open(png).convert("RGB").getpixel((300, 300))[0] - 40


@pytest.fixture(scope="module")
def session(tmp_path_factory):
    tmp = tmp_path_factory.mktemp("e2e")
    env = dict(os.environ)
    port = free_port()
    rx = subprocess.Popen([sys.executable, str(ROOT / "receiver/receiver.py"), "--out", str(tmp / "sessions"),
                           "--port", str(port), "--live-port", str(free_port()), "--no-discovery", "--cook", "Ammi", "--relationship", "mother",
                           "--languages", "Urdu,English", "--dish", "Chicken biryani"],
                          env=env, stdout=subprocess.PIPE, stderr=subprocess.STDOUT, text=True)
    time.sleep(1.5)
    subprocess.run([sys.executable, str(ROOT / "tools/fake_glasses.py"), "--port", str(port), "--seconds", "150",
                    "--gap", "40:50", "--playback-from", "120", "--sd-out", str(tmp / "sd"),
                    "--markers", "5,30,65,100,130"], check=True, env=env)
    sdir = None
    for _ in range(120):
        dirs = list((tmp / "sessions").glob("*"))
        if dirs and (dirs[0] / "session.json").exists():
            sdir = dirs[0]
            break
        time.sleep(0.5)
    rx.terminate()
    assert sdir, rx.stdout.read()
    return SimpleNamespace(dir=sdir, tmp=tmp)


def probe_duration(path: Path) -> float:
    out = subprocess.run(["ffprobe", "-v", "error", "-show_entries", "format=duration", "-of", "csv=p=0", str(path)],
                         capture_output=True, text=True, check=True).stdout
    return float(out)


def test_session_folder_matches_contract(session):
    d = session.dir
    meta = json.loads((d / "session.json").read_text())
    assert meta["cook_name"] == "Ammi" and meta["spoken_languages"] == ["Urdu", "English"]
    assert [c["start_s"] for c in meta["chunks"]] == [0, 50, 110]
    assert abs(probe_duration(d / "full.mp4") - 150) < 0.2
    assert abs(probe_duration(d / "chunks/chunk_01.mp4") - 70) < 0.2
    markers = json.loads((d / "markers.json").read_text())
    assert [m["at"] for m in markers] == ["00:05", "00:30", "01:05", "01:40", "02:10"]
    # 65 s is in chunk 1 only; at 55 s it would be in both 0 and 1
    assert markers[2]["chunks"] == [{"chunk_index": 1, "at": "00:15"}]


def test_timeline_is_true_and_gap_is_held(session, tmp_path):
    d = session.dir
    assert abs(frame_second(d / "full.mp4", 20.2, tmp_path) - 20) <= 4
    assert abs(frame_second(d / "chunks/chunk_01.mp4", 25.2, tmp_path) - 15) <= 4  # session 75 s
    assert abs(frame_second(d / "chunks/chunk_02.mp4", 15.2, tmp_path) - 5) <= 4   # session 125 s, VGA frames
    gaps = json.loads((d / "gaps.json").read_text())
    assert len(gaps) == 1 and 39 <= gaps[0]["start_s"] <= 40.5 and gaps[0]["end_s"] == 50
    assert abs(frame_second(d / "full.mp4", 45, tmp_path) - 39) <= 4  # held frame from before the gap


def test_sd_backfill_closes_gap(session, tmp_path):
    d = session.dir
    sb.build_all(d, [session.tmp / "sd" / f"{d.name}.bin"])
    assert json.loads((d / "gaps.json").read_text()) == []
    assert abs(frame_second(d / "full.mp4", 45.2, tmp_path) - 45) <= 4
    pcm = subprocess.run(["ffmpeg", "-v", "error", "-ss", "44", "-t", "2", "-i", str(d / "full.mp4"),
                          "-f", "s16le", "-ac", "1", "-ar", "16000", "-"], capture_output=True).stdout
    assert np.sqrt((np.frombuffer(pcm, "<i2").astype(float) ** 2).mean()) > 1000


class FakeGemini:
    """Stands in for google.genai.Client: returns canned steps per chunk."""

    CANNED = {
        0: [("00:03", "00:28", "Wash the rice"), ("00:30", "01:00", "Fry the onions")],          # last one cut at end
        1: [("00:00", "00:25", "Fry the onions"), ("00:15", "00:48", "Add the masala"),           # first one = overlap dup
            ("00:50", "01:10", "Layer rice and chicken")],
        2: [("00:05", "00:20", "Layer rice and chicken"), ("00:20", "00:40", "Dum on low heat")],
    }

    def __init__(self):
        self.calls = []
        self.files = SimpleNamespace(upload=self._upload, get=lambda name: self._f, delete=lambda name: None)
        self.interactions = SimpleNamespace(create=self._create)

    def _upload(self, file):
        self._f = SimpleNamespace(name="files/x", uri="https://x", mime_type="video/mp4",
                                  state=SimpleNamespace(name="ACTIVE"), path=file)
        return self._f

    def _create(self, model, input, response_format):
        assert input[0]["type"] == "video" and input[1]["type"] == "text"   # video first, prompt after
        assert response_format["mime_type"] == "application/json"
        k = int(Path(self._f.path).stem.split("_")[1])
        self.calls.append((k, input[1]["text"]))
        steps = [{"start": a, "end": b, "title": t, "instruction": t + ".",
                  "ingredients": [{"name": "garam masala", "said_as": "thoda sa", "estimated_amount": "~1 tsp", "at": a}]
                  if "masala" in t else [],
                  "doneness_cue": "", "quote_original": "", "quote_english": "", "story": "", "confidence": 0.9}
                 for a, b, t in self.CANNED[k]]
        return SimpleNamespace(output_text=json.dumps({"dish_guess": "biryani", "steps": steps, "notes": ""}))


def test_gemini_step_and_merge(session):
    d = session.dir
    fake = FakeGemini()
    for k in range(3):
        extract.process_chunk(d, k, client=fake, force=True)
    prompt1 = dict(fake.calls)[1]
    assert "00:15" in prompt1 and "Urdu and English" in prompt1 and "first 10 seconds repeat" in prompt1
    r = merge.merge(d)
    titles = [s.title for s in r.steps]
    assert titles == ["Wash the rice", "Fry the onions", "Add the masala", "Layer rice and chicken", "Dum on low heat"]
    fry = r.steps[1]
    assert fry.start_s == 30 and fry.end_s == 75          # extended from chunk 1 (50 + 25)
    layer = r.steps[3]
    assert layer.start_s == 100 and layer.source_chunk == 1
    assert r.ingredients[0].said_as == "thoda sa" and r.title == "Ammi's Chicken biryani"
