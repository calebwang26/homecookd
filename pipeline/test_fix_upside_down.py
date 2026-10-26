"""Tests for pipeline/fix_upside_down.py: which clips it flags, the job lookup, and the repair itself.

    .venv/bin/python pipeline/test_fix_upside_down.py     # plain runner (pytest is not in the venv)

No network: the probes are the ffprobe JSON of the real Oct 25 uploads, trimmed, and the repair runs on a
2-second clip ffmpeg makes here.
"""
from __future__ import annotations

import contextlib
import os
import sys
import tempfile
import traceback
from pathlib import Path
from types import SimpleNamespace

ROOT = Path(__file__).resolve().parent.parent
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

from pipeline import fix_upside_down as fix, prep  # noqa: E402


def matrix_text(m: tuple[int, ...]) -> str:
    """ffprobe's displaymatrix string for 9 ints."""
    return "\n" + "".join(f"{row:08d}: {m[3 * row]:12d} {m[3 * row + 1]:11d} {m[3 * row + 2]:11d}\n" for row in range(3))


MATRICES = {90: fix.PURE_90, -90: fix.PURE_MINUS_90, 270: fix.PURE_MINUS_90, -270: fix.PURE_90,
            180: (-65536, 0, 0, 0, -65536, 0, 0, 0, 1 << 30)}
HFLIP_90 = (0, 65536, 0, 65536, 0, 0, 0, 0, 1 << 30)  # 90 plus a left-right flip: ffprobe still says rotation 90


def info(rotation: float | None = 90, brand: str = "mp42", created: str = "2026-10-25T18:19:12.000000Z",
         matrix: tuple[int, ...] | None = None, **tags: str) -> dict:
    """ffprobe -show_format -show_streams JSON shaped like an in-app VisionCamera upload."""
    video = {"codec_type": "video", "codec_name": "h264", "width": 1920, "height": 1080, "disposition": {}}
    if rotation is not None:
        m = matrix or MATRICES[int(rotation)]
        video["side_data_list"] = [{"side_data_type": "Display Matrix", "displaymatrix": matrix_text(m),
                                    "rotation": rotation}]
    fmt_tags = {"major_brand": brand, "creation_time": created, **tags}
    return {"streams": [{"codec_type": "audio"}, video], "format": {"tags": fmt_tags, "duration": "10.7"}}


def test_front_clip_in_the_window_is_flagged():
    bad, why = fix.verdict(info())  # family-recipe-9363d8/01.mp4
    assert bad and "front camera" in why


def test_back_clip_is_upright():
    assert fix.verdict(info(rotation=-90)) == (False, "upright (rotation -90)")
    assert fix.verdict(info(rotation=270))[0] is False  # the same angle written another way


def test_system_camera_and_ffmpeg_files_are_not_in_app():
    # fluid-cca692/01.mov: the iOS camera (qt brand, Apple tags); the glasses VM and demo uploads: ffmpeg's encoder tag
    assert not fix.verdict(info(brand="qt", **{"com.apple.quicktime.make": "Apple"}))[0]
    assert not fix.verdict(info(**{"com.apple.quicktime.model": "iPhone 15"}))[0]
    assert not fix.verdict(info(brand="isom", encoder="Lavf59.27.100"))[0]
    assert not fix.verdict(info(encoder="Lavf63.1.102"))[0]  # a repaired clip


def test_other_rotations_and_no_rotation_are_left_alone():
    assert not fix.verdict(info(rotation=None))[0]
    assert not fix.verdict(info(rotation=180))[0]
    assert fix.verdict(info(rotation=-270))[0]  # 90 written another way


def test_time_window():
    assert not fix.verdict(info(created="2026-10-24T20:00:00Z"))[0]  # before #79 reached phones
    assert fix.verdict(info(created="2026-10-25T10:31:10.000000Z"))[0]  # d0a31c, the first one
    bad, why = fix.verdict(info(created="2026-10-27T09:00:00Z"))  # a phone still on the old JS
    assert bad and "after #104" in why
    bad, why = fix.verdict(info(created=""))
    assert not bad and "by eye" in why


def test_a_flip_in_the_matrix_is_refused():
    bad, why = fix.verdict(info(matrix=HFLIP_90))
    assert not bad and "plain turn" in why
    assert fix.matrix(info()) == fix.PURE_90  # the parser reads ffprobe's text


def test_matrix_parses_real_ffprobe_text():
    real = ("\n00000000:            0      -65536           0\n00000001:        65536           0           0\n"
            "00000002:            0           0  1073741824\n")  # family-recipe-9363d8/01.mp4
    assert fix.matrix({"streams": [{"codec_type": "video", "side_data_list": [{"displaymatrix": real}]}]}) == fix.PURE_90


def test_rotation_reads_old_rotate_tag():
    old = {"streams": [{"codec_type": "video", "tags": {"rotate": "270"}}]}
    assert fix.same_angle(fix.rotation(old), 90)


def test_job_for_matches_folder_and_file():
    jobs = [{"_id": "a", "uploadPath": "family-recipe-d0a31c/"}, {"_id": "b", "uploadPath": "poha-dacd7e/01.mp4"}]
    assert fix.job_for("family-recipe-d0a31c/02.mp4", jobs)["_id"] == "a"
    assert fix.job_for("poha-dacd7e/01.mp4", jobs)["_id"] == "b"
    assert fix.job_for("family-recipe-7f1ee1/01.mp4", jobs) is None


def test_redo_hint():
    job = {"_id": "j1", "stage": "failed"}
    assert "nothing was published" in fix.redo_hint(fix.Clip("x/01.mp4", "", job, {"_id": "r1", "status": "failed"}))
    ready = fix.redo_hint(fix.Clip("x/01.mp4", "", {**job, "stage": "done"},
                                   {"_id": "r1", "status": "ready", "title": "Poha", "recipeJsonUrl": "u"}))
    assert "queued" in ready and "Caleb" in ready
    assert "nothing was made" in fix.redo_hint(fix.Clip("x/01.mp4", ""))


def _clip(dirpath: Path, hflip: bool = False) -> Path:
    """A 2 s clip with sound, rotation 90 (plus a flip if asked) and a creation_time, like a bad upload."""
    raw, out = dirpath / "raw.mp4", dirpath / ("flipped.mp4" if hflip else "bad.mp4")
    prep.ffmpeg("-f", "lavfi", "-i", "testsrc=size=320x180:rate=30:duration=2", "-f", "lavfi",
                "-i", "sine=frequency=440:duration=2", "-c:v", "libx264", "-preset", "ultrafast", "-c:a", "aac",
                "-shortest", str(raw))
    prep.ffmpeg("-display_rotation:v:0", "90", *(["-display_hflip:v:0"] if hflip else []), "-i", str(raw),
                "-map", "0", "-c", "copy", "-brand", "mp42", "-fflags", "+bitexact",  # no encoder tag: like the app's
                "-metadata", "creation_time=2026-10-25T18:19:12Z", str(out))
    return out


def test_repair_turns_the_tag_and_keeps_everything_else():
    with tempfile.TemporaryDirectory() as tmp:
        src = _clip(Path(tmp))
        assert fix.verdict(prep.probe(src))[0]  # looks like a bad in-app upload
        dst = Path(tmp) / "fixed.mp4"
        fix.repair_file(src, dst)  # raises if the rotation, packets, creation_time or duration are off
        after = prep.probe(dst)
        assert fix.rotation(after) == -90
        assert fix.created_at(after) == fix.created_at(prep.probe(src))
        assert fix.stream_hash(src, "v") == fix.stream_hash(dst, "v")


def test_repair_refuses_a_flipped_matrix():
    with tempfile.TemporaryDirectory() as tmp:
        src = _clip(Path(tmp), hflip=True)
        probed = prep.probe(src)
        assert fix.same_angle(fix.rotation(probed), 90) and fix.matrix(probed) != fix.PURE_90
        try:
            fix.repair_file(src, Path(tmp) / "fixed.mp4")
        except fix.prep.PrepError as e:  # fix imports prep as a top-level module, not pipeline.prep
            assert "plain 90" in str(e)
        else:
            raise AssertionError("a 90 + flip matrix was repaired")


class FakeBlob:
    def __init__(self, name, data=None):
        self.name, self.data, self.generation = name, data, 1
        self.content_type, self.cache_control, self.metadata = "video/mp4", "private, max-age=0", {"k": "v"}
        self.uploaded = None

    def exists(self):
        return self.data is not None

    def download_to_filename(self, dest, if_generation_match=None):
        Path(dest).write_bytes(self.data)

    def upload_from_filename(self, src, if_generation_match=None):
        self.uploaded = Path(src).read_bytes()


class FakeBucket:
    name = "uploads"

    def __init__(self, files):
        self.blobs = {k: FakeBlob(k, v) for k, v in files.items()}
        self.copies = []

    def get_blob(self, name):
        b = self.blobs.get(name)
        return b if b and b.exists() else None

    def blob(self, name):
        return self.blobs.setdefault(name, FakeBlob(name))

    def copy_blob(self, blob, bucket, new_name, **_kw):
        self.copies.append(new_name)
        self.blobs[new_name] = FakeBlob(new_name, blob.data)


def test_write_goes_on_after_a_failure_and_keeps_metadata():
    with tempfile.TemporaryDirectory() as tmp:
        good, flipped = _clip(Path(tmp)), _clip(Path(tmp), hflip=True)
        uploads = FakeBucket({"a/01.mp4": flipped.read_bytes(), "b/01.mp4": good.read_bytes()})
        failed = fix.write(uploads, ["missing/01.mp4", "a/01.mp4", "b/01.mp4"], mirror=False)
        assert failed == 2  # the missing clip and the flipped one; b still got repaired
        assert uploads.copies == ["backup/b/01.mp4"]  # nothing written for the failures
        assert uploads.blobs["a/01.mp4"].uploaded is None
        out = uploads.blobs["b/01.mp4"]
        assert out.uploaded and out.metadata == {"k": "v"} and out.cache_control == "private, max-age=0"
        fixed = Path(tmp) / "out.mp4"
        fixed.write_bytes(out.uploaded)
        assert fix.matrix(prep.probe(fixed)) == fix.PURE_MINUS_90


def test_listed_reads_flags_and_file():
    with tempfile.TemporaryDirectory() as tmp:
        f = Path(tmp) / "list.txt"
        f.write_text("family-recipe-7f1ee1/01.mp4  # checked by eye\n\n# a comment\nfamily-recipe-9363d8/01.mp4\n")
        args = SimpleNamespace(clip=["family-recipe-9363d8/01.mp4"], clips=f)
        assert fix.listed(args) == ["family-recipe-9363d8/01.mp4", "family-recipe-7f1ee1/01.mp4"]


def test_write_needs_a_list():
    try:
        fix.main(["--write"])
    except SystemExit as e:
        assert "--clip" in str(e.code)
    else:
        raise AssertionError("--write ran without a clip list")


def test_mirror_bakes_the_picture_upright():
    with tempfile.TemporaryDirectory() as tmp:
        src = _clip(Path(tmp))
        dst = Path(tmp) / "mirrored.mp4"
        fix.repair_file(src, dst, mirror=True)
        video = next(s for s in prep.probe(dst)["streams"] if s["codec_type"] == "video")
        assert (video["width"], video["height"]) == (180, 320)  # portrait pixels, no rotation tag
        assert fix.rotation(prep.probe(dst)) in (None, 0)


def main() -> None:
    tests = [(name, fn) for name, fn in globals().items() if name.startswith("test_") and callable(fn)]
    failed = 0
    for name, fn in tests:
        try:
            with open(os.devnull, "w") as quiet, contextlib.redirect_stdout(quiet):
                fn()
        except Exception:  # noqa: BLE001
            failed += 1
            print(f"FAIL {name}")
            traceback.print_exc()
        else:
            print(f"ok   {name}")
    print(f"{len(tests) - failed}/{len(tests)} passed")
    sys.exit(1 if failed else 0)


if __name__ == "__main__":
    main()
