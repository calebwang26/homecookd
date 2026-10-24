"""Unit tests for the signer's sign-in check, with Convex and Google Cloud faked.

Run: python3 cloud/signer/test_main.py
"""
import io
import json
import os
import sys
import types
import unittest
import urllib.error
from unittest import mock

# main.py builds a storage client and reads env at import; fake both so this runs anywhere.
for name in ("functions_framework", "google", "google.auth", "google.auth.transport",
             "google.auth.transport.requests", "google.api_core", "google.api_core.exceptions",
             "google.cloud", "google.cloud.storage"):
    sys.modules.setdefault(name, types.ModuleType(name))
sys.modules["functions_framework"].http = lambda f: f
sys.modules["google.cloud.storage"].Client = mock.MagicMock
exc = sys.modules["google.api_core.exceptions"]
exc.PreconditionFailed = type("PreconditionFailed", (Exception,), {})
exc.Forbidden = type("Forbidden", (Exception,), {})
sys.modules["google.api_core"].exceptions = exc
sys.modules["google.auth.transport"].requests = sys.modules["google.auth.transport.requests"]
os.environ.update(MEDIA_BUCKET="media", UPLOAD_BUCKET="uploads", FAMILY_CODE="family-code-1234")
sys.path.insert(0, os.path.dirname(__file__))
import main  # noqa: E402

TOKEN = "t" * 43


class Request:
    def __init__(self, headers, body=None):
        self.method, self.headers, self.body = "POST", headers, body or {"action": "delete", "recipe_id": "dal-1"}

    def get_json(self, silent=False):
        return self.body


ME = {"status": "success", "value": {"personId": "p1", "name": "Aai"}}


def convex_answers(body=None, status=200, error=None, owns=None):
    """Fakes Convex: people:me answers `body` (or `status` / `error`); signer:owns answers `owns`."""
    calls = []

    def urlopen(req, timeout):
        assert timeout <= 5
        assert req.full_url == "https://grand-dragon-649.convex.cloud/api/query"
        sent = json.loads(req.data)
        calls.append(sent)
        assert sent["args"]["sessionToken"] == TOKEN and sent["format"] == "json"
        answer = body
        if sent["path"] == "signer:owns":
            answer = {"status": "success", "value": owns}
        else:
            assert sent == {"path": "people:me", "args": {"sessionToken": TOKEN}, "format": "json"}
            if error:
                raise error
            if status >= 400:
                raise urllib.error.HTTPError(req.full_url, status, "err", {}, io.BytesIO(b"{}"))
        res = mock.MagicMock()
        res.__enter__.return_value = io.BytesIO(json.dumps(answer).encode())
        return res
    patch = mock.patch.object(main.urllib.request, "urlopen", side_effect=urlopen)
    patch.calls = calls
    return patch


class AuthTest(unittest.TestCase):
    def setUp(self):
        self.delete = mock.patch.object(main, "_request_delete", return_value=main._json({"ok": True})).start()
        self.cancel = mock.patch.object(main, "_request_cancel", return_value=main._json({"ok": True})).start()
        self.addCleanup(mock.patch.stopall)

    def status(self, headers, body=None):
        return main.create_upload(Request(headers, body))[1]

    def test_own_recipe_and_job_can_be_changed(self):
        fake = convex_answers(ME, owns=True)
        with fake:
            self.assertEqual(self.status({"Authorization": f"Bearer {TOKEN}"}), 200)
            self.assertEqual(self.status({"Authorization": f"Bearer {TOKEN}"}, {"action": "cancel", "job_id": "j1"}), 200)
        owns = [c["args"] for c in fake.calls if c["path"] == "signer:owns"]
        self.assertEqual(owns, [{"sessionToken": TOKEN, "kind": "recipe", "id": "dal-1"},
                                {"sessionToken": TOKEN, "kind": "job", "id": "j1"}])
        self.delete.assert_called_once()
        self.cancel.assert_called_once()

    def test_someone_elses_recipe_or_job_is_403(self):
        for owns in (False, None):
            with convex_answers(ME, owns=owns):
                self.assertEqual(self.status({"Authorization": f"Bearer {TOKEN}"}), 403)
                self.assertEqual(self.status({"Authorization": f"Bearer {TOKEN}"},
                                             {"action": "cancel", "job_id": "j1"}), 403)
        self.delete.assert_not_called()
        self.cancel.assert_not_called()

    def test_a_signed_in_phone_can_create_an_upload(self):
        body = {"title": "Dal", "cook_name": "Aai", "relation": "grandma",
                "files": [{"content_type": "video/quicktime", "size": 10, "duration_s": 5}]}
        with convex_answers(ME), mock.patch.object(sys.modules["google.auth"], "default", create=True,
                                                   side_effect=RuntimeError("no gcp here")):
            # Past the sign-in check, so it fails at signing (502), not at auth.
            self.assertEqual(self.status({"Authorization": f"Bearer {TOKEN}"}, body), 502)

    def test_signed_out_session_is_401(self):
        with convex_answers({"status": "error", "errorData": "This phone was signed out."}):
            self.assertEqual(self.status({"Authorization": f"Bearer {TOKEN}"}), 401)
        with convex_answers(status=400):
            self.assertEqual(self.status({"Authorization": f"Bearer {TOKEN}"},
                                         {"action": "cancel", "job_id": "j1"}), 401)
        self.delete.assert_not_called()
        self.cancel.assert_not_called()

    def test_convex_down_is_502_not_signed_out(self):
        for kw in ({"status": 503}, {"error": TimeoutError()}, {"error": urllib.error.URLError("dns")}):
            with convex_answers(**kw):
                self.assertEqual(self.status({"Authorization": f"Bearer {TOKEN}"}), 502)

    def test_family_code_still_works_without_convex(self):
        with mock.patch.object(main.urllib.request, "urlopen") as urlopen:
            self.assertEqual(self.status({"X-Edible-Family": "family-code-1234"}), 200)
            urlopen.assert_not_called()

    def test_nothing_or_a_wrong_code_is_refused(self):
        self.assertEqual(self.status({}), 403)
        self.assertEqual(self.status({"X-Edible-Family": "wrong"}), 403)
        self.assertEqual(self.status({"Authorization": "Bearer short"}), 401)

    def test_empty_family_code_env_turns_the_code_path_off(self):
        with mock.patch.object(main, "FAMILY_CODE", ""):
            self.assertEqual(self.status({"X-Edible-Family": ""}), 403)

    def test_uploads_need_auth_too(self):
        body = {"title": "Dal", "cook_name": "Aai", "relation": "grandma",
                "files": [{"content_type": "video/quicktime", "size": 10, "duration_s": 5}]}
        self.assertEqual(self.status({}, body), 403)


if __name__ == "__main__":
    unittest.main()
