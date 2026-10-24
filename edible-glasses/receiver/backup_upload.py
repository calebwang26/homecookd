"""[B] Rolling cloud backup: every minute, the new bytes of each raw/*.bin go to
gs://<uploads>/glasses-backup/<recordingId>/<sessionId>/raw/<file>.<offset 12 digits>

so a dead laptop still leaves a copy of everything the glasses sent. Not under glasses-<recordingId>/:
the pipeline worker treats every object there as a video clip.

To get a raw file back, concatenate its parts in offset order (parts are cut at byte offsets, not
packet boundaries; edg_protocol.iter_packets reads the joined file as usual):
    python receiver/backup_upload.py restore <sessionId> <dir with the downloaded parts>

Part names carry their offset, so a retry after a crash re-sends the same name and GCS answers
"already there"; done offsets are also kept in <session>/cloud_backup.json.
"""
from __future__ import annotations

import json
import sys
import threading
from pathlib import Path

import cloud_io

EVERY_S = 60
MAX_PART = 64 * 1024 * 1024


def prefix(recording_id: str, session_id: str) -> str:
    return f"glasses-backup/{recording_id}/{session_id}"


class BackupUploader:
    def __init__(self, bucket: str) -> None:
        self.bucket = bucket
        self.sessions: dict[Path, str] = {}  # session dir -> recordingId
        self.lock = threading.Lock()  # one upload pass at a time (the loop and a finish can both run one)
        self.wake = threading.Event()

    def add(self, session_dir: Path, recording_id: str) -> None:
        self.sessions[session_dir] = recording_id
        self.wake.set()

    def run(self) -> None:  # a daemon thread
        while True:
            self.wake.wait(EVERY_S)
            self.wake.clear()
            for d, rid in list(self.sessions.items()):
                try:
                    self.sync(d, rid)
                except Exception as e:  # offline for a bit: the next pass sends it
                    print(f"[backup] {d.name}: {e}")

    def sync(self, session_dir: Path, recording_id: str, files: list[Path] | None = None) -> int:
        """Upload every raw byte not yet in GCS. Returns how many bytes went up."""
        with self.lock:
            state_path = session_dir / "cloud_backup.json"
            state = json.loads(state_path.read_text()) if state_path.exists() else {}
            done: dict[str, int] = state.setdefault("offsets", {})
            sent = 0
            for f in files or sorted((session_dir / "raw").glob("*.bin")):
                size = f.stat().st_size
                at = done.get(f.name, 0)
                with f.open("rb") as fh:
                    while at < size:
                        fh.seek(at)
                        data = fh.read(min(MAX_PART, size - at))
                        name = f"{prefix(recording_id, session_dir.name)}/raw/{f.name}.{at:012d}"
                        cloud_io.gcs_upload(self.bucket, name, data, "application/octet-stream")
                        at += len(data)
                        sent += len(data)
                        done[f.name] = at
                        state_path.write_text(json.dumps(state, indent=2))
            if sent:
                print(f"[backup] {session_dir.name}: {sent / 1e6:.1f} MB to gs://{self.bucket}/"
                      f"{prefix(recording_id, session_dir.name)}/")
            return sent

    def upload_file(self, recording_id: str, session_id: str, path: Path, content_type: str) -> None:
        cloud_io.gcs_upload(self.bucket, f"{prefix(recording_id, session_id)}/{path.name}", path, content_type)


def restore(session_id: str, parts_dir: Path, out_dir: Path) -> list[Path]:
    """Join downloaded parts back into raw/*.bin under out_dir/<sessionId>/raw/."""
    groups: dict[str, list[Path]] = {}
    for p in parts_dir.rglob("*.bin.*"):
        groups.setdefault(p.name.rsplit(".", 1)[0], []).append(p)
    raw = out_dir / session_id / "raw"
    raw.mkdir(parents=True, exist_ok=True)
    out = []
    for name, parts in groups.items():
        parts.sort(key=lambda p: int(p.name.rsplit(".", 1)[1]))
        with (raw / name).open("wb") as f:
            for p in parts:
                f.write(p.read_bytes())
        out.append(raw / name)
    return out


if __name__ == "__main__":
    if len(sys.argv) != 4 or sys.argv[1] != "restore":
        raise SystemExit("usage: backup_upload.py restore <sessionId> <dir with the downloaded parts>")
    for p in restore(sys.argv[2], Path(sys.argv[3]), Path("sessions")):
        print(f"restored {p}")
