"""Render a .dc.html artboard with a tiny stand-in for the canvas runtime (runs the logic class,
expands <sc-for>/<sc-if>, fills {{holes}}), then screenshot with headless Chrome.

    python3 render2.py <file.dc.html> <out.png> [--scale 2] [--state '{"key": value}']

--state merges into the component's state before renderVals() (to show other interactive states).
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

RUNTIME = r"""
<script>
(function(){
  class DCLogic { constructor(p){ this.props = p || {}; this.state = {}; } setState(s){ Object.assign(this.state, typeof s === 'function' ? s(this.state) : s); } forceUpdate(){} }
  const src = document.getElementById('dc-src').textContent;
  const props = JSON.parse(document.getElementById('dc-props').textContent);
  const extra = JSON.parse(document.getElementById('dc-state').textContent);
  let vals = {};
  try {
    const Component = (new Function('DCLogic', src + '\n;return Component;'))(DCLogic);
    const c = new Component(props);
    c.state = Object.assign({}, c.state || {}, extra);
    vals = c.renderVals() || {};
  } catch (e) { document.title = 'DCERROR ' + e.message; }
  const root = Object.assign({}, props, vals);
  function lookup(p, scope){
    p = p.trim();
    if (p === 'true') return true; if (p === 'false') return false; if (p === 'null') return null;
    if (/^-?\d+(\.\d+)?$/.test(p)) return +p;
    if (/^'.*'$|^".*"$/.test(p)) return p.slice(1, -1);
    let v = scope; for (const k of p.split('.')) { if (v == null) return undefined; v = v[k]; } return v;
  }
  function interp(str, scope){ return str.replace(/\{\{\s*([^}]+?)\s*\}\}/g, (m, p) => { const v = lookup(p, scope); return (v == null || typeof v === 'function') ? '' : String(v); }); }
  function walk(node, scope, out){
    if (node.nodeType === 3) { out.push(document.createTextNode(interp(node.nodeValue, scope))); return; }
    if (node.nodeType !== 1) return;
    const tag = node.localName;
    if (tag === 'sc-for') {
      const list = lookup((node.getAttribute('list') || '').replace(/^\{\{|\}\}$/g, ''), scope) || [];
      const as = node.getAttribute('as') || 'item';
      list.forEach((item, i) => { const s = Object.assign({}, scope, {[as]: item, $index: i}); node.childNodes.forEach(ch => walk(ch, s, out)); });
      return;
    }
    if (tag === 'sc-if') {
      const v = lookup((node.getAttribute('value') || '').replace(/^\{\{|\}\}$/g, ''), scope);
      if (v) node.childNodes.forEach(ch => walk(ch, scope, out));
      return;
    }
    const el = node.cloneNode(false);
    for (const a of Array.from(node.attributes)) {
      if (/^on/i.test(a.name)) { el.removeAttribute(a.name); continue; }
      if (a.name.startsWith('hint-')) { el.removeAttribute(a.name); continue; }
      if (a.value.indexOf('{{') >= 0) el.setAttribute(a.name, interp(a.value, scope));
    }
    const kids = []; node.childNodes.forEach(ch => walk(ch, scope, kids)); kids.forEach(k => el.appendChild(k));
    out.push(el);
  }
  const tpl = document.getElementById('dc-tpl').content;
  const out = []; tpl.childNodes.forEach(ch => walk(ch, root, out));
  out.forEach(n => document.body.appendChild(n));
})();
</script>
"""


def build(src: str, extra_state: dict) -> tuple[str, int, int, list[str]]:
    warnings: list[str] = []
    m = re.search(r"data-props='(.*?)'", src, re.S)
    props_decl = {}
    if m:
        try:
            props_decl = json.loads(html.unescape(m.group(1)))
        except json.JSONDecodeError as e:
            warnings.append(f"data-props is not valid JSON: {e}")
    prev = props_decl.get("$preview", {})
    w, h = int(prev.get("width", 390)), int(prev.get("height", 844))
    props = {k: v["default"] for k, v in props_decl.items() if isinstance(v, dict) and "default" in v}
    xdc = re.search(r"<x-dc>(.*)</x-dc>", src, re.S)
    if not xdc:
        raise SystemExit("no <x-dc> block")
    body = xdc.group(1)
    helmet = ""
    hm = re.search(r"<helmet>(.*?)</helmet>", body, re.S)
    if hm:
        helmet = hm.group(1)
        body = body.replace(hm.group(0), "")
    sm = re.search(r'<script type="text/x-dc" data-dc-script[^>]*>(.*?)</script>', src, re.S)
    logic = sm.group(1) if sm else "class Component extends DCLogic { renderVals(){ return {}; } }"

    def blob(mm: re.Match) -> str:
        url = mm.group(0)
        if url in BLOB_TO_FILE:
            return Path(BLOB_TO_FILE[url]).as_uri()
        warnings.append(f"unknown asset url {url}")
        return url

    body = re.sub(r"/_blob/[0-9a-f]{32}", blob, body)
    helmet = re.sub(r"/_blob/[0-9a-f]{32}", blob, helmet)
    logic = re.sub(r"/_blob/[0-9a-f]{32}", blob, logic)
    page = (
        "<!doctype html><html><head><meta charset='utf-8'>"
        f"<style>html,body{{margin:0;padding:0;width:{w}px;height:{h}px;overflow:hidden}}</style>"
        f"{helmet}</head><body>"
        f"<template id='dc-tpl'>{body}</template>"
        f"<script type='text/plain' id='dc-src'>{logic}</script>"
        f"<script type='application/json' id='dc-props'>{json.dumps(props)}</script>"
        f"<script type='application/json' id='dc-state'>{json.dumps(extra_state)}</script>"
        f"{RUNTIME}</body></html>"
    )
    return page, w, h, warnings


def main() -> None:
    argv = sys.argv[1:]
    scale, state = 2, {}
    if "--scale" in argv:
        i = argv.index("--scale"); scale = int(argv[i + 1]); del argv[i:i + 2]
    if "--state" in argv:
        i = argv.index("--state"); state = json.loads(argv[i + 1]); del argv[i:i + 2]
    src_path = Path(argv[0]).resolve()
    out = Path(argv[1]).resolve()
    page, w, h, warnings = build(src_path.read_text(), state)
    (KIT / "tmp").mkdir(exist_ok=True)
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
