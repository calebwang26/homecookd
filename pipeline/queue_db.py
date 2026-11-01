"""Postgres for queue mode: the conditional claim, and every write to a job (docs/build/WORKER-MIGRATION.md).

psycopg is imported only when a connection is made, so Convex mode and the laptop never need it. Each write to a running job
names the attempt that claimed it (attempts is a fencing token: it only goes up), so a worker that lost its claim changes
nothing. Times come from the database's clock, so workers' clocks don't matter.
"""
from __future__ import annotations

import hashlib
import json
import os
import re
import sys
import time
from decimal import Decimal
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))

RUNNING = ["preparing", "understanding", "writing", "indexing"]
MAX_FOLLOW_UPS = 5  # convex/lib/recipeJson.ts
CA_FILE = "/app/rds-ca.pem"  # pipeline/Dockerfile
SCOPE = "pipeline"
DAY = "(now() at time zone 'utc')::date"
# usage.json's kind -> the template that call filled in (a name and hash, never the filled-in text).
TEMPLATES = {"extract": "EXTRACT_PROMPT", "extract-batch": "EXTRACT_PROMPT", "merge": "MERGE_PROMPT", "order": "ORDER_PROMPT",
             "shorten": "SHORTEN_PROMPT", "align": "ALIGN_PROMPT", "cover": "COVER_PROMPT", "cover-box": "COVER_BOX_PROMPT",
             "seen": "SEEN_PROMPT", "proofread": "PROOFREAD_PROMPT"}


def prompt_version(kind: str) -> str | None:
    import prompts
    name = TEMPLATES.get(kind)
    template = getattr(prompts, name, None) if name else None
    return f"{name}:{hashlib.sha256(template.encode()).hexdigest()[:12]}" if template else None


def _provider(model: str) -> str:
    for prefix, provider in (("claude", "anthropic"), ("gemini", "google"), ("muse", "meta"), ("ink", "cartesia")):
        if model.startswith(prefix):
            return provider
    return "unknown"


def call_row(call: dict) -> dict:
    """One usage.json call, for model_calls. Its error text can quote the model's answer, so only the error's type is kept."""
    ok = call.get("error") is None
    kind = call["kind"]
    found = re.match(r"[A-Za-z_.]*(?:Error|Exception|Timeout)\b", call.get("error") or "")
    return {"purpose": kind, "provider": _provider(call["model"]), "model": call["model"],
            "prompt_version": prompt_version(kind), "attempt": call.get("attempt") or 1, "batch": bool(call.get("batch")),
            "input_tokens": call.get("prompt_token_count"), "output_tokens": call.get("candidates_token_count"),
            "thinking_tokens": call.get("thoughts_token_count"), "cost_usd": Decimal(str(call.get("cost_usd") or 0)),
            "price_known": call.get("price_known", True), "seconds": call.get("seconds"), "ok": ok,
            "error": None if ok else (found.group(0) if found else "rejected")[:200]}


def _text(x, limit: int = 4000) -> str | None:
    return x.strip()[:limit] if isinstance(x, str) and x.strip() else None


def _num(x) -> float | None:
    return x if isinstance(x, (int, float)) and not isinstance(x, bool) and x >= 0 else None


def _moment(o: dict, fallback: dict | None = None) -> dict:
    start = _num(o.get("start_s"))
    start = start if start is not None else (fallback or {}).get("startS", 0)
    end = _num(o.get("end_s"))
    end = end if end is not None else (fallback or {}).get("endS", start)
    return {"startS": start, "endS": max(start, end)}


def _clean(d: dict) -> dict:
    return {k: v for k, v in d.items() if v is not None}


def _order(s: dict, i: int) -> float:
    n = _num(s.get("order"))
    return n if n is not None else i + 1


def recipe_row(raw: dict) -> dict:
    """recipe.json as the columns recipes keeps: the same fields and keys as convex/lib/recipeJson.ts, so backfilled rows and
    these read the same. Raises ValueError when there's no usable title or steps."""
    title = _text(raw.get("title"), 200)
    if not title:
        raise ValueError("no title")

    def objects(key: str, limit: int) -> list[dict]:
        return [o for o in (raw.get(key) or [])[:limit] if isinstance(o, dict)]

    steps = []
    for i, s in enumerate(objects("steps", 100)):
        text = _text(s.get("instruction"))
        if not text:
            raise ValueError("a step has no instruction")
        steps.append(_clean({"order": _order(s, i), "title": _text(s.get("title"), 200) or f"Step {i + 1}", "text": text,
                             "quote": _text(s.get("quote"), 1000), "quoteOriginal": _text(s.get("quote_original"), 1000),
                             "moment": _moment(s)}))
    if not steps:
        raise ValueError("no steps")
    steps.sort(key=lambda s: s["order"])
    by_order = {s["order"]: s for s in steps}
    memories = []
    for s in objects("stories", 50):
        if text := _text(s.get("text")):
            at = by_order.get(s.get("step"))
            memories.append(_clean({"kind": "story", "text": text, "moment": _moment(s, at and at["moment"]),
                                    "step": at and at["order"], "id": _text(s.get("id"), 200),
                                    "title": _text(s.get("title"), 200)}))
    for x in objects("special", 50):
        if text := _text(x.get("text")):
            at = by_order.get(x.get("step"))
            memories.append(_clean({"kind": "tip", "text": text, "moment": _moment(x, at and at["moment"]),
                                    "step": at and at["order"], "id": _text(x.get("id"), 200),
                                    "why": _text(x.get("why"), 1000)}))
    for i, s in enumerate(objects("steps", 100)):
        if text := _text(s.get("tip")):
            memories.append({"kind": "tip", "text": text, "moment": _moment(s), "step": _order(s, i)})
    asked: dict[str, dict] = {}
    for q in objects("follow_up_questions", 20):
        qid, question = _text(q.get("id"), 100), _text(q.get("question"), 500)
        if qid and question and qid not in asked:
            at = by_order.get(q.get("about_step"))
            asked[qid] = {"id": qid, "question": question, "step": at and at["order"], "ingredient": _text(q.get("ingredient"), 100)}
    # Ingredient questions first: only these can change the recipe.
    follow_ups = sorted(asked.values(), key=lambda f: not f["ingredient"])[:MAX_FOLLOW_UPS]
    language = (_text(raw.get("language"), 10) or "").lower()
    return {"title": title, "library_id": _text(raw.get("id"), 200), "steps": steps, "memories": memories,
            "language": language if re.fullmatch(r"[a-z]{2,3}", language) else None, "follow_ups": follow_ups}


def dsn_from_env() -> dict:
    """DATABASE_URL locally; on AWS the host and login the task already gets (infra/modules/env/services.tf), with RDS's
    certificate checked, as api/src/db.ts does."""
    if url := os.environ.get("DATABASE_URL"):
        return {"conninfo": url}
    login = json.loads(os.environ["DB_CREDENTIALS"])
    return {"host": os.environ["DB_HOST"], "dbname": "homecookd", "user": login["username"], "password": login["password"],
            "sslmode": "verify-full", "sslrootcert": os.environ.get("DB_CA_FILE") or CA_FILE}


class PostgresStore:
    def __init__(self, dsn: dict | None = None):
        self.dsn = dsn or dsn_from_env()
        self.conn = None

    def _connect(self):
        import psycopg
        from psycopg.rows import dict_row
        return psycopg.connect(**self.dsn, autocommit=True, row_factory=dict_row, connect_timeout=10,
                               options="-c statement_timeout=30000", keepalives_idle=30, keepalives_interval=10,
                               keepalives_count=3)

    def _do(self, work):
        """Runs work(conn). A lost connection (an RDS failover) gets one new connection and one more try; if it's still down the
        caller's own rules apply. work is one statement or one transaction, and each is safe to repeat: see finish."""
        import psycopg
        for attempt in (1, 2):
            try:
                if self.conn is None or self.conn.closed:
                    self.conn = self._connect()
                return work(self.conn)
            except (psycopg.OperationalError, psycopg.errors.DeadlockDetected):
                self.close()
                if attempt == 2:
                    raise
                time.sleep(1)

    def close(self) -> None:
        if self.conn is not None:
            try:
                self.conn.close()
            finally:
                self.conn = None

    def ping(self) -> None:
        self._do(lambda c: c.execute("select 1"))

    def claim(self, job_id: str, lease_s: int) -> dict | None:
        """The one place a job starts: a queued job, or a running one whose worker's heartbeat stopped. Two callers can't both
        win, because the second one's WHERE no longer matches once the first commits."""
        def work(c):
            row = c.execute(
                """update jobs set stage = 'preparing', progress = 0.02, error = null, attempts = attempts + 1,
                          claimed_at = now(), heartbeat_at = now(), updated_at = now()
                    where id = %s and cancelled_at is null
                      and (stage = 'queued' or (stage = any(%s) and
                           coalesce(heartbeat_at, claimed_at, updated_at) < now() - make_interval(secs => %s)))
                    returning id, attempts, family_id, cook_id, recipe_id, recording_id, upload_key, title, language,
                              video_gaps, cost_usd""",
                (job_id, RUNNING, lease_s)).fetchone()
            return dict(row) if row else None
        claim = self._do(work)
        if claim:
            claim.update(self._context(claim))
        return claim

    def _context(self, job: dict) -> dict:
        """What the steps need that the job row doesn't hold (worker.claim in convex/worker.ts)."""
        def work(c):
            row = c.execute(
                """select p.name as cook_name, p.relation, p.language as cook_language, r.media_prefix,
                          rec.memories_opt_in, rec.cover_key, rec.started_at, rec.video_started_at
                     from people p
                     left join recipes r on r.id = %s
                     left join recordings rec on rec.id = %s
                    where p.id = %s""", (job["recipe_id"], job["recording_id"], job["cook_id"])).fetchone() or {}
            prompts = []
            if job["recording_id"]:
                prompts = c.execute(
                    """select kind, text, text_en, at_s, said_at_s, said_end_s, answer_transcript, answer_transcript_en,
                              answer_at_s, answer_end_s
                         from homie_prompts where recording_id = %s order by at_s limit 200""",
                    (job["recording_id"],)).fetchall()
            return dict(row), prompts
        row, prompts = self._do(work)
        shift = 0.0
        if row.get("started_at") and row.get("video_started_at"):
            shift = (row["started_at"] - row["video_started_at"]).total_seconds()

        def t(s: float) -> float:  # video seconds, as convex/worker.ts homieLog
            return round((s + shift) * 10) / 10

        log = []
        for p in prompts:
            if t(p["at_s"]) < 0:
                continue
            entry = {"atS": t(p["at_s"]), "kind": p["kind"], "text": p["text"], "textEn": p["text_en"]}
            if p["said_at_s"] is not None and p["said_end_s"] is not None:
                entry["said"] = {"atS": t(p["said_at_s"]), "endS": t(p["said_end_s"])}
            if p["answer_transcript"] is not None and p["answer_at_s"] is not None and p["answer_end_s"] is not None:
                entry["answer"] = _clean({"transcript": p["answer_transcript"], "transcriptEn": p["answer_transcript_en"],
                                          "atS": t(p["answer_at_s"]), "endS": t(p["answer_end_s"])})
            log.append(entry)
        return {**row, "homie_log": log}

    def peek(self, job_id: str, lease_s: int) -> dict | None:
        def work(c):
            return c.execute(
                """select j.stage, j.attempts, j.upload_key, r.media_prefix, j.cancelled_at is not null as cancelled,
                          coalesce(j.heartbeat_at, j.claimed_at, j.updated_at) >= now() - make_interval(secs => %s) as lease_live
                     from jobs j left join recipes r on r.id = j.recipe_id
                    where j.id = %s""", (lease_s, job_id)).fetchone()
        return self._do(work)

    def heartbeat(self, claim: dict) -> str:
        """ok, or cancelled (the cook stopped it, or the row is gone with her account), or lost (another worker has it)."""
        def work(c):
            row = c.execute("""update jobs set heartbeat_at = now() where id = %s and attempts = %s
                                  and cancelled_at is null and stage = any(%s) returning 1""",
                            (claim["id"], claim["attempts"], RUNNING)).fetchone()
            if row:
                return "ok"
            now = c.execute("select cancelled_at is not null as cancelled from jobs where id = %s", (claim["id"],)).fetchone()
            return "cancelled" if now is None or now["cancelled"] else "lost"
        return self._do(work)

    def _fenced(self, claim: dict, sets: str, args: tuple = ()) -> bool:
        def work(c):
            return c.execute(f"""update jobs set {sets}, updated_at = now() where id = %s and attempts = %s
                                    and cancelled_at is null and stage = any(%s) returning 1""",
                             (*args, claim["id"], claim["attempts"], RUNNING)).fetchone() is not None
        return self._do(work)

    def progress(self, claim: dict, stage: str, progress: float) -> None:
        self._fenced(claim, "stage = %s, progress = %s", (stage, round(min(max(progress, 0.0), 1.0), 3)))

    def upload_finished(self, claim: dict, at) -> None:
        self._fenced(claim, "upload_finished_at = coalesce(upload_finished_at, %s)", (at,))

    def release(self, claim: dict, error: str | None = None) -> bool:
        return self._fenced(claim, "stage = 'queued', progress = 0, claimed_at = null, heartbeat_at = null, error = %s", (error,))

    def fail(self, claim: dict, message: str) -> bool:
        def work(c):
            with c.transaction():
                row = c.execute(
                    """update jobs set stage = 'failed', progress = 0, error = %s, finished_at = now(), updated_at = now()
                        where id = %s and attempts = %s and cancelled_at is null and stage = any(%s) returning recipe_id""",
                    (message, claim["id"], claim["attempts"], RUNNING)).fetchone()
                if row and row["recipe_id"]:
                    c.execute("update recipes set status = 'failed' where id = %s", (row["recipe_id"],))
                return row is not None
        return self._do(work)

    def record_calls(self, job_id: str, calls: list[dict]) -> Decimal:
        """Saves new model calls, and adds what they cost to the job and today's spend, all or nothing. Money spent counts even
        if the job was cancelled or lost meanwhile, and the row keeps its cost history after the job is gone. Returns the job's
        total across every attempt."""
        rows = [call_row(c) for c in calls]
        total = sum((r["cost_usd"] for r in rows), Decimal(0))

        def work(c):
            with c.transaction():
                for r in rows:
                    c.execute(
                        """insert into model_calls (job_id, purpose, provider, model, prompt_version, attempt, batch, input_tokens,
                                                    output_tokens, thinking_tokens, cost_usd, price_known, seconds, ok, error)
                           values ((select id from jobs where id = %s), %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s)""",
                        (job_id, r["purpose"], r["provider"], r["model"], r["prompt_version"], r["attempt"], r["batch"],
                         r["input_tokens"], r["output_tokens"], r["thinking_tokens"], r["cost_usd"], r["price_known"],
                         r["seconds"], r["ok"], r["error"]))
                c.execute(f"""insert into daily_spend (scope, day, usd) values (%s, {DAY}, %s)
                              on conflict (scope, day) do update set usd = daily_spend.usd + excluded.usd""", (SCOPE, total))
                row = c.execute("update jobs set cost_usd = coalesce(cost_usd, 0) + %s where id = %s returning cost_usd",
                                (total, job_id)).fetchone()
                return row["cost_usd"] if row else total
        return self._do(work)

    def spent_today(self) -> Decimal:
        def work(c):
            row = c.execute(f"select usd from daily_spend where scope = %s and day = {DAY}", (SCOPE,)).fetchone()
            return row["usd"] if row else Decimal(0)
        return self._do(work)

    def note_daily_cap(self) -> bool:
        """True the first time today, so the team is told once."""
        def work(c):
            return c.execute(f"""insert into daily_spend (scope, day, usd, alerted_at) values (%s, {DAY}, 0, now())
                                 on conflict (scope, day) do update set alerted_at = now()
                                 where daily_spend.alerted_at is null returning 1""", (SCOPE,)).fetchone() is not None
        return self._do(work)

    def pause(self, job_id: str, message: str) -> None:
        def work(c):
            c.execute("""update jobs set error = %s, updated_at = now()
                          where id = %s and stage = 'queued' and cancelled_at is null""", (message, job_id))
        self._do(work)

    def acknowledge_cancel(self, job_id: str, message: str) -> None:
        """The cook's stop is final, whatever the api wrote and whatever this worker was doing."""
        def work(c):
            with c.transaction():
                row = c.execute(
                    """update jobs set stage = 'failed', progress = 0, error = coalesce(error, %s),
                              finished_at = coalesce(finished_at, now()), updated_at = now()
                        where id = %s and cancelled_at is not null returning recipe_id""", (message, job_id)).fetchone()
                if row and row["recipe_id"]:
                    c.execute("update recipes set status = 'failed' where id = %s", (row["recipe_id"],))
        self._do(work)

    def finish(self, claim: dict, row: dict, keys: dict, result: dict, request_id: str | None) -> bool:
        """The recipe goes live here, and only here: recipe, follow-ups, the job's end and the follow-on message, all or nothing.
        False means it didn't happen: the cook cancelled, or another worker holds the job."""
        def work(c):
            with c.transaction():
                job = c.execute(
                    """select id, family_id, cook_id, recipe_id, language, stage, attempts, cancelled_at from jobs
                        where id = %s for update""", (claim["id"],)).fetchone()
                if job is None or job["cancelled_at"] is not None or job["attempts"] != claim["attempts"]:
                    return False
                if job["stage"] == "done":  # this same attempt, retried after a connection dropped at COMMIT
                    return True
                if job["stage"] not in RUNNING:
                    return False
                recipe_id = self._save_recipe(c, job, claim, row, keys)
                for f in row["follow_ups"]:
                    c.execute("""insert into questions (family_id, recipe_id, step_order, asked_by, text, kind, follow_up_id,
                                                         follow_up_ingredient, status)
                                 values (%s, %s, %s, %s, %s, 'follow_up', %s, %s, 'asked_cook')
                                 on conflict (recipe_id, follow_up_id) where follow_up_id is not null do nothing""",
                              (job["family_id"], recipe_id, f["step"], job["cook_id"], f["question"], f["id"], f["ingredient"]))
                c.execute("""update jobs set stage = 'done', progress = 1, error = null, finished_at = now(), updated_at = now(),
                                  recipe_id = %s, result_model = %s, result_prompt_version = %s where id = %s""",
                          (recipe_id, result.get("model"), result.get("prompt_version"), job["id"]))
                c.execute("update model_calls set recipe_id = %s where job_id = %s", (recipe_id, job["id"]))
                c.execute("insert into outbox (queue, payload, request_id) values ('scheduled', %s::jsonb, %s)",
                          (json.dumps({"kind": "recipe_published", "jobId": job["id"], "recipeId": recipe_id}), request_id))
                return True
        return self._do(work)

    @staticmethod
    def _save_recipe(c, job: dict, claim: dict, row: dict, keys: dict) -> str:
        from psycopg.types.json import Jsonb
        fields = (row["title"], row["library_id"], keys["media_prefix"], keys["recipe_json_key"], keys["cover_key"],
                  keys.get("cover_version"), Jsonb(row["steps"]), Jsonb(row["memories"]), row["language"] or job["language"])
        opt_in = claim.get("memories_opt_in")
        if job["recipe_id"]:
            found = c.execute(
                """update recipes set status = 'ready', title = %s, library_id = %s, media_prefix = %s, recipe_json_key = %s,
                          cover_key = %s, cover_stock_path = null, cover_version = %s, steps = %s, memories = %s, language = %s,
                          moss_indexed_at = null, memories_opt_in = coalesce(%s, memories_opt_in)
                    where id = %s returning id""", (*fields, opt_in, job["recipe_id"])).fetchone()
            if found:  # else it went with its cook's account: a new row, as worker.published
                return found["id"]
        return c.execute(
            """insert into recipes (title, library_id, media_prefix, recipe_json_key, cover_key, cover_version, steps, memories,
                                    language, memories_opt_in, family_id, cook_id, status)
               values (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, 'ready') returning id""",
            (*fields, bool(opt_in), job["family_id"], job["cook_id"])).fetchone()["id"]

    def sweep(self, lease_s: int, max_attempts: int, message: str) -> list[str]:
        """A job whose worker died on its last try has no message left to re-run it, so it would spin forever in the app. These
        fail visibly. Also any job silent for a day: the alarm has long fired. Uses jobs_unfinished."""
        def work(c):
            rows = c.execute(
                """with gone as (
                     select id from jobs
                      where stage = any(%s) and coalesce(heartbeat_at, claimed_at, updated_at) < now() - make_interval(secs => %s)
                        and (attempts >= %s or coalesce(heartbeat_at, claimed_at, updated_at) < now() - interval '24 hours')
                      limit 50 for update skip locked),
                   failed as (
                     update jobs set stage = 'failed', progress = 0, error = %s, finished_at = now(), updated_at = now()
                      where id in (select id from gone) returning id, recipe_id),
                   recipes_failed as (
                     update recipes set status = 'failed' where id in (select recipe_id from failed where recipe_id is not null))
                   select id from failed""", (RUNNING, lease_s, max_attempts, message)).fetchall()
            return [r["id"] for r in rows]
        return self._do(work)
