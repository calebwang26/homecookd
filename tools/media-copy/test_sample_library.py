"""The sample library (sample_library.py), with fake GCS and S3 (fakes.py). No network, no cloud, no real data.

    python tools/media-copy/test_sample_library.py
"""
from __future__ import annotations

import io
import json
import shutil
import sys
import tempfile
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))

import sample_library as sl  # noqa: E402
from fakes import FakeGcs, FakeS3  # noqa: E402

S3 = "homecookd-test-media-1"
G = "edible-media-379797517579"
BASE = "https://media.example.test"
LOCAL = ["--gcs-endpoint", "http://localhost:4443", "--s3-endpoint", "http://localhost:9000"]
GCS_URL = f"https://storage.googleapis.com/{G}"


def sample(recipe_id: str, **extra) -> dict:
    return {"id": recipe_id, "title": f"The {recipe_id}", "cook": {"name": "Dad", "relation": "Dad"}, "intro": "", "sample": True,
            "tags": ["x"], "media": {"video_url": None, "audio_url": None, "poster_url": None, "duration_s": 600},
            "ingredients": [], "steps": [{"order": 1, "title": "Stir", "instruction": "Stir it.", "sensory_cue": "thick",
                                          "quote": None, "wait_after": None, "start_s": 0, "end_s": 60, "image_url": None}], **extra}


class Base(unittest.TestCase):
    def setUp(self):
        self.dir = Path(tempfile.mkdtemp(prefix="sample-library-test-"))
        self.addCleanup(shutil.rmtree, self.dir)
        self.synthetic = self.dir / "synthetic"
        (self.synthetic / "posters").mkdir(parents=True)
        self.add_repo_sample("dad-chili", poster=b"chili photo")
        self.add_repo_sample("auntie-pancakes", cook={"name": "Auntie Lin", "relation": "Aunt"})
        self.gcs, self.s3 = FakeGcs(), FakeS3()
        self.out, self.err = io.StringIO(), io.StringIO()

    def add_repo_sample(self, recipe_id: str, poster: bytes | None = None, **extra) -> None:
        (self.synthetic / f"{recipe_id}.json").write_text(json.dumps(sample(recipe_id, **extra)))
        if poster:
            (self.synthetic / "posters" / f"{recipe_id}.jpg").write_bytes(poster)

    def add_gcs_sample(self, recipe_id: str, **extra) -> dict:
        """A video sample as publish.py leaves it on GCS, with a stray file in its folder that it doesn't link to."""
        gen = {}
        for name, data, ctype in (("play.mp4", b"video bytes" * 100, "video/mp4"), ("voice.m4a", b"voice", "audio/mp4"),
                                  ("poster.jpg", b"poster", "image/jpeg"), ("steps/01.jpg", b"still", "image/jpeg"),
                                  ("work/frames.json", b"not linked", "application/json")):
            gen[name] = self.gcs.put(G, f"{recipe_id}/{name}", data, content_type=ctype, cache_control="public, max-age=3600")
        link = lambda n: f"{GCS_URL}/{recipe_id}/{n}?v={gen[n]}"  # noqa: E731
        doc = sample(recipe_id, source="Someone (YouTube)", **extra)
        doc["media"] = {"video_url": link("play.mp4"), "audio_url": link("voice.m4a"), "poster_url": link("poster.jpg"),
                        "duration_s": 600, "width": 1280, "height": 720}
        doc["steps"][0]["image_url"] = link("steps/01.jpg")
        self.gcs.put(G, f"{recipe_id}/recipe.json", json.dumps(doc).encode(), content_type="application/json")
        return gen

    def assertRefused(self, code: int, words: str):
        self.assertEqual(code, 2, self.err.getvalue())
        self.assertIn(words, self.err.getvalue())

    def run_tool(self, *argv: str) -> int:
        self.out, self.err = io.StringIO(), io.StringIO()
        return sl.main(["--to", S3, "--media-base", BASE, *argv], make_stores=lambda args: (self.gcs, self.s3),
                       out=self.out, err=self.err, synthetic=self.synthetic)

    def result(self) -> dict:
        return json.loads(self.out.getvalue())

    def s3_json(self, key: str):
        data = self.s3.current(S3, key)
        return None if data is None else json.loads(data)

    def s3_keys(self) -> list[str]:
        return [k for k, _ in self.s3.list_keys(S3)]


class DryRun(Base):
    def test_touches_nothing_and_shows_the_library(self):
        self.assertEqual(self.run_tool(*LOCAL), 0, self.err.getvalue())
        self.assertEqual(self.s3.faults.calls, {})
        r = self.result()
        self.assertIn("dry run", r["mode"])
        self.assertEqual([e["id"] for e in r["library_json"]], ["auntie-pancakes", "dad-chili"])  # by cook, then title
        chili = next(e for e in r["library_json"] if e["id"] == "dad-chili")
        self.assertEqual(chili["recipe_url"], f"{BASE}/dad-chili/recipe.json")
        self.assertTrue(chili["poster_url"].startswith(f"{BASE}/dad-chili/poster.jpg?v="))
        self.assertIsNone(next(e for e in r["library_json"] if e["id"] == "auntie-pancakes")["poster_url"])

    def test_out_writes_the_built_files_for_reading(self):
        out = self.dir / "out"
        self.assertEqual(self.run_tool(*LOCAL, "--out", str(out)), 0, self.err.getvalue())
        self.assertEqual(len(json.loads((out / "library.json").read_text())), 2)
        self.assertTrue((out / "dad-chili" / "recipe.json").exists())
        self.assertFalse((out / "dad-chili" / "poster.jpg").exists())  # only what was built, not copies of media

    def test_the_repos_own_samples_build_and_pass_the_schema(self):
        out, err = io.StringIO(), io.StringIO()
        code = sl.main(["--to", S3, "--media-base", BASE, *LOCAL], make_stores=lambda a: (None, None), out=out, err=err)
        self.assertEqual(code, 0, err.getvalue())
        r = json.loads(out.getvalue())
        self.assertEqual(len(r["library_json"]), len(list(sl.SYNTHETIC.glob("*.json"))))
        self.assertTrue(all(e["sample"] and e["poster_url"] for e in r["library_json"]))
        self.assertNotIn("storage.googleapis.com", out.getvalue())
        self.assertTrue(all(v in ("ok", "not checked (no pydantic)") for v in r["schema"].values()))


class Write(Base):
    def test_writes_media_then_recipes_then_library(self):
        order = []
        put = self.s3.put
        self.s3.put = lambda b, k, *a: (order.append(k), put(b, k, *a))[1]
        self.assertEqual(self.run_tool(*LOCAL, "--write"), 0, self.err.getvalue())
        self.assertEqual(order[0], "dad-chili/poster.jpg")
        self.assertEqual(order[-1], "library.json")
        self.assertEqual(self.s3.current(S3, "dad-chili/poster.jpg"), b"chili photo")
        library = self.s3_json("library.json")
        for e in library:  # every link it names is there
            self.assertIsNotNone(self.s3_json(e["recipe_url"].removeprefix(f"{BASE}/")))
        recipe = self.s3_json("dad-chili/recipe.json")
        self.assertEqual(recipe["media"]["poster_url"], library[1]["poster_url"])
        head = self.s3.head(S3, "library.json")
        self.assertEqual(head.meta, sl.MARK)
        self.assertEqual(head.headers["cache_control"], "no-cache, max-age=0")
        self.assertEqual(self.s3.head(S3, "dad-chili/poster.jpg").headers["content_type"], "image/jpeg")

    def test_a_second_run_changes_nothing(self):
        self.assertEqual(self.run_tool(*LOCAL, "--write"), 0)
        puts = self.s3.puts
        self.assertEqual(self.run_tool(*LOCAL, "--write"), 0)
        self.assertEqual(self.s3.puts, puts)
        self.assertEqual(self.result()["written"], [])

    def test_a_changed_poster_gets_a_new_link(self):
        self.run_tool(*LOCAL, "--write")
        old = self.s3_json("library.json")[1]["poster_url"]
        (self.synthetic / "posters" / "dad-chili.jpg").write_bytes(b"a better photo")
        self.assertEqual(self.run_tool(*LOCAL, "--write"), 0)
        self.assertEqual(sorted(self.result()["written"]), ["dad-chili/poster.jpg", "dad-chili/recipe.json", "library.json"])
        self.assertNotEqual(self.s3_json("library.json")[1]["poster_url"], old)

    def test_never_replaces_a_file_it_didnt_write(self):
        self.s3.put(S3, "dad-chili/recipe.json", b"someone else's", {}, {}, sl.crc32c(b"someone else's"))
        puts = self.s3.puts
        self.assertEqual(self.run_tool(*LOCAL, "--write"), 2)
        self.assertIn("didn't write it", self.err.getvalue())
        self.assertEqual(self.s3.puts, puts)  # refused before the first write

    def test_a_failed_media_write_leaves_library_json_unwritten(self):
        self.s3.faults.deny.add("put")
        self.assertEqual(self.run_tool(*LOCAL, "--write"), 3)
        self.assertIn("denied", self.err.getvalue())
        self.assertIsNone(self.s3.current(S3, "library.json"))


class Guard(Base):
    def test_a_real_bucket_needs_its_flag_to_write(self):
        self.assertRefused(self.run_tool("--write"), sl.WRITE_FLAG)
        self.assertEqual(self.s3.faults.calls, {})
        self.assertEqual(self.run_tool("--write", sl.WRITE_FLAG), 0, self.err.getvalue())
        self.assertIsNotNone(self.s3.current(S3, "library.json"))

    def test_a_real_bucket_dry_run_needs_no_flag(self):
        self.assertEqual(self.run_tool(), 0, self.err.getvalue())

    def test_repo_samples_may_go_to_staging(self):
        code = sl.main(["--to", "homecookd-staging-media-1", "--media-base", BASE, "--write", sl.WRITE_FLAG],
                       make_stores=lambda a: (None, self.s3), out=self.out, err=self.err, synthetic=self.synthetic)
        self.assertEqual(code, 0, self.err.getvalue())

    def test_bad_addresses_and_buckets(self):
        self.assertRefused(sl.main(["--to", S3, "--media-base", "http://media.example.test"], make_stores=None, err=self.err), "https")
        self.err = io.StringIO()
        self.assertRefused(sl.main(["--to", S3, "--media-base", GCS_URL], make_stores=None, err=self.err), "GCS host")
        self.err = io.StringIO()
        self.assertRefused(sl.main(["--to", "homecookd-production-uploads-1", "--media-base", BASE], make_stores=None, err=self.err),
                           "media bucket")

    def test_ids_that_arent_a_library_dish(self):
        for bad in ("recipe-k123", "jobs", "library", "Dad-Chili", "a/b"):
            self.assertRefused(self.run_tool(*LOCAL, "--from-gcs", bad), "can't be a library id")
        self.add_repo_sample("trash")
        self.assertRefused(self.run_tool(*LOCAL), "can't be a library id")

    def test_out_inside_the_repo(self):
        self.assertRefused(self.run_tool(*LOCAL, "--out", str(sl.REPO / "data" / "x")), "outside the repo")

    def test_a_repo_file_must_be_a_sample_with_its_own_files(self):
        self.add_repo_sample("not-one", sample=False)
        self.assertRefused(self.run_tool(*LOCAL), "isn't a sample")
        (self.synthetic / "not-one.json").unlink()
        self.add_repo_sample("family-one", family=True)
        self.assertRefused(self.run_tool(*LOCAL), "family's own")
        (self.synthetic / "family-one.json").unlink()
        self.add_repo_sample("linked", media={"video_url": f"{GCS_URL}/linked/play.mp4", "duration_s": 600})
        self.assertRefused(self.run_tool(*LOCAL), "links to a file elsewhere")


class FromGcs(Base):
    def test_real_gcs_needs_the_read_flag_even_for_a_dry_run(self):
        self.add_gcs_sample("gordon-gnocchi")
        self.assertRefused(self.run_tool("--from-gcs", "gordon-gnocchi"), sl.READ_FLAG)
        self.assertEqual(self.gcs.faults.calls, {})

    def test_real_media_never_goes_to_staging_or_a_local_endpoint(self):
        code = sl.main(["--to", "homecookd-staging-media-1", "--media-base", BASE, "--from-gcs", "gordon-gnocchi", sl.READ_FLAG],
                       make_stores=None, err=self.err)
        self.assertRefused(code, "never goes to staging")
        self.err = io.StringIO()
        self.assertRefused(self.run_tool("--from-gcs", "gordon-gnocchi", sl.READ_FLAG, "--s3-endpoint", "http://localhost:9000"),
                           "local endpoint")

    def test_copies_exactly_the_linked_files_with_new_links(self):
        gen = self.add_gcs_sample("gordon-gnocchi")
        self.assertEqual(self.run_tool(*LOCAL, "--from-gcs", "gordon-gnocchi", "--write"), 0, self.err.getvalue())
        keys = self.s3_keys()
        for name in ("play.mp4", "voice.m4a", "poster.jpg", "steps/01.jpg", "recipe.json"):
            self.assertIn(f"gordon-gnocchi/{name}", keys)
        self.assertNotIn("gordon-gnocchi/work/frames.json", keys)
        self.assertEqual(self.s3.current(S3, "gordon-gnocchi/play.mp4"), b"video bytes" * 100)
        self.assertEqual(self.s3.head(S3, "gordon-gnocchi/play.mp4").headers["content_type"], "video/mp4")
        recipe = self.s3_json("gordon-gnocchi/recipe.json")
        self.assertEqual(recipe["media"]["video_url"], f"{BASE}/gordon-gnocchi/play.mp4?v={gen['play.mp4']}")
        self.assertEqual(recipe["steps"][0]["image_url"], f"{BASE}/gordon-gnocchi/steps/01.jpg?v={gen['steps/01.jpg']}")
        self.assertNotIn(b"storage.googleapis.com", self.s3.current(S3, "gordon-gnocchi/recipe.json"))
        self.assertIn("gordon-gnocchi", [e["id"] for e in self.s3_json("library.json")])
        self.assertIsNone(self.gcs.buckets[G].get("library.json"))  # GCS is only read

    def test_a_dry_run_reads_no_video(self):
        self.add_gcs_sample("gordon-gnocchi")
        self.assertEqual(self.run_tool(*LOCAL, "--from-gcs", "gordon-gnocchi"), 0, self.err.getvalue())
        self.assertEqual(self.gcs.bytes_read, len(self.gcs.buckets[G]["gordon-gnocchi/recipe.json"].data))

    def test_refuses_what_isnt_a_public_sample(self):
        self.add_gcs_sample("a-real-one", sample=False)
        self.assertRefused(self.run_tool(*LOCAL, "--from-gcs", "a-real-one"), "isn't a sample")
        self.add_gcs_sample("theirs", family=True)
        self.assertRefused(self.run_tool(*LOCAL, "--from-gcs", "theirs"), "family's own")
        self.assertRefused(self.run_tool(*LOCAL, "--from-gcs", "not-there"), "isn't there")
        self.add_gcs_sample("dad-chili")
        self.assertRefused(self.run_tool(*LOCAL, "--from-gcs", "dad-chili"), "the same id twice")
        self.assertEqual(self.s3.puts, 0)

    def test_refuses_links_outside_its_folder_or_unknown_ones(self):
        self.add_gcs_sample("borrows")
        doc = json.loads(self.gcs.buckets[G]["borrows/recipe.json"].data)
        doc["media"]["poster_url"] = f"{GCS_URL}/someone-elses/poster.jpg"
        self.gcs.put(G, "borrows/recipe.json", json.dumps(doc).encode())
        self.assertRefused(self.run_tool(*LOCAL, "--from-gcs", "borrows"), "outside its own folder")
        self.add_gcs_sample("hidden-link", stories=[{"id": "s1", "audio": f"{GCS_URL}/hidden-link/story.m4a"}])
        self.assertRefused(self.run_tool(*LOCAL, "--from-gcs", "hidden-link"), "doesn't know about")
        self.add_gcs_sample("gone")
        self.gcs.delete(G, "gone/voice.m4a")
        self.assertRefused(self.run_tool(*LOCAL, "--from-gcs", "gone"), "isn't there")

    def test_bytes_that_dont_match_gcs_are_never_written(self):
        self.add_gcs_sample("gordon-gnocchi")
        self.gcs.corrupt_reads.add("gordon-gnocchi/play.mp4")
        self.assertEqual(self.run_tool(*LOCAL, "--from-gcs", "gordon-gnocchi", "--write"), 1)
        self.assertIsNone(self.s3.current(S3, "gordon-gnocchi/play.mp4"))
        self.assertIsNone(self.s3.current(S3, "library.json"))

    def test_permission_denied_on_gcs(self):
        self.add_gcs_sample("gordon-gnocchi")
        self.gcs.faults.deny.add("head")
        self.assertEqual(self.run_tool(*LOCAL, "--from-gcs", "gordon-gnocchi"), 3)
        self.assertIn("denied: head was denied", self.err.getvalue())


if __name__ == "__main__":
    unittest.main(verbosity=1)
