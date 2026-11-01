"""Sentry for the worker, on AWS only (the laptop's worker reads the same .env and handles real families' videos).

A failed job's message can quote a transcript or a model's answer, so Sentry gets the error's type and where it happened,
never its text or local variables (docs/build/SYSTEM-DESIGN.md). The full error stays in the job's own record and logs.

The laptop's worker doesn't have sentry_sdk (it's in requirements-queue.txt), and `worker.py` imports this file: without the
package, or without both env values, every function here does nothing.
"""
import os
import sys

try:
    import sentry_sdk
except ImportError:
    sentry_sdk = None

_started = False


def scrub(event: dict, _hint: dict) -> dict:
    for exception in (event.get("exception") or {}).get("values") or []:
        exception["value"] = ""
    event.pop("logentry", None)
    event.pop("message", None)
    event.pop("user", None)
    event.pop("request", None)
    return event


def init_sentry() -> bool:
    global _started
    dsn = os.environ.get("SENTRY_DSN_WORKER")
    environment = os.environ.get("DEPLOY_ENV")
    if not dsn or not environment:
        return False
    if sentry_sdk is None:
        print("Sentry is off: SENTRY_DSN_WORKER and DEPLOY_ENV are set, but sentry_sdk isn't installed.", file=sys.stderr, flush=True)
        return False
    sentry_sdk.init(
        dsn=dsn,
        environment=environment,
        release=os.environ.get("RELEASE"),
        send_default_pii=False,
        include_local_variables=False,
        max_breadcrumbs=0,
        traces_sample_rate=0,
        before_send=scrub,
    )
    _started = True
    return True


def report_failure(error: BaseException, job_id: str) -> None:
    if not _started:
        return
    with sentry_sdk.new_scope() as scope:
        scope.set_tag("job_id", job_id)
        sentry_sdk.capture_exception(error)
