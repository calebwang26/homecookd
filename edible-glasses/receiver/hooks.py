"""Your code goes here: these functions are called live, for every packet
the glasses send, while receiver.py is running.

The data is already in the format Gemini's Live API takes:
    audio  -> raw 16-bit little-endian PCM, 16 kHz, mono  (mime "audio/pcm;rate=16000")
    frames -> JPEG bytes                                   (mime "image/jpeg")
The Live API takes at most 1 frame per second; the glasses send 2 in AI
mode, so send every other frame (see the example in on_frame).

Rules: return quickly (these run on the receiver's network loop). For
anything slow, like a Gemini websocket, push the data onto a queue and do
the work in another thread or asyncio task.

Times (`t`) are seconds since the glasses started this session, on the
glasses' own clock, so audio and frames line up exactly.
"""
from __future__ import annotations


def on_session_start(session_id: str, hello: dict) -> None:
    """New recording session. hello has 'sensor' (camera model), 'mode', 'sample_rate'."""
    pass


def on_frame(jpeg: bytes, t: float, mode: str) -> None:
    """One camera frame.

    Example: forward to a Gemini Live session at 1 fps
        global _last
        if t - _last >= 1.0:
            _last = t
            gemini_queue.put_nowait(("image/jpeg", jpeg))
    """
    pass


def on_audio(pcm: bytes, t: float) -> None:
    """100 ms of microphone audio: 1,600 samples, 3,200 bytes.

    Example: gemini_queue.put_nowait(("audio/pcm;rate=16000", pcm))
    """
    pass


def on_event(event: dict, t: float) -> None:
    """Button events: {'event': 'marker' | 'mode' | 'start' | 'stop', 'mode': ...}."""
    pass


def on_session_end(session_id: str, session_dir) -> None:
    """Recording stopped. session_dir holds the saved raw packets (and, after the
    build finishes, full.mp4 and the 15-min chunks)."""
    pass
