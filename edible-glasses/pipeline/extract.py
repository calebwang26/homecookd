"""Send session chunks to Gemini and merge the results into recipe.json.

    export GEMINI_API_KEY=...
    python extract.py sessions/<session_id>             # all chunks, in parallel, then merge
    python extract.py sessions/<session_id> --chunk 2   # one chunk
    python extract.py sessions/<session_id> --force     # redo chunks that already have results

Uses the Gemini Interactions API as documented at
https://ai.google.dev/gemini-api/docs/video-understanding (checked Oct 2026):
Files API upload -> wait for ACTIVE -> video part first, prompt after it,
static processing at 1 fps, JSON output constrained to schema.ChunkRecipe.
"""
from __future__ import annotations

import argparse
import json
import sys
import time
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
from schema import ChunkRecipe  # noqa: E402
import merge as merge_mod  # noqa: E402

DEFAULT_MODEL = "gemini-3.8-flash"
PROMPT_TEMPLATE = (Path(__file__).resolve().parent / "prompt.md").read_text()


def build_prompt(sidecar: dict) -> str:
    k = sidecar.get("chunk_index", 0)
    overlap = sidecar.get("overlap_with_previous_s", 0)
    overlap_note = (f"Its first {int(overlap)} seconds repeat the end of the previous chunk; "
                    "report steps there anyway, they are deduplicated later." if overlap else
                    "It is the start of the session.")
    markers = ", ".join(m["at"] for m in sidecar.get("markers", [])) or "none"
    gaps = ", ".join(f"{g['start']}-{g['end']}" for g in sidecar.get("gaps", [])) or "none"
    langs = " and ".join(sidecar.get("spoken_languages", [])) or "any language"
    start_s = sidecar.get("chunk_start_s", 0)
    shown = {key: sidecar[key] for key in ("cook_name", "relationship", "spoken_languages", "dish_name",
                                           "capture_mode", "chunk_index", "chunk_start_s",
                                           "chunk_duration_s") if key in sidecar}
    return PROMPT_TEMPLATE.format(
        sidecar=json.dumps(shown, ensure_ascii=False, indent=2), chunk_index=k,
        chunk_start=merge_mod.mmss(start_s), overlap_note=overlap_note,
        markers=markers, gaps=gaps, languages=langs,
    )


def _client():
    try:
        from google import genai
    except ImportError:
        raise SystemExit("Install the SDK first: pip install -r requirements.txt")
    return genai.Client()  # reads GEMINI_API_KEY


def upload(client, path: Path):
    f = client.files.upload(file=str(path))
    while not f.state or f.state.name == "PROCESSING":
        time.sleep(3)
        f = client.files.get(name=f.name)
    if f.state.name != "ACTIVE":
        raise RuntimeError(f"Gemini could not process {path.name}: state {f.state.name}")
    return f


def process_chunk(session_dir: Path, k: int, model: str = DEFAULT_MODEL, resolution: str = "high",
                  force: bool = False, client=None) -> Path:
    chunks = Path(session_dir) / "chunks"
    out = chunks / f"chunk_{k:02d}.recipe.json"
    if out.exists() and not force:
        return out
    video = chunks / f"chunk_{k:02d}.mp4"
    sidecar = json.loads((chunks / f"chunk_{k:02d}.json").read_text())
    client = client or _client()

    t0 = time.time()
    f = upload(client, video)
    interaction = client.interactions.create(
        model=model,
        input=[
            {"type": "video", "uri": f.uri, "mime_type": f.mime_type,
             "processing": {"type": "static", "fps": 1}, "resolution": resolution},
            {"type": "text", "text": build_prompt(sidecar)},
        ],
        response_format={"type": "text", "mime_type": "application/json",
                         "schema": ChunkRecipe.model_json_schema()},
    )
    result = ChunkRecipe.model_validate_json(interaction.output_text)
    out.write_text(result.model_dump_json(indent=2))
    try:
        client.files.delete(name=f.name)  # family video does not need to sit on Google's side
    except Exception:
        pass
    print(f"[gemini] chunk {k:02d}: {len(result.steps)} steps in {time.time() - t0:.0f} s")
    return out


def process_session(session_dir: Path, model: str = DEFAULT_MODEL, resolution: str = "high",
                    force: bool = False, workers: int = 4) -> None:
    session_dir = Path(session_dir)
    session = json.loads((session_dir / "session.json").read_text())
    client = _client()
    ks = [c["chunk_index"] for c in session["chunks"]]
    with ThreadPoolExecutor(max_workers=workers) as pool:  # "Gemini x 4"
        for fut in [pool.submit(process_chunk, session_dir, k, model, resolution, force, client) for k in ks]:
            fut.result()
    recipe = merge_mod.merge(session_dir)
    print(f"[gemini] recipe.json ready: {recipe.title}, {len(recipe.steps)} steps")


def main() -> None:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("session_dir", type=Path)
    ap.add_argument("--chunk", type=int)
    ap.add_argument("--model", default=DEFAULT_MODEL)
    ap.add_argument("--resolution", default="high", choices=["low", "medium", "high"],
                    help="high reads labels and spoon sizes better; low is ~4x cheaper")
    ap.add_argument("--force", action="store_true")
    ap.add_argument("--print-prompt", action="store_true", help="show the prompt for --chunk and exit")
    args = ap.parse_args()
    if args.print_prompt:
        k = args.chunk or 0
        print(build_prompt(json.loads((args.session_dir / "chunks" / f"chunk_{k:02d}.json").read_text())))
        return
    if args.chunk is not None:
        process_chunk(args.session_dir, args.chunk, args.model, args.resolution, args.force)
    else:
        process_session(args.session_dir, args.model, args.resolution, args.force)


if __name__ == "__main__":
    main()
