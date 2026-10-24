"""Turn any phone video into a glasses-style session folder.

Use it to test the Gemini prompt and the app on real cooking footage before
the glasses exist, or to run Edible's "prop up your phone" capture through the
same pipeline.

    python tools/phone_to_session.py cooking.mov --cook Ammi --relationship mother \
        --languages Urdu,English --dish "Chicken biryani" [--markers 0:40,3:10]
    python pipeline/extract.py sessions/<id>
"""
from __future__ import annotations

import argparse
import json
import random
import subprocess
import sys
import tempfile
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT / "receiver"))
from edg_protocol import END, EVENT, HELLO, JPEG, NO_SEQ, PCM, SAMPLE_RATE, Packet  # noqa: E402
import session_builder as sb  # noqa: E402


def to_seconds(s: str) -> float:
    parts = [float(p) for p in s.split(":")]
    out = 0.0
    for p in parts:
        out = out * 60 + p
    return out


def main() -> None:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("video", type=Path)
    ap.add_argument("--out", type=Path, default=Path("sessions"))
    ap.add_argument("--fps", type=float, default=2.0, help="frames kept per second (glasses AI mode = 2)")
    ap.add_argument("--cook", default="")
    ap.add_argument("--relationship", default="")
    ap.add_argument("--languages", default="")
    ap.add_argument("--dish", default="")
    ap.add_argument("--markers", default="", help="step times like 0:40,3:10")
    args = ap.parse_args()

    sid = "phone%011x" % random.getrandbits(44)
    sdir = args.out / sid
    (sdir / "raw").mkdir(parents=True)

    with tempfile.TemporaryDirectory() as tmp:
        tmp = Path(tmp)
        subprocess.run(["ffmpeg", "-v", "error", "-i", str(args.video),
                        "-vf", f"fps={args.fps},scale=1280:720:force_original_aspect_ratio=decrease",
                        "-q:v", "5", str(tmp / "f_%06d.jpg")], check=True)
        pcm = subprocess.run(["ffmpeg", "-v", "error", "-i", str(args.video), "-vn", "-ac", "1",
                              "-ar", str(SAMPLE_RATE), "-f", "s16le", "-"], capture_output=True, check=True).stdout

        packets: list[Packet] = []
        for i, f in enumerate(sorted(tmp.glob("f_*.jpg"))):
            packets.append(Packet(JPEG, 0, 0, int(i / args.fps * 1000), f.read_bytes()))
        block = 3200  # 100 ms
        for i in range(0, len(pcm) - block + 1, block):
            packets.append(Packet(PCM, 0, 0, int(i / 2 / SAMPLE_RATE * 1000), pcm[i:i + block]))
        duration_ms = max(p.t_ms for p in packets) + 100
        events = [(0, "start")] + [(int(to_seconds(m) * 1000), "marker") for m in args.markers.split(",") if m] \
            + [(duration_ms, "stop")]
        for t, name in events:
            packets.append(Packet(EVENT, 0, 0, t, json.dumps({"event": name, "mode": "ai"}).encode()))

    packets.sort(key=lambda p: (p.t_ms, p.type))
    with open(sdir / "raw" / "phone.bin", "wb") as f:
        f.write(Packet(HELLO, 0, NO_SEQ, 0, json.dumps({"session_id": sid, "sensor": "phone", "mode": "ai"}).encode()).encode())
        for i, p in enumerate(packets):
            p.seq = i
            f.write(p.encode())
        f.write(Packet(END, 0, NO_SEQ, duration_ms, b"").encode())

    (sdir / "meta.json").write_text(json.dumps({
        "cook_name": args.cook, "relationship": args.relationship,
        "spoken_languages": [x.strip() for x in args.languages.split(",") if x.strip()],
        "dish_name": args.dish, "started_at": "", "consent_recorded_at": "00:00", "license_opt_in": False,
    }, indent=2))
    s = sb.build_all(sdir, fps=int(round(args.fps)) or 1)
    print(f"Session {sid}: {s.duration:.0f} s, {len(sb.chunk_ranges(s.duration))} chunk(s) in {sdir}")


if __name__ == "__main__":
    main()
