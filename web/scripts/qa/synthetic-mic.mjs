// TEST-ONLY. A page init script that answers getUserMedia({audio}) in the e2e runs, so they don't
// depend on Chrome's --use-fake-device-for-media-stream (on some Macs it never answers, on any site).
// Never shipped: only web/scripts/qa imports it, into Playwright's addInitScript.
//
//   'synthetic'  a live stream: a 220 Hz tone at about −10 dBFS through MediaStreamDestination, so
//                MediaRecorder records real audio and the page's silence check hears it
//   'denied'     rejects with NotAllowedError, as "Don't Allow" does
//   'hung'       never settles, as a permission prompt left open (or a browser that never answers)
//   'no-frames'  a live audio track that never delivers audio, as a mic cut off mid-answer (a call, Siri,
//                another app): Chrome's MediaRecorder then saves a 110-byte webm with only its header
//   'device'     leaves getUserMedia alone (Chrome's fake device, with its launch flags)
//
// The tone is made by an AudioContext, which runs on the clock of the audio output. On Nov 11 this Mac's
// output clock stalled (a bare page's AudioContext said "running" but moved 0.005 s in 1.5 s), so no tone
// flowed and MediaRecorder saved a 110-byte, header-only webm that the page sent as an answer. Launch Chrome
// with AUDIO_ARGS (a fake, timer-driven output: no sound card involved), and call audioClockStalled() first.

/** Chrome's audio output on a fake, timer-driven stream instead of the Mac's sound card. */
export const AUDIO_ARGS = ['--disable-audio-output'];

/**
 * Null when a bare page's audio clock moves; otherwise the line to print and stop on (exit 2), so a stalled
 * clock never reads as a product failure. Call it once, right after launching the browser.
 */
export async function audioClockStalled(browser) {
  const page = await browser.newPage();
  try {
    const moved = await page.evaluate(async () => {
      const ctx = new AudioContext();
      await ctx.resume();
      const t0 = ctx.currentTime;
      await new Promise((r) => setTimeout(r, 1000));
      const s = ctx.currentTime - t0;
      await ctx.close();
      return s;
    });
    if (moved >= 0.5) return null;
    return `This Mac's audio clock is stalled (an AudioContext moved ${moved.toFixed(3)} s in 1 s), so the synthetic mic can't make sound: nothing here was tested. Use --mic device.`;
  } finally {
    await page.close();
  }
}

/** @param {'synthetic' | 'denied' | 'hung' | 'no-frames' | 'device'} mode */
export function micInit(mode) {
  if (mode === 'device') return '';
  return `(() => {
    const mode = ${JSON.stringify(mode)};
    const md = navigator.mediaDevices;
    if (!md) return;
    md.getUserMedia = (c) => {
      if (!c || !c.audio) return Promise.reject(new DOMException('Only audio here', 'NotSupportedError'));
      if (mode === 'denied') return Promise.reject(new DOMException('Permission denied', 'NotAllowedError'));
      if (mode === 'hung') return new Promise(() => {});
      if (mode === 'no-frames') return Promise.resolve(new MediaStream([new MediaStreamTrackGenerator({ kind: 'audio' })]));
      const ctx = new AudioContext();
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.frequency.value = 220;
      gain.gain.value = 0.3;
      const out = ctx.createMediaStreamDestination();
      osc.connect(gain).connect(out);
      osc.start();
      return ctx.resume().then(() => out.stream);
    };
  })();`;
}
