"""Tests for the purge of a deleted account outside Convex (pipeline/account_purge.py) and the worker's
/worker/deletions/* calls (pipeline/worker.py).

    .venv/bin/python pipeline/test_account_purge.py        # plain runner (pytest is not in the venv)

No network: GCS, Supabase, Cartesia and Convex are small fakes.
"""
from __future__ import annotations

import contextlib
import io
import re
import sys
import tempfile
import traceback
from pathlib import Path
from types import SimpleNamespace

ROOT = Path(__file__).resolve().parent.parent
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

from google.api_core.exceptions import NotFound  # noqa: E402

from pipeline import account_purge as ap  # noqa: E402
from pipeline import worker  # noqa: E402

P = "0b7c2a8e-5f1d-4c3b-9a6e-2d8f4e1a7c90"
F = "9e1d3c5b-7a2f-4e8d-b6c1-0f3a5d7e9b24"
JOB = "jd7abc123def456ghi789jkl012mno34"  # a Convex job id
FOLDER = worker._convex_recipe_id({"jobId": JOB, "uploadPath": "her-upload-abc123/"})
MEDIA, UPLOADS = "edible-media", "edible-uploads"
GCS = f"https://storage.googleapis.com/{MEDIA}"


class FakeBlob:
    def __init__(self, bucket: FakeBucket, name: str, text: str = ""):
        self.bucket, self.name, self.text = bucket, name, text

    def delete(self) -> None:
        if self.bucket.blobs.pop(self.name, None) is None:
            raise NotFound(self.name)

    def download_as_text(self) -> str:
        if self.name not in self.bucket.blobs:
            raise NotFound(self.name)
        return self.text


class FakeBucket:
    def __init__(self, name: str, names: list[str], texts: dict[str, str] | None = None):
        self.name = name
        self.blobs = {n: FakeBlob(self, n, (texts or {}).get(n, "")) for n in names}
        self.client = SimpleNamespace(list_blobs=lambda _b, prefix: [b for n, b in sorted(self.blobs.items())
                                                                     if n.startswith(prefix)])

    def get_blob(self, name: str):
        return self.blobs.get(name)

    def blob(self, name: str):
        return self.blobs.get(name) or FakeBlob(self, name)


def deletion(**extra) -> dict:
    return {
        "deletionId": "del1", "requestedAt": 1_792_900_000_000, "attempts": 0,
        "supabaseProfileId": P, "supabaseFamilyId": F, "recipeIds": ["r1"], "jobIds": [JOB],
        "uploadPaths": ["her-upload-abc123/", "glasses/rec1.mp4", "/", "../escape/", "jobs/"],
        "mediaUrls": [
            f"{GCS}/oatmeal-5372a0/recipe.json",  # a recipe from an older-style upload path
            f"{GCS}/oatmeal-5372a0/poster.jpg?v=1712",
            f"{GCS}/glasses-rec1/full.mp4",  # the laptop bridge's full glasses video
            "https://storage.googleapis.com/someone-elses-bucket/x.jpg",
            f"https://example.com/{MEDIA}/y.jpg",
            f"{GCS}/library.json",
            "https://homecookd.app/media/stock/dal.jpg",
        ],
        **extra,
    }


def buckets(library: str = "[]") -> tuple[FakeBucket, FakeBucket]:
    media = FakeBucket(MEDIA, [
        f"{FOLDER}/recipe.json", f"{FOLDER}/play.mp4", f"{FOLDER}/steps/1.jpg", f"trash/{FOLDER}/poster.jpg",
        "oatmeal-5372a0/recipe.json", "oatmeal-5372a0/play.mp4", "jobs/her-upload-abc123.json", "glasses-rec1/full.mp4",
        # Not hers:
        "recipe-otherjob1234/recipe.json", "poha/recipe.json", "jobs/someone-else.json", "trash/poha/play.mp4",
        "glasses-rec2/full.mp4", f"{FOLDER}x/recipe.json", "library.json",
    ], {"library.json": library})
    uploads = FakeBucket(UPLOADS, [
        "her-upload-abc123/00.mov", "her-upload-abc123/01.mov", "glasses/rec1.mp4",
        # Not hers: a folder whose name starts with hers, the glasses file beside hers, another family's upload.
        "her-upload-abc1234/00.mov", "glasses/rec10.mp4", "glasses/rec2.mp4", "someone-else/00.mov",
    ])
    return media, uploads


def quiet(fn, *args, **kw):
    out = io.StringIO()
    with contextlib.redirect_stdout(out):
        result = fn(*args, **kw)
    return result, out.getvalue()


# ---------- GCS ----------

def test_recipe_folder_named_as_the_worker_names_it():
    assert FOLDER.startswith("recipe-") and len(FOLDER) == len("recipe-") + 12
    assert ap.recipe_folders({"jobIds": [JOB], "mediaUrls": []}, MEDIA) == [FOLDER]


def test_gcs_deletes_only_her_objects():
    media, uploads = buckets()
    counts, _ = quiet(ap.purge_gcs, deletion(), media, uploads, False)
    assert set(media.blobs) == {"glasses-rec2/full.mp4", "jobs/someone-else.json", "library.json", "poha/recipe.json",
                                "recipe-otherjob1234/recipe.json", f"{FOLDER}x/recipe.json", "trash/poha/play.mp4"}
    assert set(uploads.blobs) == {"glasses/rec10.mp4", "glasses/rec2.mp4", "her-upload-abc1234/00.mov", "someone-else/00.mov"}
    assert counts["gcsObjects"] == 11


def test_gcs_never_widens_odd_paths():
    folders, objects = ap.upload_targets({"uploadPaths": ["her-upload-abc123/", "glasses/rec1.mp4", "a/b/", "jobs/",
                                                          "trash", "/", "", "../x/", "Upper/"]})
    assert folders == ["her-upload-abc123"]  # one-segment upload folders only, and never the bucket's own
    assert objects == ["Upper", "a/b", "glasses/rec1.mp4", "her-upload-abc123", "jobs", "trash"]
    assert ap.media_objects(deletion(), {MEDIA, UPLOADS}) == [
        (MEDIA, "glasses-rec1/full.mp4"), (MEDIA, "oatmeal-5372a0/poster.jpg"), (MEDIA, "oatmeal-5372a0/recipe.json")]
    assert ap.recipe_folders({"jobIds": [], "mediaUrls": [f"{GCS}/trash/recipe.json", f"{GCS}/jobs/recipe.json"]},
                             MEDIA) == []


def test_gcs_dry_run_deletes_nothing_and_a_second_run_finds_nothing():
    media, uploads = buckets()
    before = (sorted(media.blobs), sorted(uploads.blobs))
    counts, out = quiet(ap.purge_gcs, deletion(), media, uploads, True)
    assert (sorted(media.blobs), sorted(uploads.blobs)) == before and counts["gcsObjects"] == 11
    assert f"would delete gs://{UPLOADS}/her-upload-abc123/00.mov" in out
    quiet(ap.purge_gcs, deletion(), media, uploads, False)
    again, _ = quiet(ap.purge_gcs, deletion(), media, uploads, False)
    assert again["gcsObjects"] == 0


def test_library_rebuilt_only_when_it_lists_her_recipe():
    calls = []
    saved = ap.publish.rebuild_library
    ap.publish.rebuild_library = lambda bucket: calls.append(bucket.name)
    try:
        quiet(ap.purge_gcs, deletion(), *buckets('[{"id": "poha"}]'), False)
        assert calls == []
        quiet(ap.purge_gcs, deletion(), *buckets(f'[{{"id": "poha"}}, {{"id": "{FOLDER}"}}]'), False)
        assert calls == [MEDIA]
    finally:
        ap.publish.rebuild_library = saved


def test_local_copies_go_but_the_spend_tally():
    saved = ap.INPUT, ap.publish.OUT
    with tempfile.TemporaryDirectory() as tmp:
        ap.INPUT, ap.publish.OUT = Path(tmp) / "input", Path(tmp) / "out"
        try:
            for path in (ap.INPUT / "her-upload-abc123" / "00.mov", ap.publish.OUT / FOLDER / "play.mp4",
                         ap.publish.OUT / FOLDER / "work" / "usage.json", ap.publish.OUT / "poha" / "play.mp4"):
                path.parent.mkdir(parents=True, exist_ok=True)
                path.write_text("x")
            counts, _ = quiet(ap.purge_gcs, deletion(), *buckets(), False)
            assert counts["localFolders"] == 2
            assert not (ap.INPUT / "her-upload-abc123").exists()
            assert [p.name for p in (ap.publish.OUT / FOLDER).rglob("*") if p.is_file()] == ["usage.json"]
            assert (ap.publish.OUT / "poha" / "play.mp4").exists()
        finally:
            ap.INPUT, ap.publish.OUT = saved


# ---------- Supabase SQL ----------

def test_only_a_uuid_goes_into_the_sql():
    assert ap.sql_uuid(P.upper()) == f"'{P}'::uuid"
    for bad in ("", "test:Shreya", "seed:mom", f"{P}'; drop table public.profiles; --", f"{P}0", P[:-1], f"x{P}",
                P.replace("-", "")):
        try:
            ap.purge_sql(bad, F)
        except ValueError:
            pass
        else:
            raise AssertionError(f"accepted {bad!r}")
    for fn in (ap.purge_sql, ap.plan_sql):
        try:
            fn(P, "test:family")
        except ValueError:
            pass
        else:
            raise AssertionError("a family id that isn't a uuid must be refused")


def test_purge_sql_is_one_guarded_statement_over_her_rows_only():
    sql = ap.purge_sql(P, F)
    assert sql.startswith("do $purge$") and sql.endswith("$purge$;")
    assert f"if exists (select 1 from public.profiles where id = '{P}'::uuid and family_id <> '{F}'::uuid) then" in sql
    # Nothing but her id, her family's id and SQL: no other value is ever put into it.
    assert set(re.findall(r"'([^']*)'", sql)) == {P, F, "pair", "this profile is in another family"}
    statements = [s.strip() for s in sql.split("begin\n", 1)[1].split("\n") if s.strip().startswith(("delete", "update"))]
    assert len(statements) == len(ap.ROWS)
    for s in statements:  # each one only touches rows tied to her
        assert re.search(rf"where .*('{P}'::uuid|v_doomed|v_pairs)", s), s
    for expected in (
        "update public.messages set reply_to = null where reply_to = any(v_doomed);",
        f"delete from public.recipe_notes where answer_message_id = any(v_doomed) or answered_by = '{P}'::uuid;",
        f"update public.recipe_notes set asked_by = null, question = null where asked_by = '{P}'::uuid;",
        "delete from public.messages where id = any(v_doomed);",
        "delete from public.threads where id = any(v_pairs);",
        f"delete from public.identities where profile_id = '{P}'::uuid;",
        f"update public.pending_sends set recipient_ids = array_remove(recipient_ids, '{P}'::uuid) "
        f"where '{P}'::uuid = any(recipient_ids);",
        f"update public.devices set profile_id = null, revoked_at = coalesce(revoked_at, now()) where profile_id = '{P}'::uuid;",
    ):
        assert expected in statements, expected
    order = [s.split(" where ")[0] for s in statements]
    assert order.index("update public.messages set reply_to = null") < order.index("delete from public.messages")
    assert order.index("delete from public.messages") < order.index("delete from public.threads")
    assert order[-1] == "delete from public.profiles"
    assert f"v_pairs uuid[] := array(select id from public.threads where kind = 'pair' and '{P}'::uuid in (a_profile, b_profile));" in sql
    assert "storage." not in sql  # Storage files go through the Storage API


def test_plan_sql_only_reads():
    sql = ap.plan_sql(P, F)
    assert sql.startswith("select json_build_object(")
    assert not re.search(r"\b(delete|update|insert|drop|alter)\b", sql)
    for table, change, _ in ap.ROWS:
        assert f"'{ap.row_label(table, change)}', (select count(*) from public.{table} where " in sql
    assert "'voice', array(select audio_path from public.messages" in sql and "hello_path" in sql
    assert "'photos', array(select photo_path from public.messages" in sql


# ---------- Supabase calls ----------

class Res:
    def __init__(self, status: int = 200, body=None, text: str = ""):
        self.status_code, self.body, self.text = status, body, text
        self.ok = status < 400

    def json(self):
        return self.body


class FakeHttp:
    """Answers like the Supabase management + Storage APIs and Cartesia, and records every call."""

    def __init__(self, plan: dict | None = None, sql_status: int = 201, voice_status: int = 204):
        self.calls: list[tuple[str, str, dict]] = []
        self.plan, self.sql_status, self.voice_status = plan or PLAN, sql_status, voice_status

    def post(self, url, **kw):
        self.calls.append(("POST", url, kw))
        if kw["json"]["read_only"]:
            return Res(201, [{"plan": self.plan}])
        return Res(self.sql_status, [], text="boom near sk_mgmt_TOKEN")

    def get(self, url, **kw):
        self.calls.append(("GET", url, kw))
        return Res(200, [{"name": "anon", "api_key": "anon-key", "type": "legacy"},
                         {"name": "service_role", "api_key": "SERVICE-ROLE-KEY", "type": "legacy"}])

    def delete(self, url, **kw):
        self.calls.append(("DELETE", url, kw))
        if "api.cartesia.ai" in url:
            return Res(self.voice_status, text="" if self.voice_status < 400 else "nope")
        return Res(200, [{"name": p} for p in kw["json"]["prefixes"]])


PLAN = {
    "counts": {"messages": 3, "messages.reply_to": 1, "profiles": 1, "identities": 1, "threads": 0},
    "voice": [f"{F}/11111111-2222-3333-4444-555555555555.m4a", "../../secrets.txt"],
    "photos": [f"{F}/66666666-7777-8888-9999-000000000000.jpg"],
    "elsewhere": False,
}


def test_supabase_skipped_without_a_supabase_profile():
    http = FakeHttp()
    for pid in ("", "test:Shreya", "seed:mom"):
        counts, _ = quiet(ap.purge_supabase, deletion(supabaseProfileId=pid), ap.Supabase("sk_mgmt_TOKEN", http=http), False)
        assert counts == {}
    assert http.calls == []


def test_supabase_files_then_rows_with_the_key_kept_quiet():
    http = FakeHttp()
    counts, out = quiet(ap.purge_supabase, deletion(), ap.Supabase("sk_mgmt_TOKEN", http=http), False)
    kinds = [(m, url.split("/v1/")[-1].split("?")[0]) for m, url, _ in http.calls]
    assert kinds == [
        ("POST", f"projects/{ap.SUPABASE_REF}/database/query"),  # the read-only plan
        ("GET", f"projects/{ap.SUPABASE_REF}/api-keys"),
        ("DELETE", "object/voice"),
        ("DELETE", "object/photos"),
        ("POST", f"projects/{ap.SUPABASE_REF}/database/query"),  # the purge
    ]
    plan, keys, voice, photos, purge = (kw for _, _, kw in http.calls)
    assert plan["json"]["read_only"] is True and plan["json"]["query"] == ap.plan_sql(P, F)
    assert keys["params"] == {"reveal": "true"} and keys["headers"]["Authorization"] == "Bearer sk_mgmt_TOKEN"
    assert voice["json"] == {"prefixes": [f"{F}/11111111-2222-3333-4444-555555555555.m4a"]}  # the odd path stays
    assert voice["headers"] == {"apikey": "SERVICE-ROLE-KEY", "Authorization": "Bearer SERVICE-ROLE-KEY"}
    assert http.calls[2][1] == f"https://{ap.SUPABASE_REF}.supabase.co/storage/v1/object/voice"
    assert purge["json"] == {"query": ap.purge_sql(P, F), "read_only": False}
    assert counts == {"supabaseRows": 5, "supabaseUpdated": 1, "supabaseFiles": 2}
    assert "SERVICE-ROLE-KEY" not in out and "sk_mgmt_TOKEN" not in out


def test_supabase_dry_run_only_reads():
    http = FakeHttp()
    counts, out = quiet(ap.purge_supabase, deletion(), ap.Supabase("sk_mgmt_TOKEN", http=http), True)
    assert [m for m, _, _ in http.calls] == ["POST"] and http.calls[0][2]["json"]["read_only"] is True
    assert counts["supabaseFiles"] == 2 and "would delete 2 file(s)" in out


def test_supabase_refuses_a_profile_in_another_family():
    http = FakeHttp(plan={**PLAN, "elsewhere": True})
    try:
        quiet(ap.purge_supabase, deletion(), ap.Supabase("sk_mgmt_TOKEN", http=http), False)
    except ap.PurgeError as e:
        assert "another family" in str(e)
    else:
        raise AssertionError("a profile in another family must not be purged")
    assert [m for m, _, _ in http.calls] == ["POST"]


# ---------- Cartesia ----------

def test_cartesia_deletes_the_clone_and_404_counts_as_done():
    http = FakeHttp()
    counts, _ = quiet(ap.purge_voice, deletion(voiceCloneId="a1b2c3d4-e5f6"), "car-key", False, http)
    method, url, kw = http.calls[0]
    assert (method, url) == ("DELETE", "https://api.cartesia.ai/voices/a1b2c3d4-e5f6") and counts == {"voiceClones": 1}
    assert kw["headers"] == {"Authorization": "Bearer car-key", "Cartesia-Version": "2026-08-14"}
    gone, out = quiet(ap.purge_voice, deletion(voiceCloneId="a1b2c3d4-e5f6"), "car-key", False, FakeHttp(voice_status=404))
    assert gone == {"voiceClones": 0} and "already gone" in out
    for bad, why in ((FakeHttp(voice_status=500), "HTTP 500"), (FakeHttp(), "isn't a Cartesia id")):
        try:
            vid = "a1b2c3d4" if why == "HTTP 500" else "../../voices"
            quiet(ap.purge_voice, deletion(voiceCloneId=vid), "car-key", False, bad)
        except ap.PurgeError as e:
            assert why in str(e)
        else:
            raise AssertionError(why)


def test_cartesia_nothing_to_do_or_dry_run_calls_nothing():
    http = FakeHttp()
    assert quiet(ap.purge_voice, deletion(), "car-key", False, http)[0] == {}
    assert quiet(ap.purge_voice, deletion(voiceCloneId="v1"), None, True, http)[0] == {"voiceClones": 1}
    assert http.calls == []


# ---------- reporting ----------

class FakeConvex:
    def __init__(self, rows: list[dict]):
        self.rows, self.asked, self.reports = rows, [], []

    def next_deletion(self, exclude: list[str]):
        self.asked.append(list(exclude))
        return next((r for r in self.rows if r["deletionId"] not in exclude), None)

    def deletion_done(self, deletion_id, ok, error, counts):
        self.reports.append((deletion_id, ok, error, counts))
        return "done" if ok else "retry"


def run_with(rows, http, dry_run=False, env=None):
    """run_pending with these keys only, and this machine's folders swapped for empty temporary ones."""
    convex, (media, uploads) = FakeConvex(rows), buckets()
    saved_env, saved_dirs = dict(ap.os.environ), (ap.INPUT, ap.publish.OUT)
    for k in ("SUPABASE_ACCESS_TOKEN", "CARTESIA_API_KEY"):
        ap.os.environ.pop(k, None)
    ap.os.environ.update(env if env is not None else {"SUPABASE_ACCESS_TOKEN": "sk_mgmt_TOKEN", "CARTESIA_API_KEY": "car-key"})
    with tempfile.TemporaryDirectory() as tmp:
        ap.INPUT, ap.publish.OUT = Path(tmp) / "input", Path(tmp) / "out"
        try:
            _, out = quiet(ap.run_pending, convex, media, uploads, dry_run, http)
        finally:
            ap.os.environ.clear()
            ap.os.environ.update(saved_env)
            ap.INPUT, ap.publish.OUT = saved_dirs
    return convex, media, uploads, out


def test_each_deletion_reported_done_or_failed_without_secrets():
    ok = deletion(voiceCloneId="v1")
    no_profile = deletion(deletionId="del2", supabaseProfileId="test:Leo", jobIds=[], uploadPaths=[], mediaUrls=[])
    convex, media, _, out = run_with([ok, no_profile], FakeHttp())
    assert convex.asked == [[], ["del1"], ["del1", "del2"]]
    (id1, ok1, err1, counts1), (id2, ok2, err2, counts2) = convex.reports
    assert (id1, ok1, err1) == ("del1", True, None)
    assert counts1 == {"gcsObjects": 11, "localFolders": 0, "supabaseRows": 5, "supabaseUpdated": 1, "supabaseFiles": 2,
                       "voiceClones": 1}
    assert (id2, ok2, err2, counts2) == ("del2", True, None, {"gcsObjects": 0, "localFolders": 0})
    assert "jobs/her-upload-abc123.json" not in media.blobs

    # The SQL fails (its error text even quotes the token): reported as failed, with the other parts still done.
    convex, media, _, out = run_with([deletion(voiceCloneId="v1")], FakeHttp(sql_status=500))
    [(_, ok, error, counts)] = convex.reports
    assert not ok and error.startswith("Supabase: Supabase SQL: HTTP 500") and "sk_mgmt_TOKEN" not in error
    assert "sk_mgmt_TOKEN" not in out and "SERVICE-ROLE-KEY" not in out
    assert counts["voiceClones"] == 1 and f"{FOLDER}/play.mp4" not in media.blobs

    # No keys at all: GCS still goes; Supabase and Cartesia say what's missing.
    convex, _, _, _ = run_with([deletion(voiceCloneId="v1")], FakeHttp(), env={})
    [(_, ok, error, _)] = convex.reports
    assert not ok and "SUPABASE_ACCESS_TOKEN is not set" in error and "CARTESIA_API_KEY is not set" in error


def test_dry_run_reports_nothing_and_deletes_nothing():
    http = FakeHttp()
    convex, media, uploads, out = run_with([deletion(voiceCloneId="v1")], http, dry_run=True)
    assert convex.reports == [] and [m for m, _, _ in http.calls] == ["POST"]
    assert sorted(media.blobs) == sorted(buckets()[0].blobs) and sorted(uploads.blobs) == sorted(buckets()[1].blobs)
    assert "DRY RUN" in out and "would report: ok" in out
    assert "nothing pending" in run_with([], http, dry_run=True)[3]


def test_worker_convex_client_routes():
    sent = []

    class Session:
        headers: dict = {}

        def post(self, url, json, timeout):
            sent.append((url, json))
            if url.endswith("/next"):
                return Res(204) if json["exclude"] else Res(200, {"deletionId": "del1"})
            return Res(200, {"status": "retry"})

    convex = worker.Convex("https://x.convex.site/", "secret")
    convex.session = Session()
    assert convex.next_deletion([]) == {"deletionId": "del1"}
    assert convex.next_deletion(["del1"]) is None
    assert convex.deletion_done("del1", False, "GCS: boom", {"gcsObjects": 2}) == "retry"
    assert sent[-1] == ("https://x.convex.site/worker/deletions/done",
                        {"deletionId": "del1", "ok": False, "counts": {"gcsObjects": 2}, "error": "GCS: boom"})
    assert convex.deletion_done("del1", True, None, {}) == "retry" and "error" not in sent[-1][1]


def main() -> None:
    tests = [(n, f) for n, f in globals().items() if n.startswith("test_") and callable(f)]
    failed = 0
    for name, fn in tests:
        try:
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
