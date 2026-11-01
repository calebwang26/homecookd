"""The laptop's worker has no sentry_sdk (docs/build/CUTOVER.md). With the package hidden: `worker.py` imports, its main starts,
Sentry does nothing even with its env set, and nothing from queue mode came along. Runs in a child so the hiding is complete."""
import os
import subprocess
import sys
from pathlib import Path

HERE = Path(__file__).resolve().parent

CHILD = """
import os, sys
sys.modules["sentry_sdk"] = None  # `import sentry_sdk` now raises ImportError, as it does on the laptop
os.environ["SENTRY_DSN_WORKER"] = "https://k@example.ingest.us.sentry.io/1"
os.environ["DEPLOY_ENV"] = "staging"
sys.path.insert(0, sys.argv[1])

import worker
import observability

assert observability.sentry_sdk is None
assert observability.init_sentry() is False
assert observability.report_failure(ValueError("she said: add the masala"), "job") is None

for name in ("queue_worker", "queue_job", "queue_db", "queue_aws", "psycopg", "boto3"):
    assert name not in sys.modules, name + " came along with worker.py"

# main() as far as its arguments, which is past init_sentry. Never the real .env.
worker.load_dotenv = lambda *a, **k: None
sys.argv = ["worker.py", "--help"]
try:
    worker.main()
except SystemExit as e:
    assert e.code == 0, e.code
else:
    raise AssertionError("--help should exit")
print("worker imports and starts without sentry_sdk")
"""


def test_worker_without_sentry():
    env = {k: v for k, v in os.environ.items() if k not in ("SENTRY_DSN_WORKER", "DEPLOY_ENV")}
    done = subprocess.run([sys.executable, "-c", CHILD, str(HERE)], capture_output=True, text=True, env=env, cwd=HERE)
    assert done.returncode == 0, done.stderr[-2000:]
    assert "worker imports and starts without sentry_sdk" in done.stdout
    assert "Sentry is off" in done.stderr  # the env asks for Sentry and it isn't there, so it says so


if __name__ == "__main__":
    test_worker_without_sentry()
    print("ok")
