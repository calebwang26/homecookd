"""Laptop-side receiver for the Edible capture glasses.

Listens for the glasses over Wi-Fi, saves every packet as it arrives, cuts each
15-minute chunk as soon as it is complete (and, with --extract, sends it to
Gemini right away), and builds the full session folder when recording stops.

    python receiver.py --cook "Ammi" --relationship mother \
        --languages Urdu,English --dish "Chicken biryani" --extract

Then on the glasses: hold BOOT 1.5 s to start, tap for each new step, hold to stop.
"""
from __future__ import annotations

import argparse
import asyncio
import json
import socket
import sys
import time
from concurrent.futures import ThreadPoolExecutor
from datetime import datetime, timedelta, timezone
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
sys.path.insert(0, str(Path(__file__).resolve().parent.parent / "pipeline"))

from edg_protocol import END, EVENT, HELLO, JPEG, MODES, PCM, Reassembler, StreamParser, write_packet  # noqa: E402
import session_builder as sb  # noqa: E402
import live  # noqa: E402
import hooks  # noqa: E402  (your live-processing code)

hub = live.LiveHub()
bridge = None  # cloud_bridge.CloudBridge with --cloud


def call_hook(name: str, *args) -> None:
    try:
        getattr(hooks, name)(*args)
    except Exception as e:  # a bug in your hook must not stop the stream
        print(f"[hooks] {name} raised {type(e).__name__}: {e}")

pool = ThreadPoolExecutor(max_workers=2)


class SessionState:
    def __init__(self, session_dir: Path):
        self.dir = session_dir
        self.max_t = 0.0
        self.built_chunks: set[int] = set()
        self.pending: set[int] = set()
        self.finished = False
        self.out = None          # raw packet file for this run
        self.hello_seen = False


sessions: dict[str, SessionState] = {}


def local_ip() -> str:
    s = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
    try:
        s.connect(("8.8.8.8", 80))
        return s.getsockname()[0]
    except OSError:
        return "127.0.0.1"
    finally:
        s.close()


def run_extract(session_dir: Path, chunk_index: int | None, args) -> None:
    import extract  # pipeline/extract.py
    try:
        if chunk_index is None:
            extract.process_session(session_dir, model=args.model, resolution=args.resolution)
        else:
            extract.process_chunk(session_dir, chunk_index, model=args.model, resolution=args.resolution)
    except Exception as e:  # keep receiving even if Gemini fails
        print(f"[gemini] {session_dir.name} chunk {chunk_index}: {e}")


def build_live_chunk(st: SessionState, k: int, start: float, end: float, args) -> None:
    try:
        meta = json.loads((st.dir / "meta.json").read_text())
        session = sb.load_session(sb.raw_files_for(st.dir))
        sb.build_chunk(session, st.dir, meta, k, start, end, args.fps)
        st.built_chunks.add(k)
        print(f"[chunk] {st.dir.name} chunk {k:02d} ready ({sb.mmss(start)}-{sb.mmss(end)})")
        if args.extract:
            run_extract(st.dir, k, args)
    except Exception as e:
        print(f"[chunk] failed for chunk {k}: {e}")
    finally:
        st.pending.discard(k)


def finish_session(st: SessionState, args) -> None:
    # Wait for any chunk still being built live.
    while st.pending:
        time.sleep(0.5)
    if args.no_build:
        print(f"[done] raw packets saved in {st.dir / 'raw'} (--no-build: skipping MP4s)")
        return
    print(f"[done] building {st.dir} ...")
    session = sb.build_all(st.dir, fps=args.fps, skip_chunks=set(st.built_chunks))
    print(f"[done] {session.duration:.0f} s recorded, {len(session.markers)} step markers, "
          f"{len(session.gaps)} gaps. Files in {st.dir}")
    if session.gaps:
        print("        Wi-Fi gaps found. After cooking, copy EDG/<id>.bin off the SD card and run:\n"
              f"        python session_builder.py {st.dir} --sd /path/to/{session.session_id}.bin")
    if args.extract:
        run_extract(st.dir, None, args)


def maybe_cut_chunks(st: SessionState, args, loop) -> None:
    """A chunk is cut once the stream is safely past its end."""
    for k, start, end in sb.chunk_ranges(st.max_t):
        complete = end == (k + 1) * sb.CHUNK_SECONDS and st.max_t >= end + 5
        if complete and k not in st.built_chunks and k not in st.pending:
            st.pending.add(k)
            loop.run_in_executor(pool, build_live_chunk, st, k, start, end, args)


def open_session(sid: str, hello: dict, t_ms: int, peer: str, args) -> SessionState:
    """Session dir + meta.json on first sight; one raw file per receiver run."""
    st = sessions.get(sid)
    if st is None:
        session_dir = args.out / sid
        (session_dir / "raw").mkdir(parents=True, exist_ok=True)
        meta_path = session_dir / "meta.json"
        if not meta_path.exists():
            started = datetime.now(timezone.utc) - timedelta(milliseconds=t_ms)
            meta_path.write_text(json.dumps({
                "started_at_ms": int(started.timestamp() * 1000),
                "cook_name": args.cook, "relationship": args.relationship,
                "spoken_languages": [x.strip() for x in args.languages.split(",") if x.strip()],
                "dish_name": args.dish, "started_at": started.isoformat(timespec="seconds"),
                "consent_recorded_at": args.consent_at, "license_opt_in": args.license_opt_in,
            }, indent=2))
        st = sessions[sid] = SessionState(session_dir)
        st.out = open(session_dir / "raw" / f"live_{int(time.time() * 1000)}.bin", "ab")
        st.hello_seen = False
        print(f"[new] session {sid} from {peer}")
        if bridge:
            bridge.session_opened(sid, session_dir)
    if hello.get("sensor") and not st.hello_seen:
        st.hello_seen = True
        print(f"      camera {hello.get('sensor')}")
        hub.hello(hello)
        call_hook("on_session_start", sid, hello)
    return st


def process_packet(st: SessionState, p, args, loop) -> None:
    """Everything one packet triggers: save it, live view, your hooks, session end."""
    # With --cloud, footage is kept only between her Start and Stop in the app (bridge.storing); the hello
    # and the end are tiny and always kept. Without --cloud, everything is kept, as before.
    if not bridge or p.type in (HELLO, END) or bridge.storing(st.dir.name):
        write_packet(st.out, p)
    if p.type == HELLO:
        return
    st.max_t = max(st.max_t, p.t)
    if bridge:
        bridge.packet(st.dir.name, p)
    if p.type == JPEG:
        hub.frame(p.payload, p.t)
        call_hook("on_frame", p.payload, p.t, MODES.get(p.mode, "ai"))
    elif p.type == PCM:
        hub.audio(p.payload, p.t)
        call_hook("on_audio", p.payload, p.t)
    elif p.type == EVENT:
        ev = p.json()
        hub.event(ev, p.t)
        call_hook("on_event", ev, p.t)
        if ev.get("event") == "marker":
            print(f"  step marker at {sb.mmss(p.t)}")
        elif ev.get("event") == "mode":
            print(f"  mode -> {ev.get('mode')} at {sb.mmss(p.t)}")
    if p.type == END and not st.finished:
        st.finished = True
        st.out.flush()
        call_hook("on_session_end", st.dir.name, st.dir)
        loop.run_in_executor(pool, finish_session, st, args)
    elif not st.finished:
        maybe_cut_chunks(st, args, loop)


async def handle(reader: asyncio.StreamReader, writer: asyncio.StreamWriter, args) -> None:
    """TCP transport (firmware TRANSPORT_UDP 0)."""
    peer = writer.get_extra_info("peername")[0]
    parser = StreamParser()
    st: SessionState | None = None
    loop = asyncio.get_running_loop()
    hub.connected += 1
    print(f"[link] glasses connected over TCP from {peer}")
    try:
        while True:
            chunk = await reader.read(65536)
            if not chunk:
                break
            for p in parser.feed(chunk):
                if p.type == HELLO:
                    hello = p.json()
                    st = open_session(hello["session_id"], hello, p.t_ms, peer, args)
                if st is not None:
                    process_packet(st, p, args, loop)
            if st:
                st.out.flush()
    finally:
        hub.connected -= 1
        print(f"[link] glasses disconnected ({peer})")
        writer.close()


class UdpReceiver(asyncio.DatagramProtocol):
    """UDP transport (firmware TRANSPORT_UDP 1, the default): no connection to drop."""

    def __init__(self, args) -> None:
        self.args = args
        self.reasm = Reassembler()
        self.loop = asyncio.get_running_loop()
        self.last_flush = 0.0
        self.peer = ""

    def datagram_received(self, data: bytes, addr) -> None:
        got = self.reasm.feed(data)
        if hasattr(hub, "udp_stats"):  # older live.py has no "Packets lost" row
            hub.udp_stats(self.reasm.completed, self.reasm.expired)
        if not got:
            return
        sid, p = got
        if addr[0] != self.peer:
            self.peer = addr[0]
            print(f"[link] glasses streaming over UDP from {self.peer}")
        hello = p.json() if p.type == HELLO else {}
        st = open_session(sid, hello, p.t_ms, addr[0], self.args)
        process_packet(st, p, self.args, self.loop)
        now = time.time()
        if now - self.last_flush > 1:
            self.last_flush = now
            st.out.flush()


async def main_async(args) -> None:
    server = await asyncio.start_server(lambda r, w: handle(r, w, args), host="0.0.0.0", port=args.port)
    loop = asyncio.get_running_loop()
    udp_transport, _ = await loop.create_datagram_endpoint(lambda: UdpReceiver(args), local_addr=("0.0.0.0", args.port))
    try:  # a bigger socket buffer absorbs bursts of video fragments
        udp_transport.get_extra_info("socket").setsockopt(socket.SOL_SOCKET, socket.SO_RCVBUF, 4 * 1024 * 1024)
    except OSError:
        pass
    web = await live.start_live_server(hub, args.live_port)
    if args.cloud:
        global bridge
        import cloud_bridge
        bridge = cloud_bridge.CloudBridge(args)
        bridge.start(loop)
    if not args.no_discovery:
        asyncio.create_task(live.discovery_beacon(args.port))
    print(f"Receiver on {local_ip()}:{args.port} "
          f"({'glasses find it automatically' if not args.no_discovery else 'set RECEIVER_HOST in config.h to this IP'})")
    print(f"Live view:  http://localhost:{args.live_port}")
    print(f"Sessions are saved in {args.out.resolve()}")
    async with server, web:
        await asyncio.gather(server.serve_forever(), web.serve_forever())


def parse_args(argv=None):
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--port", type=int, default=7070)
    ap.add_argument("--live-port", type=int, default=8000, help="browser live view")
    ap.add_argument("--no-discovery", action="store_true", help="don't broadcast; use RECEIVER_HOST on the glasses")
    ap.add_argument("--no-build", action="store_true", help="only stream + save raw packets; skip building MP4s")
    ap.add_argument("--out", type=Path, default=Path("sessions"))
    ap.add_argument("--cook", default="", help="who is cooking, e.g. Ammi")
    ap.add_argument("--relationship", default="", help="e.g. mother")
    ap.add_argument("--languages", default="", help="comma-separated, e.g. Urdu,English")
    ap.add_argument("--dish", default="", help="dish name if known")
    ap.add_argument("--consent-at", default="00:00", help="MM:SS where the cook says yes on tape")
    ap.add_argument("--license-opt-in", action="store_true", help="cook agreed to data licensing (default: no)")
    ap.add_argument("--fps", type=int, default=sb.DEFAULT_FPS)
    ap.add_argument("--extract", action="store_true", help="send chunks to Gemini as they finish (needs GEMINI_API_KEY)")
    ap.add_argument("--model", default="gemini-3.8-flash")
    ap.add_argument("--resolution", default="high", choices=["low", "medium", "high"])
    ap.add_argument("--cloud", action="store_true",
                    help="pair with homecookd: relay to the glasses VM, back up to GCS, analyse live, "
                         "upload the full video on \"I'm done\" (see cloud_bridge.py)")
    ap.add_argument("--relay-fps", type=float, default=8, help="frames per second relayed to the VM (0: no relay)")
    ap.add_argument("--no-live", action="store_true", help="with --cloud: no live Gemini analysis")
    ap.add_argument("--frame-every", type=float, default=0.15,
                    help="with --cloud: seconds between frames sent to the phone's live view (0: none; 0.15 = ~7 fps)")
    ap.add_argument("--backup-during", action="store_true",
                    help="with --cloud: copy raw data to GCS every minute while recording (default: after \"I'm done\"; "
                         "the uploads share the hotspot with the glasses and make the stream drop frames)")
    ap.add_argument("--auto-job", action="store_true",
                    help="with --cloud: also start the recipe job on \"I'm done\" (default: just save the video for the phone)")
    ap.add_argument("--cloud-fps", type=int, default=15,
                    help="with --cloud: frame rate of the video uploaded on \"I'm done\" (the glasses send ~23)")
    ap.add_argument("--live-window", type=float, default=30, help="seconds of footage per live analysis call")
    return ap.parse_args(argv)


if __name__ == "__main__":
    try:
        asyncio.run(main_async(parse_args()))
    except KeyboardInterrupt:
        pass