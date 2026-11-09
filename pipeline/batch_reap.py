"""What a killed run's Claude batches billed, into its usage.json (process.reap_batches, claude.reap).

    python pipeline/batch_reap.py data/out/<id>/work

queue_worker runs it after it kills a job, within REAP_TIMEOUT_S, so that spend reaches model_calls and the daily cap.
"""
from __future__ import annotations

import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

from dotenv import load_dotenv  # noqa: E402

from pipeline import process  # noqa: E402


def main() -> None:
    work = Path(sys.argv[1])
    load_dotenv(ROOT / ".env")
    n = process.reap_batches(work, process.Usage(work / "usage.json"), process.claude.REAP_S)
    print(f"[batch_reap] {work}: {n} billed batch answer(s) recorded")


if __name__ == "__main__":
    main()
