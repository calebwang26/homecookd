// TEST-ONLY. A page init script that answers getUserMedia({audio}) in the e2e runs, so they don't
// depend on Chrome's --use-fake-device-for-media-stream (on some Macs it never answers, on any site).
// Never shipped: only web/scripts/qa imports it, into Playwright's addInitScript.
//
//   'synthetic'  a live stream: a 220 Hz tone at about −10 dBFS through MediaStreamDestination, so
//                MediaRecorder records real audio and the page's silence check hears it
//   'denied'     rejects with NotAllowedError, as "Don't Allow" does
//   'hung'       never settles, as a permission prompt left open (or a browser that never answers)
//   'device'     leaves getUserMedia alone (Chrome's fake device, with its launch flags)

/** @param {'synthetic' | 'denied' | 'hung' | 'device'} mode */
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
