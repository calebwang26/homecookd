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

Before it goes, the audio is cleaned (clean_audio): 16 kHz mono, and every pause longer than SILENCE_S cut down,
since the loops come from long quiet stretches. A pause is quieter than the recording's own quiet level plus
ABOVE_FLOOR_DB: Poha's glasses mic never drops below about -28 dB, Swordfish's phone sits near -42 dB. On Poha (Oct 26,
three runs each) +3.6 dB cut 220 of 632 s and brought the words 38% closer to Gemini's Marathi (+2.5: 6%, +4.2: 27%,
more cuts speech); normalising the loudness made them worse. Swordfish's pauses have music under them: nothing cut.
A time map puts every word back on voice.m4a's clock.

A recording tagged English whose transcript looks like another language forced into English (doubtful_english: many
loops, few words a minute, Cartesia's "foreign" marker) gets one check (detect_language): the same 90 s sample is
transcribed in each cook language, and Claude says which one reads as real speech. When it's sure, the whole
recording is transcribed in that language and the transcript says so (tagged_language, language_note). On Poha
(Marathi, tagged English, Oct 26) 85% of the English words were loops.

TRANSCRIPT_PROOFREAD=claude (CLAUDE_PROOFREAD_MODEL, default Opus) adds a proofread copy of the transcript's lines
for the languages it helps (PROOFREAD_LANGUAGES) ("proofread"): Claude corrects misheard words to what she said ("मोरी" to मोहरी) and adds
nothing. The raw words stay; spoken_lines() gives the proofread lines when there are some.

Keys: CARTESIA_API_KEY, then CARTESIA_API_KEYS_BACKUP (comma-separated), each tried in turn when Cartesia says the
one before is out of credits (402), as voice/src/cartesiaKeys.ts does.
"""
from __future__ import annotations

import argparse
import difflib
import json
import os
import re
import subprocess
import sys
import tempfile
import time
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path

import requests
from pydantic import BaseModel

ROOT = Path(__file__).resolve().parent.parent
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

from pipeline import claude  # noqa: E402
from pipeline.prep import ffmpeg, find_tool, probe_duration  # noqa: E402
from pipeline.prompts import LANGUAGE_PROMPT, LANGUAGES, PROOFREAD_PROMPT  # noqa: E402

STT_URL = "https://api.cartesia.ai/stt"
CARTESIA_VERSION = "2026-08-14"
MODEL = "ink-whisper"
TIMEOUT = (30, 1800)  # (connect, read) seconds; an hour of audio takes minutes
LINE_GAP_S = 0.8  # a pause this long starts a new line
LINE_MAX_S = 12.0  # and no line runs longer than this
LOOP_REPEATS, LOOP_MAX_N = 3, 8  # more repeats than this of a phrase this long, back to back, is a loop
BABBLE_WINDOW, BABBLE_DISTINCT = 12, 3  # this many words in a row with this few different ones is a loop too
# A stretch that looped is sent again on its own, in pieces of up to RETRY_PIECE_S, through RETRY_FILTER: on the
# 13-language eval's Punjabi clip (music under her voice, Oct 26) a looped 40 s went from 1% of her words heard to
# 29%; the same filter on the whole file gained 1 point. Its words replace the stretch's only when they are more
# and mostly not loops (RETRY_MAX_LOOPS).
RETRY_FILTER = "afftdn=nf=-25"
RETRY_PIECE_S, RETRY_PAD_S, RETRY_MIN_S, RETRY_MAX_PIECES, RETRY_MAX_LOOPS = 30.0, 1.0, 3.0, 60, 0.5
RETRY_GAP_S = 4.0  # a stretch this long with no word at all is sent again too
FILE = "transcript.json"
SILENCE_S, KEEP_S, ABOVE_FLOOR_DB = 1.5, 0.3, 3.6  # a pause this long keeps KEEP_S at each end
# The cook languages besides English (memory cook-languages), and how a wrong-language transcript gives itself away.
# Marathi left them on Oct 26 (Caleb, memory marathi-dropped): a Marathi recording now reads as its nearest, Hindi.
COOK_LANGUAGES = ("hi", "gu", "ta", "te", "pa", "ur", "zh", "ko", "tl", "es", "pt", "ar")
SAMPLE_S, LOOP_SHARE, MIN_WORDS_A_MINUTE = 90, 0.4, 40
PROOFREAD_BATCH = 120  # lines a call
MIN_KEPT = 0.55  # a correction keeping less of the line's sound than this is a rewrite: the raw line stays
PROOFREAD_LINE_S = 30.0  # lines end only at pauses up to this long, so a word isn't split across two (मिर|ची)
# Poha (Oct 26), the same tightened prompt: Opus got all 7 facts we check in 2 of 3 runs (6 in the other); Sonnet 5 and
# Haiku 6, and both wrote chili powder for her cumin powder every time. Opus: ~$0.12 for 10.5 min of Marathi.
PROOFREAD_MODEL = "claude-opus-5-5"
# Proofread only where it helps (the 13-language eval, Oct 26: heard words te 0.35 -> 0.79, ta 0.29 -> 0.36, pa 0.17 ->
# 0.26, gu 0.17 -> 0.26, hi even; but zh, es, tl, ur and ar each lost 2-4 points, Cartesia already hears them well).
# Marathi too: it's hidden from the picker (memory marathi-dropped), but a cook who picked it before still records as
# "mr", and Poha (Marathi) is where the proofread was tuned (2 of 7 facts heard right without it, 7 of 7 with).
PROOFREAD_LANGUAGES = ("hi", "gu", "ta", "te", "pa", "mr")
LANGUAGE_MODEL = "claude-sonnet-5-5"  # reads 13 garbled samples side by side: rare (only a doubtful English tag)


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
            words = drop_babble(drop_loops(heard))
            kept = {id(w) for w in words}
            return {"language": language, "duration": body.get("duration"), "text": " ".join(w["word"] for w in words),
                    "words": words, "loop_words_dropped": len(heard) - len(words),
                    "loop_spans": loop_spans([w for w in heard if id(w) not in kept], words)}
        if not out_of_credits(res.status_code, res.text) or i == len(pool) - 1:
            raise TranscribeError(f"Cartesia STT HTTP {res.status_code}: {res.text[:500]}")
        print(f"[transcribe] Cartesia key {i + 1} of {len(pool)} is out of credits; trying the next", flush=True)
    raise AssertionError("unreachable")


# ---------- the audio: cleaned, with a time map back to voice.m4a ----------

TimeMap = list[tuple[float, float, float]]  # (start in the cleaned audio, start in the original, length)


def quiet_level(wav: Path) -> float:
    """The recording's quiet level in dB: the 10th percentile of its short windows' loudness (ffmpeg astats)."""
    proc = subprocess.run([find_tool("ffmpeg"), "-hide_banner", "-nostdin", "-v", "error", "-i", str(wav), "-af",
                           "asetnsamples=n=1600,astats=metadata=1:reset=1,"
                           "ametadata=print:key=lavfi.astats.Overall.RMS_level:file=-", "-f", "null", "-"],
                          capture_output=True, text=True, check=True)
    levels = sorted(-120.0 if x == "-inf" else float(x) for x in re.findall(r"RMS_level=(-inf|-?[\d.]+)", proc.stdout))
    return levels[len(levels) // 10] if levels else -120.0  # a window of digital silence counts as -120 dB


def silences(wav: Path, db: float) -> list[tuple[float, float]]:
    """ffmpeg's silencedetect: [(start, end)] of every pause quieter than db for SILENCE_S or more."""
    proc = subprocess.run([find_tool("ffmpeg"), "-hide_banner", "-nostdin", "-i", str(wav), "-af",
                           f"silencedetect=noise={db:.1f}dB:d={SILENCE_S}", "-f", "null", "-"],
                          capture_output=True, text=True, check=True)
    starts = [float(x) for x in re.findall(r"silence_start: (-?[\d.]+)", proc.stderr)]
    ends = [float(x) for x in re.findall(r"silence_end: ([\d.]+)", proc.stderr)]
    return [(max(s, 0.0), e) for s, e in zip(starts, ends + [float("inf")] * (len(starts) - len(ends)))]


def speech_spans(quiet: list[tuple[float, float]], total: float, keep: float = KEEP_S) -> list[tuple[float, float]]:
    """The parts of a recording to keep: everything but the pauses, each pause cut to `keep` seconds at each end."""
    spans, at = [], 0.0
    for s, e in quiet:
        e = min(e, total)
        if e - s > 2 * keep:
            spans.append((at, s + keep))
            at = e - keep if e < total else total  # a pause running to the end: nothing after it
    spans.append((at, total))
    return [(a, b) for a, b in spans if b - a > 0.05]


def to_original(t: float, tmap: TimeMap) -> float:
    """A time in the cleaned audio, on the original's clock."""
    for clean_at, orig_at, length in tmap:
        if t < clean_at + length:
            return round(orig_at + max(t - clean_at, 0.0), 2)
    clean_at, orig_at, length = tmap[-1]
    return round(orig_at + length, 2)


def clean_audio(src: Path, tmp: Path) -> tuple[Path, TimeMap]:
    """src as 16 kHz mono FLAC with its long pauses cut (speech_spans; a pause is ABOVE_FLOOR_DB over its quiet
    level, within -50..-15 dB). Returns the file and its time map."""
    norm, clean = tmp / "norm.wav", tmp / "clean.flac"
    ffmpeg("-i", str(src), "-vn", "-ac", "1", "-ar", "16000", "-c:a", "pcm_s16le", str(norm))
    total = probe_duration(norm)
    spans = speech_spans(silences(norm, min(max(quiet_level(norm) + ABOVE_FLOOR_DB, -50.0), -15.0)), total)
    tmap, at = [], 0.0
    for a, b in spans:
        tmap.append((round(at, 3), a, b - a))
        at += b - a
    if len(spans) == 1:
        ffmpeg("-i", str(norm), "-c:a", "flac", str(clean))
    else:
        cuts = tmp / "cuts.txt"
        cuts.write_text("".join(f"file '{norm.name}'\ninpoint {a:.3f}\noutpoint {b:.3f}\n" for a, b in spans))
        ffmpeg("-f", "concat", "-safe", "0", "-i", str(cuts), "-c:a", "flac", str(clean))
    return clean, tmap


def transcribe_clean(audio: Path, language: str) -> dict:
    """transcribe() on the cleaned audio, every time back on audio's own clock, then each stretch that looped sent
    again on its own (retry_loops)."""
    with tempfile.TemporaryDirectory() as tmp:
        clean, tmap = clean_audio(audio, Path(tmp))
        result = transcribe(clean, language)
    result["words"] = [{**w, "start": to_original(w["start"], tmap), "end": to_original(w["end"], tmap)}
                       for w in result["words"]]
    spans = [(to_original(a, tmap), to_original(b, tmap)) for a, b in result.pop("loop_spans", [])]
    total = tmap[-1][1] + tmap[-1][2]
    result.update(duration=round(total, 2), cut_s=round(total - (tmap[-1][0] + tmap[-1][2]), 1))
    spans = merge(spans + silent_spans(result["words"], total))
    if spans:
        retry_loops(audio, language, result, spans, total)
    return result


def retry_loops(audio: Path, language: str, result: dict, spans: list[tuple[float, float]], total: float) -> None:
    """Each looped stretch, padded and in pieces, transcribed again from `audio` through RETRY_FILTER; a piece's words
    replace the stretch's when splice() finds them better. Records result["retried"]; a failed piece changes nothing."""
    todo = pieces(spans, total)

    def again(piece: Piece) -> tuple[Piece, list[dict], int] | None:
        a, b = piece[0], piece[1]
        try:
            with tempfile.TemporaryDirectory() as tmp:
                seg = Path(tmp) / "piece.flac"
                ffmpeg("-ss", f"{a:.2f}", "-t", f"{b - a:.2f}", "-i", str(audio), "-vn", "-ac", "1", "-ar", "16000",
                       "-af", RETRY_FILTER, "-c:a", "flac", str(seg))
                r = transcribe(seg, language)
        except Exception:  # noqa: BLE001 - a second try is a bonus: the first transcript stands
            return None
        return piece, [{**w, "start": round(w["start"] + a, 2), "end": round(w["end"] + a, 2)} for w in r["words"]], \
            r["loop_words_dropped"]

    with ThreadPoolExecutor(max_workers=4) as pool:
        answers = [x for x in pool.map(again, todo) if x]
    took, before = 0, len(result["words"])
    for piece, words, dropped in answers:
        better = splice(result["words"], piece, words, dropped)
        if better is not None:
            result["words"], took = better, took + 1
    result["text"] = " ".join(w["word"] for w in result["words"])
    result["retried"] = {"pieces": len(todo), "taken": took, "words_added": len(result["words"]) - before}
    print(f"[transcribe] looped stretches: {len(todo)} pieces sent again, {took} better, "
          f"{len(result['words']) - before:+d} words", flush=True)


# ---------- the language check ----------

def doubtful_english(result: dict) -> str | None:
    """Why an English transcript looks like another language forced into English, or None."""
    words, loops = len(result["words"]), result.get("loop_words_dropped", 0)
    minutes = max((result.get("duration") or 0) / 60, 0.5)
    signs = []
    if words + loops and loops / (words + loops) > LOOP_SHARE:
        signs.append(f"{loops / (words + loops):.0%} of its words were loops")
    if words / minutes < MIN_WORDS_A_MINUTE:
        signs.append(f"only {words / minutes:.0f} words a minute")
    foreign = sum(_key(w) == "foreign" for w in result["words"])
    if foreign:
        signs.append(f'{foreign} "foreign" markers')
    return "; ".join(signs) or None


class LanguagePick(BaseModel):
    language: str
    sure: bool
    why: str


def detect_language(audio: Path, duration: float, gen: claude.ClaudeText) -> tuple[str, str]:
    """(language code, why) for a recording tagged English: one SAMPLE_S sample transcribed as English and as every
    cook language, and Claude's pick of the one that reads as real speech. English unless Claude is sure."""
    start = max(0.0, min(duration * 0.3, duration - SAMPLE_S))
    with tempfile.TemporaryDirectory() as tmp:
        sample = Path(tmp) / "sample.flac"
        ffmpeg("-ss", f"{start:.1f}", "-t", str(SAMPLE_S), "-i", str(audio), "-vn", "-ac", "1", "-ar", "16000",
               "-c:a", "flac", str(sample))
        codes = ("en", *COOK_LANGUAGES)
        with ThreadPoolExecutor(max_workers=7) as pool:
            heard = dict(zip(codes, pool.map(lambda c: transcribe(sample, c)["text"], codes)))
    blocks = "\n\n".join(f"[{c}: {LANGUAGES.get(c, c)}]\n{heard[c][:1500] or '(nothing)'}" for c in codes)
    resp = gen.generate(LANGUAGE_PROMPT + "\n" + blocks, LanguagePick)
    pick = LanguagePick.model_validate_json(resp.text)
    if pick.sure and pick.language in codes:
        return pick.language, pick.why
    return "en", f"no language read clearly ({pick.why})"


# ---------- the proofread copy ----------

class LineFix(BaseModel):
    id: int
    text: str


class Proofread(BaseModel):
    lines: list[LineFix]


def kept_sounds(raw: str, fixed: str) -> float:
    """How much of a line's sound a correction keeps (difflib's ratio on the text). On Poha (Oct 26) Opus's
    corrections keep 0.72 and up; a line compared with another line's correction keeps 0.42 at most. autojunk off:
    on text over 200 characters difflib otherwise ignores characters that recur often, and Devanagari's vowel signs
    do, so Poha's 290-character story line scored 0.24 and lost its correction (0.84 without it)."""
    return difflib.SequenceMatcher(None, raw, fixed, autojunk=False).ratio()


def proofread(spoken: list[dict], language: str, title: str, gen: claude.ClaudeText) -> tuple[list[dict], dict]:
    """(spoken's lines with Claude's corrections, same times; the tokens it took). A line it lengthens a lot or
    rewrites (kept_sounds under MIN_KEPT) keeps its own words, one it leaves out stays as it was, and one it marks as
    noise ("") is dropped."""
    out: list[dict] = []
    tokens = {"in": 0, "out": 0}
    prompt = PROOFREAD_PROMPT.format(language=LANGUAGES.get(language, language), title=json.dumps(title))
    for b in range(0, len(spoken), PROOFREAD_BATCH):
        batch = spoken[b:b + PROOFREAD_BATCH]
        rows = "\n".join(f"{i} | {x['text']}" for i, x in enumerate(batch))
        reply = gen.generate(f"{prompt}\n{rows}", Proofread)
        tokens["in"] += reply.usage_metadata.prompt_token_count
        tokens["out"] += reply.usage_metadata.candidates_token_count + reply.usage_metadata.thoughts_token_count
        fixed = {f.id: f.text.strip() for f in Proofread.model_validate_json(reply.text).lines}
        for i, x in enumerate(batch):
            text = fixed.get(i, x["text"])
            if text and (len(text) > 1.6 * len(x["text"]) + 12 or kept_sounds(x["text"], text) < MIN_KEPT):
                text = x["text"]
            if text:
                out.append({**x, "text": text})
    return out, tokens


def spoken_lines(transcript: dict) -> list[dict]:
    """What the cook said, line by line: the proofread copy when there is one, else the raw words' lines."""
    return (transcript.get("proofread") or {}).get("lines") or lines(transcript["words"])


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


def drop_babble(words: list[dict], window: int = BABBLE_WINDOW, distinct: int = BABBLE_DISTINCT) -> list[dict]:
    """words without the stretches drop_loops can't see: any `window` words in a row made of `distinct` or fewer
    different words ("ਗਾਰਾ ਤੋ ਤੋ ਗਾਰਾ ਤੋ ਗਾਰਾ …", what speech-to-text writes over music). Real speech that
    repetitive is rare: "stir, stir, stir" is three words."""
    junk = set()
    for i in range(len(words) - window + 1):
        if len({_key(w) for w in words[i:i + window]}) <= distinct:
            junk.update(range(i, i + window))
    return [w for i, w in enumerate(words) if i not in junk]


def loop_spans(dropped: list[dict], kept: list[dict], min_s: float = RETRY_MIN_S) -> list[tuple[float, float]]:
    """The stretches of audio a loop took over: from the last kept word before a run of dropped words to the first
    kept word after it. Speech-to-text stamps a loop's copies close together (Poha: 70 copies inside 5 s), so the
    dropped words' own times say where it started, not how much speech it swallowed. Only stretches min_s or longer."""
    starts = sorted(w["start"] for w in kept)
    ends = sorted(w["end"] for w in kept)
    spans: list[list[float]] = []
    for w in sorted(dropped, key=lambda w: w["start"]):
        before = max((e for e in ends if e <= w["start"]), default=0.0)
        after = min((s for s in starts if s >= w["end"]), default=w["end"])
        if spans and before <= spans[-1][1]:
            spans[-1][1] = max(spans[-1][1], after)
        else:
            spans.append([before, after])
    return [(round(a, 2), round(b, 2)) for a, b in spans if b - a >= min_s]


def silent_spans(words: list[dict], total: float, min_s: float = RETRY_GAP_S) -> list[tuple[float, float]]:
    """Stretches of min_s or more with no word at all: over music speech-to-text often writes nothing instead of
    looping (the eval's Gujarati clip: 243 words in 9 minutes of talk). A real pause sent again just stays empty."""
    edges = [0.0] + [x for w in words for x in (w["start"], w["end"])] + [total]
    return [(round(a, 2), round(b, 2)) for a, b in zip(edges[::2], edges[1::2]) if b - a >= min_s]


def merge(spans: list[tuple[float, float]]) -> list[tuple[float, float]]:
    out: list[list[float]] = []
    for a, b in sorted(spans):
        if out and a <= out[-1][1]:
            out[-1][1] = max(out[-1][1], b)
        else:
            out.append([a, b])
    return [(a, b) for a, b in out]


Piece = tuple[float, float, float, float]  # (sent from, sent to, replaced from, replaced to): the padding is context


def pieces(spans: list[tuple[float, float]], total: float, pad: float = RETRY_PAD_S,
           most: float = RETRY_PIECE_S) -> list[Piece]:
    """The stretches to send again: each span cut into pieces of at most `most` seconds, each sent with `pad` seconds
    of context on both sides; only the span itself is replaced."""
    out = []
    for a, b in spans:
        n = max(1, -(-(b - a) // most))
        step = (b - a) / n
        for k in range(int(n)):
            ca, cb = round(a + k * step, 2), round(a + (k + 1) * step, 2)
            out.append((round(max(0.0, ca - pad), 2), round(min(total, cb + pad), 2), ca, cb))
    return out[:RETRY_MAX_PIECES]


def splice(words: list[dict], piece: Piece, again: list[dict], dropped: int) -> list[dict] | None:
    """words with the piece's replaced stretch taken from `again` (already on the original clock), or None when
    `again` isn't better there: no more words than were there, or mostly loops itself."""
    a, b = piece[2], piece[3]
    inside = [w for w in words if a <= w["start"] < b]
    new = [w for w in again if a <= w["start"] < b]
    if len(new) <= len(inside) or dropped > RETRY_MAX_LOOPS * (dropped + len(again)):
        return None
    return sorted([w for w in words if not a <= w["start"] < b] + new, key=lambda w: w["start"])


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


def transcript_file(out_dir: Path, language: str | None, force: bool = False, title: str | None = None) -> dict:
    """work/transcript.json for out_dir/voice.m4a, made once per tagged language (default English): the cleaned
    audio's words, the language check for an English tag, and the proofread copy with TRANSCRIPT_PROOFREAD=claude
    (title: the dish, its context)."""
    path, tagged = out_dir / "work" / FILE, language or "en"
    result = json.loads(path.read_text()) if path.exists() and not force else None
    if result and result.get("tagged_language", result.get("language")) != tagged:
        result = None
    if result is None:
        t0, voice = time.monotonic(), out_dir / "voice.m4a"
        result = transcribe_clean(voice, tagged)
        why = doubtful_english(result) if tagged == "en" else None
        if why:
            found, how = check_language(voice, result["duration"], why)
            if found != "en":
                result = transcribe_clean(voice, found)
            result["language_note"] = f"tagged English, but {why}: {how}"
            print(f"[transcribe] {out_dir.name}: {result['language_note']}", flush=True)
        result["tagged_language"] = tagged
        print(f"[transcribe] {out_dir.name}: {len(result['words'])} words ({result['language']}; "
              f"{result['loop_words_dropped']} looped words dropped, {result.get('cut_s', 0):.0f} s of pauses cut) "
              f"in {time.monotonic() - t0:.0f} s", flush=True)
    if (claude.provider("TRANSCRIPT_PROOFREAD") == "claude" and result["language"] in PROOFREAD_LANGUAGES
            and "proofread" not in result):
        gen = claude.ClaudeText(os.environ.get("CLAUDE_PROOFREAD_MODEL") or PROOFREAD_MODEL)
        fixed, tokens = proofread(lines(result["words"], max_s=PROOFREAD_LINE_S), result["language"],
                                  title or "this dish", gen)
        result["proofread"] = {"model": gen.model, "lines": fixed, "tokens": tokens}
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(result, ensure_ascii=False, indent=1) + "\n")
    return result


def check_language(voice: Path, duration: float, why: str) -> tuple[str, str]:
    """detect_language with its failures caught: English, said why, when it can't run."""
    try:
        return detect_language(voice, duration, claude.ClaudeText(LANGUAGE_MODEL, effort="low"))
    except Exception as e:  # noqa: BLE001 - the check is a guard: never fail the run over it
        return "en", f"the language check failed ({type(e).__name__}: {str(e)[:200]})"


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
    for line in spoken_lines(result)[:20]:
        print(f"  {line['start']:7.1f}-{line['end']:7.1f}  {line['text']}")


if __name__ == "__main__":
    main()
