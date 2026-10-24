"""Render a .dc.html artboard to a PNG for local review (approximation of the canvas runtime).

    python3 render.py <file.dc.html> [out.png] [--scale 2]

- Moves <helmet> contents into <head>, unwraps <x-dc>, drops the dc script block.
- Replaces {{name}} holes with the matching data-props default (simple names only).
- Maps /_blob/<id> image urls to the local copies listed in assets.json.
- Screenshots at the artboard's $preview size with headless Chrome.
Prints the PNG path, plus warnings for anything the canvas would not render the same way.
"""
from __future__ import annotations

import html
import json
import re
import subprocess
import sys
import tempfile
from pathlib import Path

KIT = Path(__file__).resolve().parent
ASSETS = json.loads((KIT / "assets.json").read_text())
BLOB_TO_FILE = {a["url"]: a["local"] for a in ASSETS}
CHROME = "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"


def build(src: str) -> tuple[str, int, int, list[str]]:
    warnings: list[str] = []
    m = re.search(r"data-props='(.*?)'", src, re.S)
    props = {}
    if m:
        try:
            props = json.loads(html.unescape(m.group(1)))
        except json.JSONDecodeError as e:
            warnings.append(f"data-props is not valid JSON: {e}")
    prev = props.get("$preview", {})
    w, h = int(prev.get("width", 390)), int(prev.get("height", 844))
    if "<script src=\"./support.js\"></script>" not in src:
        warnings.append('missing the exact <script src="./support.js"></script> head line')
    if not re.search(r'<script type="text/x-dc" data-dc-script', src):
        warnings.append("missing the <script type=\"text/x-dc\" data-dc-script> block")
    for bad in ["<sc-for", "<sc-if", "<dc-import", "innerHTML", "<iframe", "data:image"]:
        if bad in src:
            warnings.append(f"uses {bad} (not previewable / not allowed here)")
    xdc = re.search(r"<x-dc>(.*)</x-dc>", src, re.S)
    if not xdc:
        raise SystemExit("no <x-dc> block")
    body = xdc.group(1)
    helmet = ""
    hm = re.search(r"<helmet>(.*?)</helmet>", body, re.S)
    if hm:
        helmet = hm.group(1)
        body = body.replace(hm.group(0), "")

    def hole(mm: re.Match) -> str:
        key = mm.group(1).strip()
        if key in props and isinstance(props[key], dict) and "default" in props[key]:
            return str(props[key]["default"])
        warnings.append(f"hole {{{{{key}}}}} has no data-props default; rendered empty")
        return ""

    body = re.sub(r"\{\{\s*([^}]+?)\s*\}\}", hole, body)
    helmet = re.sub(r"\{\{\s*([^}]+?)\s*\}\}", hole, helmet)

    def blob(mm: re.Match) -> str:
        url = mm.group(0)
        if url in BLOB_TO_FILE:
            return Path(BLOB_TO_FILE[url]).as_uri()
        warnings.append(f"unknown asset url {url}")
        return url

    body = re.sub(r"/_blob/[0-9a-f]{32}", blob, body)
    helmet = re.sub(r"/_blob/[0-9a-f]{32}", blob, helmet)
    page = (
        "<!doctype html><html><head><meta charset='utf-8'>"
        f"<style>html,body{{margin:0;padding:0;width:{w}px;height:{h}px;overflow:hidden}}</style>"
        f"{helmet}</head><body>{body}</body></html>"
    )
    return page, w, h, warnings


def main() -> None:
    args = [a for a in sys.argv[1:] if not a.startswith("--")]
    scale = 2
    if "--scale" in sys.argv:
        scale = int(sys.argv[sys.argv.index("--scale") + 1])
        args = [a for a in args if a != str(scale)]
    src_path = Path(args[0]).resolve()
    out = Path(args[1]).resolve() if len(args) > 1 else src_path.with_suffix("").with_suffix(".png")
    page, w, h, warnings = build(src_path.read_text())
    with tempfile.NamedTemporaryFile("w", suffix=".html", delete=False, dir=KIT / "tmp") as f:
        f.write(page)
        tmp = f.name
    subprocess.run(
        [CHROME, "--headless=new", "--disable-gpu", "--hide-scrollbars", "--no-first-run",
         "--allow-file-access-from-files", f"--force-device-scale-factor={scale}",
         f"--window-size={w},{h}", "--virtual-time-budget=8000", f"--screenshot={out}", Path(tmp).as_uri()],
        capture_output=True, text=True, timeout=120,
    )
    Path(tmp).unlink(missing_ok=True)
    for warn in warnings:
        print("WARNING:", warn)
    print(out if out.exists() else "RENDER FAILED")


if __name__ == "__main__":
    main()
