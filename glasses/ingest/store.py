"""One recording on the VM's disk: <dir>/<recordingId>/ holds frames/NNNNNN.jpg, frames.txt
("<wall ms> <file>" per frame), audio.pcm (16 kHz mono s16le) and meta.json. Everything is appended as it
arrives, so a restart of the service picks up where it left off."""
from __future__ import annotations

import json
from pathlib import Path

RATE = 16_000
BYTES_PER_S = RATE * 2
GAP_FILL_MS = 100  # fill audio gaps longer than this with silence, so sound stays in step with the frames


class Recording:
    def __init__(self, root: Path, recording_id: str):
        self.id = recording_id
        self.dir = root / recording_id
        (self.dir / "frames").mkdir(parents=True, exist_ok=True)
        self.meta_path = self.dir / "meta.json"
        self.meta = json.loads(self.meta_path.read_text()) if self.meta_path.exists() else {}
        index = self.dir / "frames.txt"
        lines = index.read_text().splitlines() if index.exists() else []
        self.frames = len(lines)
        self.last_frame_ms = int(lines[-1].split()[0]) if lines else 0
        self._index = index.open("a")
        self._audio = (self.dir / "audio.pcm").open("ab")
        self.audio_bytes = self._audio.tell()

    @property
    def video_started_at(self) -> int | None:
        return self.meta.get("videoStartedAt")

    def _save_meta(self) -> None:
        tmp = self.meta_path.with_suffix(".tmp")
        tmp.write_text(json.dumps(self.meta))
        tmp.replace(self.meta_path)

    def add_frame(self, wall_ms: int, jpeg: bytes) -> bool:
        if wall_ms <= self.last_frame_ms:  # out of order, or a duplicate after a reconnect
            return False
        self.frames += 1
        name = f"frames/{self.frames:06d}.jpg"
        (self.dir / name).write_bytes(jpeg)
        self._index.write(f"{wall_ms} {name}\n")
        self._index.flush()
        self.last_frame_ms = wall_ms
        if self.video_started_at is None:
            self.meta["videoStartedAt"] = wall_ms
            self._save_meta()
        return True

    def add_audio(self, wall_ms: int, pcm: bytes) -> None:
        if len(pcm) % 2:
            pcm = pcm[:-1]
        start = self.meta.get("audioStartedAt")
        if start is None:
            self.meta["audioStartedAt"] = wall_ms
            self._save_meta()
        else:
            expected_ms = start + self.audio_bytes * 1000 // BYTES_PER_S
            gap_ms = wall_ms - expected_ms
            if gap_ms > GAP_FILL_MS:
                self._audio.write(bytes(gap_ms * BYTES_PER_S // 1000 // 2 * 2))
            elif gap_ms < -1000:  # older than what we already have (a resent buffer): drop it
                return
        self._audio.write(pcm)
        self._audio.flush()
        self.audio_bytes = self._audio.tell()

    def close(self) -> None:
        self._index.close()
        self._audio.close()

    def mark(self, name: str, **data) -> None:
        self.meta[name] = data or True
        self._save_meta()

    def marked(self, name: str):
        return self.meta.get(name)
