"""Live view of the glasses in your browser, plus discovery so the glasses find
this laptop without typing an IP address.

    http://localhost:8000/            live video, audio level, status, "Listen" button
    http://localhost:8000/video.mjpg  raw live video (MJPEG), usable from OpenCV etc.
    http://localhost:8000/latest.jpg  the newest frame
    http://localhost:8000/audio.pcm   live audio: raw s16le, 16 kHz, mono, streamed
    http://localhost:8000/status.json connection, fps, audio level, markers
"""
from __future__ import annotations

import asyncio
import json
import socket
import time
from collections import deque

import numpy as np

DISCOVERY_PORT = 7071


class LiveHub:
    def __init__(self) -> None:
        self.latest_jpeg: bytes | None = None
        self.video_subs: set[asyncio.Queue] = set()
        self.audio_subs: set[asyncio.Queue] = set()
        self.frame_times: deque[float] = deque(maxlen=50)
        self.session_id = ""
        self.camera = ""
        self.mode = ""
        self.connected = 0
        self.last_packet_wall = 0.0
        self.audio_level = 0.0
        self.markers = 0
        self.session_t = 0.0
        self.frame_size = 0

    # ---- fed by receiver.py ----
    def hello(self, hello: dict) -> None:
        self.session_id = hello.get("session_id", "")
        self.camera = hello.get("sensor", "")
        self.mode = hello.get("mode", "")

    def frame(self, jpeg: bytes, t: float) -> None:
        self.latest_jpeg = jpeg
        self.frame_size = len(jpeg)
        self.frame_times.append(time.time())
        self._touch(t)
        for q in list(self.video_subs):
            if q.full():
                try:
                    q.get_nowait()  # drop the stale frame; viewers always get the newest
                except asyncio.QueueEmpty:
                    pass
            q.put_nowait(jpeg)

    def audio(self, pcm: bytes, t: float) -> None:
        x = np.frombuffer(pcm, dtype="<i2").astype(np.float32)
        rms = float(np.sqrt((x * x).mean())) if x.size else 0.0
        self.audio_level = 0.7 * self.audio_level + 0.3 * min(1.0, rms / 8000)
        self._touch(t)
        for q in list(self.audio_subs):
            if not q.full():
                q.put_nowait(pcm)

    def event(self, ev: dict, t: float) -> None:
        if ev.get("event") == "marker":
            self.markers += 1
        if ev.get("mode"):
            self.mode = ev["mode"]
        self._touch(t)

    def _touch(self, t: float) -> None:
        self.last_packet_wall = time.time()
        self.session_t = max(self.session_t, t)

    def status(self) -> dict:
        now = time.time()
        recent = [x for x in self.frame_times if now - x <= 5]
        live = now - self.last_packet_wall < 3
        return {
            "live": live, "connections": self.connected, "session_id": self.session_id,
            "camera": self.camera, "mode": self.mode,
            "fps": round(len(recent) / 5, 1) if live else 0.0,
            "frame_kb": round(self.frame_size / 1024, 1),
            "audio_level": round(self.audio_level, 3) if live else 0.0,
            "markers": self.markers, "session_seconds": round(self.session_t, 1),
        }


PAGE = """<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Glasses live</title><style>
:root{--bg:#fafaf8;--fg:#1d1d1b;--muted:#6b6b66;--line:#ddddd6;--ok:#2e7d32;--bad:#b3261e;--accent:#2563eb}
@media (prefers-color-scheme:dark){:root{--bg:#171716;--fg:#ececea;--muted:#a3a39d;--line:#34342f;--ok:#7bc47f;--bad:#f2867d;--accent:#7aa7ff}}
body{margin:0;background:var(--bg);color:var(--fg);font:15px/1.45 system-ui,-apple-system,sans-serif}
main{max-width:980px;margin:0 auto;padding:16px}h1{font-size:18px;margin:0 0 12px}
.grid{display:grid;grid-template-columns:1fr 260px;gap:16px}@media(max-width:760px){.grid{grid-template-columns:1fr}}
.video{background:#000;border-radius:8px;overflow:hidden;aspect-ratio:16/9;display:flex;align-items:center;justify-content:center}
.video img{width:100%;height:100%;object-fit:contain}
.panel{border:1px solid var(--line);border-radius:8px;padding:12px}
.row{display:flex;justify-content:space-between;padding:4px 0;border-bottom:1px solid var(--line)}.row:last-child{border:0}
.k{color:var(--muted)}.dot{display:inline-block;width:9px;height:9px;border-radius:50%;margin-right:6px}
.meter{height:10px;border-radius:5px;background:var(--line);overflow:hidden;margin:6px 0 12px}.meter div{height:100%;width:0;background:var(--accent);transition:width .15s}
button{font:inherit;padding:8px 12px;border-radius:6px;border:1px solid var(--line);background:transparent;color:var(--fg);cursor:pointer;width:100%}
p.hint{color:var(--muted);font-size:13px}
</style></head><body><main>
<h1><span class="dot" id="dot"></span><span id="state">Waiting for the glasses</span></h1>
<div class="grid"><div class="video"><img src="/video.mjpg" alt="live camera"></div>
<div class="panel"><div class="k">Microphone level</div><div class="meter"><div id="lvl"></div></div>
<button id="listen">Listen to the microphone</button>
<div style="height:12px"></div>
<div class="row"><span class="k">Frames / s</span><span id="fps">0</span></div>
<div class="row"><span class="k">Frame size</span><span id="kb">-</span></div>
<div class="row"><span class="k">Camera</span><span id="cam">-</span></div>
<div class="row"><span class="k">Mode</span><span id="mode">-</span></div>
<div class="row"><span class="k">Step markers</span><span id="mk">0</span></div>
<div class="row"><span class="k">Session time</span><span id="st">0 s</span></div>
<p class="hint">Raw streams for your own code: <code>/video.mjpg</code>, <code>/latest.jpg</code>, <code>/audio.pcm</code> (16 kHz s16le mono), <code>/status.json</code>.</p>
</div></div></main><script>
const $=id=>document.getElementById(id);
async function poll(){try{const s=await (await fetch('/status.json')).json();
$('dot').style.background=s.live?'var(--ok)':'var(--bad)';
$('state').textContent=s.live?('Live: session '+s.session_id):(s.connections?'Connected, no data yet':'Waiting for the glasses');
$('fps').textContent=s.fps;$('kb').textContent=s.frame_kb+' KB';$('cam').textContent=s.camera||'-';
$('mode').textContent=s.mode||'-';$('mk').textContent=s.markers;$('st').textContent=s.session_seconds+' s';
$('lvl').style.width=Math.round(s.audio_level*100)+'%';}catch(e){}setTimeout(poll,500)}poll();
let ctx=null;
$('listen').onclick=async()=>{if(ctx){ctx.close();ctx=null;$('listen').textContent='Listen to the microphone';return}
ctx=new (window.AudioContext||window.webkitAudioContext)();$('listen').textContent='Stop listening';
const r=(await fetch('/audio.pcm')).body.getReader();let next=0,carry=new Uint8Array(0);
while(ctx){const {value,done}=await r.read();if(done)break;
let b=new Uint8Array(carry.length+value.length);b.set(carry);b.set(value,carry.length);
const n=Math.floor(b.length/2);carry=b.slice(n*2);if(!n||!ctx)continue;
const dv=new DataView(b.buffer,0,n*2),buf=ctx.createBuffer(1,n,16000),ch=buf.getChannelData(0);
for(let i=0;i<n;i++)ch[i]=dv.getInt16(i*2,true)/32768;
const src=ctx.createBufferSource();src.buffer=buf;src.connect(ctx.destination);
next=Math.max(next,ctx.currentTime+0.15);src.start(next);next+=buf.duration;}
r.cancel();};
</script></body></html>"""


async def _handle_http(reader: asyncio.StreamReader, writer: asyncio.StreamWriter, hub: LiveHub) -> None:
    try:
        head = await asyncio.wait_for(reader.readuntil(b"\r\n\r\n"), timeout=10)
    except Exception:
        writer.close()
        return
    path = head.split(b" ", 2)[1].decode(errors="ignore").split("?")[0] if b" " in head else "/"

    async def send(status: str, ctype: str, body: bytes, extra: str = "") -> None:
        writer.write((f"HTTP/1.1 {status}\r\nContent-Type: {ctype}\r\nContent-Length: {len(body)}\r\n"
                      f"Cache-Control: no-store\r\nAccess-Control-Allow-Origin: *\r\n{extra}Connection: close\r\n\r\n").encode() + body)
        await writer.drain()

    try:
        if path == "/":
            await send("200 OK", "text/html; charset=utf-8", PAGE.encode())
        elif path == "/status.json":
            await send("200 OK", "application/json", json.dumps(hub.status()).encode())
        elif path == "/latest.jpg":
            if hub.latest_jpeg:
                await send("200 OK", "image/jpeg", hub.latest_jpeg)
            else:
                await send("404 Not Found", "text/plain", b"no frame yet")
        elif path == "/video.mjpg":
            writer.write(b"HTTP/1.1 200 OK\r\nContent-Type: multipart/x-mixed-replace; boundary=frame\r\n"
                         b"Cache-Control: no-store\r\nAccess-Control-Allow-Origin: *\r\nConnection: close\r\n\r\n")
            q: asyncio.Queue = asyncio.Queue(maxsize=1)
            if hub.latest_jpeg:
                q.put_nowait(hub.latest_jpeg)
            hub.video_subs.add(q)
            try:
                while True:
                    jpeg = await q.get()
                    writer.write(b"--frame\r\nContent-Type: image/jpeg\r\nContent-Length: "
                                 + str(len(jpeg)).encode() + b"\r\n\r\n" + jpeg + b"\r\n")
                    await writer.drain()
            finally:
                hub.video_subs.discard(q)
        elif path == "/audio.pcm":
            writer.write(b"HTTP/1.1 200 OK\r\nContent-Type: application/octet-stream\r\n"
                         b"X-Audio-Format: s16le; rate=16000; channels=1\r\nTransfer-Encoding: chunked\r\n"
                         b"Cache-Control: no-store\r\nAccess-Control-Allow-Origin: *\r\nConnection: close\r\n\r\n")
            q = asyncio.Queue(maxsize=50)
            hub.audio_subs.add(q)
            try:
                while True:
                    pcm = await q.get()
                    writer.write(f"{len(pcm):X}\r\n".encode() + pcm + b"\r\n")
                    await writer.drain()
            finally:
                hub.audio_subs.discard(q)
        else:
            await send("404 Not Found", "text/plain", b"not found")
    except (ConnectionError, asyncio.CancelledError):
        pass
    finally:
        try:
            writer.close()
        except Exception:
            pass


async def start_live_server(hub: LiveHub, port: int):
    return await asyncio.start_server(lambda r, w: _handle_http(r, w, hub), host="0.0.0.0", port=port)


def _broadcast_targets() -> list[str]:
    targets = ["255.255.255.255"]
    try:
        s = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
        s.connect(("8.8.8.8", 80))
        ip = s.getsockname()[0]
        s.close()
        a, b, c, _ = ip.split(".")
        targets.append(f"{a}.{b}.{c}.255")          # most home / venue networks (/24)
        if ip.startswith("172.20.10."):
            targets.append("172.20.10.15")         # iPhone Personal Hotspot (/28)
    except OSError:
        pass
    return targets


async def discovery_beacon(tcp_port: int, interval: float = 1.0) -> None:
    """Tell the glasses where this laptop is, once a second."""
    sock = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
    sock.setsockopt(socket.SOL_SOCKET, socket.SO_BROADCAST, 1)
    msg = f"EDG-RECEIVER {tcp_port}".encode()
    while True:
        for target in _broadcast_targets():
            try:
                sock.sendto(msg, (target, DISCOVERY_PORT))
            except OSError:
                pass  # no network yet (e.g. hotspot not joined); try again next second
        await asyncio.sleep(interval)
