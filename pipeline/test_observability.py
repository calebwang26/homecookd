"""The worker's Sentry: off on the laptop, and no family text in what it sends."""
import os
import sys

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
    test_scrub_drops_text()
    print("ok")
