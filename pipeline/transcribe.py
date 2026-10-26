"""A recording's words with their times, from Cartesia's batch speech-to-text (ink-whisper).

python pipeline/transcribe.py --id ID [--language mr] [--force]   # data/out/ID/voice.m4a -> work/transcript.json

Gemini credits are nearly gone (Oct 24), and Claude takes no audio, so what the cook says reaches Claude as this
transcript: substep times (align.py with ALIGNER=claude) and, next, the video extraction. One request for the
whole file (Cartesia chunks long files itself), with word timestamps in seconds on voice.m4a's clock, which is
play.mp4's. The job's language goes with it: without one ink-whisper assumes English, and Marathi comes back as
English-sounding nonsense. Cached in work/transcript.json and reused while the language is the same.

ink-whisper sometimes loops on quiet or noisy stretches: on Poha (Marathi, Oct 26) one word 70 times inside 5 s and
one phrase 10 times running, and in English "Mmm." 209 times at one instant. drop_loops keeps one copy of any word
or phrase (up to LOOP_MAX_N words) said more than LOOP_REPEATS times in a row (a cook saying something two or three
times is kept), and drops a "word" that is one character looped ("हुँँँँ…").

Keys: CARTESIA_API_KEY, then CARTESIA_API_KEYS_BACKUP (comma-separated), each tried in turn when Cartesia says the
one before is out of credits (402), as voice/src/cartesiaKeys.ts does.
"""
from __future__ import annotations

import argparse
import json
import os
import re
import sys
import time
from pathlib import Path

import requests

ROOT = Path(__file__).resolve().parent.parent
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

STT_URL = "https://api.cartesia.ai/stt"
CARTESIA_VERSION = "2026-08-14"
MODEL = "ink-whisper"
TIMEOUT = (30, 1800)  # (connect, read) seconds; an hour of audio takes minutes
LINE_GAP_S = 0.8  # a pause this long starts a new line
LINE_MAX_S = 12.0  # and no line runs longer than this
LOOP_REPEATS, LOOP_MAX_N = 3, 8  # more repeats than this of a phrase this long, back to back, is a loop
FILE = "transcript.json"


class TranscribeError(RuntimeError):
    pass


def keys() -> list[str]:
    backup = [k.strip() for k in (os.environ.get("CARTESIA_API_KEYS_BACKUP") or "").split(",") if k.strip()]
    return [k for k in [os.environ.get("CARTESIA_API_KEY", "").strip(), *backup] if k]


def out_of_credits(status: int, body: str) -> bool:
    return status == 402 and bool(re.search(r"quota_exceeded|credits limit|out of credits", body, re.I))


def transcribe(audio: Path, language: str) -> dict:
    """{"language", "duration", "text", "words": [{"word", "start", "end"}], "loop_words_dropped"}, times in
    seconds, loops dropped. Raises TranscribeError when every key fails."""
    pool = keys()
    if not pool:
        raise TranscribeError("CARTESIA_API_KEY is not set (add it to .env)")
    for i, key in enumerate(pool):
        with audio.open("rb") as f:
            res = requests.post(STT_URL, timeout=TIMEOUT,
                                headers={"Authorization": f"Bearer {key}", "Cartesia-Version": CARTESIA_VERSION},
                                data={"model": MODEL, "language": language, "timestamp_granularities[]": "word"},
                                files={"file": (audio.name, f)})
        if res.ok:
            body = res.json()
            heard = [{"word": w["word"].strip(), "start": round(float(w["start"]), 2), "end": round(float(w["end"]), 2)}
                     for w in body.get("words") or [] if str(w.get("word", "")).strip()]
            words = drop_loops(heard)
            return {"language": language, "duration": body.get("duration"), "text": " ".join(w["word"] for w in words),
                    "words": words, "loop_words_dropped": len(heard) - len(words)}
        if not out_of_credits(res.status_code, res.text) or i == len(pool) - 1:
            raise TranscribeError(f"Cartesia STT HTTP {res.status_code}: {res.text[:500]}")
        print(f"[transcribe] Cartesia key {i + 1} of {len(pool)} is out of credits; trying the next", flush=True)
    raise AssertionError("unreachable")


def _key(word: dict) -> str:
    return word["word"].strip(",.?!।").lower()


CHAR_LOOP = re.compile(r"(.)\1{5,}")


def drop_loops(words: list[dict], repeats: int = LOOP_REPEATS, max_n: int = LOOP_MAX_N) -> list[dict]:
    """words with every loop cut to its first copy: a run of the same 1..max_n words said more than `repeats` times
    back to back. A word that is one character looped is dropped."""
    words = [w for w in words if not CHAR_LOOP.search(w["word"])]
    out, i = [], 0
    while i < len(words):
        for n in range(1, max_n + 1):
            unit = [_key(w) for w in words[i:i + n]]
            copies = 1
            while [_key(w) for w in words[i + copies * n:i + (copies + 1) * n]] == unit:
                copies += 1
            if len(unit) == n and copies > repeats:
                out += words[i:i + n]
                i += copies * n
                break
        else:
            out.append(words[i])
            i += 1
    return out


def lines(words: list[dict], gap_s: float = LINE_GAP_S, max_s: float = LINE_MAX_S) -> list[dict]:
    """Words joined into spoken lines [{"start", "end", "text"}]: a new line at each pause of gap_s or more, and
    before a line would run past max_s."""
    out: list[dict] = []
    for w in words:
        line = out[-1] if out else None
        if line and w["start"] - line["end"] < gap_s and w["end"] - line["start"] <= max_s:
            line["end"], line["text"] = w["end"], f"{line['text']} {w['word']}"
        else:
            out.append({"start": w["start"], "end": w["end"], "text": w["word"]})
    return out


def transcript_file(out_dir: Path, language: str | None, force: bool = False) -> dict:
    """work/transcript.json for out_dir/voice.m4a, made once per language (default English)."""
    path, language = out_dir / "work" / FILE, language or "en"
    if path.exists() and not force:
        cached = json.loads(path.read_text())
        if cached.get("language") == language:
            return cached
    t0 = time.monotonic()
    result = transcribe(out_dir / "voice.m4a", language)
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(result, ensure_ascii=False, indent=1) + "\n")
    print(f"[transcribe] {out_dir.name}: {len(result['words'])} words ({language}; {result['loop_words_dropped']} "
          f"looped words dropped) in {time.monotonic() - t0:.0f} s", flush=True)
    return result


def main() -> None:
    from dotenv import load_dotenv

    from pipeline.prep import OUT_ROOT
    ap = argparse.ArgumentParser(description="Write data/out/ID/work/transcript.json with Cartesia ink-whisper.")
    ap.add_argument("--id", required=True, help="recipe id: data/out/ID/voice.m4a must exist")
    ap.add_argument("--language", help="ISO 639-1; default: the manifest's language, else en")
    ap.add_argument("--force", action="store_true", help="transcribe again even when cached")
    args = ap.parse_args()
    load_dotenv(ROOT / ".env")
    out_dir = OUT_ROOT / args.id
    manifest = out_dir / "work" / "manifest.json"
    language = args.language or (json.loads(manifest.read_text()).get("language") if manifest.exists() else None)
    try:
        result = transcript_file(out_dir, language, force=args.force)
    except TranscribeError as e:
        sys.exit(f"transcribe: error: {e}")
    for line in lines(result["words"])[:20]:
        print(f"  {line['start']:7.1f}-{line['end']:7.1f}  {line['text']}")


if __name__ == "__main__":
    main()
