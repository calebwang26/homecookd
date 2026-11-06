"""The worker's Sentry: off on the laptop, and no family text in what it sends."""
import os
import sys
import types

sys.path.insert(0, os.path.dirname(__file__))
import observability


def test_off_without_deploy_env():
    os.environ["SENTRY_DSN_WORKER"] = "https://k@example.ingest.us.sentry.io/1"
    os.environ.pop("DEPLOY_ENV", None)
    assert observability.init_sentry() is False


def test_off_without_dsn():
    os.environ.pop("SENTRY_DSN_WORKER", None)
    os.environ["DEPLOY_ENV"] = "staging"
    assert observability.init_sentry() is False


def test_report_does_nothing_until_started():
    real_sdk, observability.sentry_sdk = observability.sentry_sdk, None  # as on the laptop: reaching for it would raise
    try:
        assert observability.report_failure(ValueError("she said"), "job") is None
        os.environ["SENTRY_DSN_WORKER"] = "https://k@example.ingest.us.sentry.io/1"
        os.environ["DEPLOY_ENV"] = "staging"
        assert observability.init_sentry() is False
        assert observability.report_failure(ValueError("she said"), "job") is None
    finally:
        observability.sentry_sdk = real_sdk
        os.environ.pop("SENTRY_DSN_WORKER", None)
        os.environ.pop("DEPLOY_ENV", None)


def test_reports_once_started():
    captured, tags, inits = [], [], []

    class Scope:
        def __enter__(self):
            return self

        def __exit__(self, *_):
            return False

        def set_tag(self, key, value):
            tags.append((key, value))

    fake = types.SimpleNamespace(init=lambda **k: inits.append(k), new_scope=Scope, capture_exception=captured.append)
    real_sdk, observability.sentry_sdk = observability.sentry_sdk, fake
    try:
        os.environ["SENTRY_DSN_WORKER"] = "https://k@example.ingest.us.sentry.io/1"
        os.environ["DEPLOY_ENV"] = "staging"
        assert observability.init_sentry() is True
        error = ValueError("she said")
        observability.report_failure(error, "job-1")
    finally:
        observability.sentry_sdk = real_sdk
        observability._started = False
        os.environ.pop("SENTRY_DSN_WORKER", None)
        os.environ.pop("DEPLOY_ENV", None)
    assert captured == [error] and tags == [("job_id", "job-1")]
    assert inits[0]["send_default_pii"] is False and inits[0]["before_send"] is observability.scrub


def test_scrub_drops_text():
    event = {
        "exception": {"values": [{"type": "ValueError", "value": "she said: add the secret masala"}]},
        "message": "she said",
        "logentry": {"message": "she said"},
        "user": {"id": "x"},
        "request": {"url": "u"},
    }
    out = observability.scrub(event, {})
    assert out["exception"]["values"][0] == {"type": "ValueError", "value": ""}
    for key in ("message", "logentry", "user", "request"):
        assert key not in out


if __name__ == "__main__":
    test_off_without_deploy_env()
    test_off_without_dsn()
    test_report_does_nothing_until_started()
    test_reports_once_started()
    test_scrub_drops_text()
    print("ok")
