// Records scripted, human-paced sessions of the real homecookd web app (localhost:8081) via the CDP
// screencast, then assembles 30 fps H.264 MP4s + poster JPGs.
// Usage: node record.mjs <clip> [<clip>...]
//   tour clips: add recipe watch keep; older clips: library cook share record questions
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { connectBrowser, openCuratedPage, settle, evaluate, sleep, waitFor, filterLog } from './cdp.mjs';

const FFMPEG = '/opt/homebrew/bin/ffmpeg';
const OUT = process.env.OUT || '/Users/calebwang/Documents/GitHub/homecookd/web/public/media/app';
const WORK = path.resolve('frames');
const OUT_W = +(process.env.OUT_W || 780);
const CRF = process.env.CRF || '24';
fs.mkdirSync(OUT, { recursive: true });

const BASE = 'http://localhost:8081';

// app-watch's stand-in footage: a Pexels stock clip ("Grandmother and Granddaughter Baking Together",
// Jelly Marketing), served with Range support by the lander's dev server. No family recipe has
// real video, so Grandma's noodle soup borrows it in memory only (app-recordings.md, clip 9).
const STOCK = '/Users/calebwang/Documents/GitHub/homecookd/web/public/media/stock';
const STAND_IN_VIDEO = 'http://localhost:3000/media/stock/hero-alt-grandma-baking-1080.mp4';
const STAND_IN_STILL = 'http://stand-in.local/grandma-noodle-soup-step-1.jpg';
function withStandInVideo(r) {
  // Step 1 plays 0–10s (the clip's last 2s are a crossfade; a short range moves the transcript's
  // highlight to her second sentence while the recording is still on it). The step's ingredients move inside
  // that range so cook mode still shows their chips; the step keeps its real quote.
  const seen = { flour: 2, salt: 4, 'warm water': 8 };
  return {
    ...r,
    media: { ...r.media, video_url: STAND_IN_VIDEO, audio_url: null, duration_s: 14, width: 1080, height: 608 },
    steps: r.steps.map((st) => (st.order === 1 ? { ...st, start_s: 0, end_s: 10, image_url: STAND_IN_STILL } : st)),
    ingredients: r.ingredients.map((i) => (i.name in seen ? { ...i, first_seen_s: seen[i.name] } : i)),
  };
}

function makeCtx(s) {
  const ev = (expr) => evaluate(s, expr);
  const events = [];
  const mark = (what) => events.push({ t: +((Date.now() / 1000) - (ctx.t0 ?? Date.now() / 1000)).toFixed(2), what });
  const find = async (q, opts = {}) => {
    const r = await ev(`window.__rec.find(${JSON.stringify(q)}, ${JSON.stringify(opts)})`);
    if (!r) throw new Error(`not found: ${q}`);
    return r;
  };
  const touchAt = async (x, y, { lead = 260, after = 260 } = {}) => {
    await ev(`window.__rec.showTouch(${x}, ${y})`);
    await sleep(lead);
    await ev(`window.__rec.pressTouch()`);
    await s('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x, y, radiusX: 8, radiusY: 8, force: 1, id: 1 }] });
    await sleep(95);
    await s('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
    await sleep(70);
    await ev(`window.__rec.hideTouch()`);
    await sleep(after);
  };
  const ctx = {
    events, mark, t0: null,
    ev, find,
    hold: (ms) => sleep(ms),
    async tap(q, opts = {}) {
      const r = await find(q, opts);
      mark(`tap "${q}"`);
      const x = opts.dx != null ? r.left + opts.dx : r.x;
      const y = r.y + (opts.dy ?? 0);
      if (y < 0 || y > 844) throw new Error(`offscreen: ${q} at y=${y}`);
      await touchAt(x, y, opts);
    },
    touchAt,
    scroll: (dy, ms = 900, x = 300) => { mark(`scroll ${dy > 0 ? 'down' : 'up'} (${ms} ms)`); return ev(`window.__rec.smoothScroll(${dy}, ${ms}, true, ${x})`).then((v) => sleep(120).then(() => v)); },
    scrollNoDot: (dy, ms = 900) => ev(`window.__rec.smoothScroll(${dy}, ${ms}, false)`),
    scrollTop: () => ev(`window.__rec.scroller().scrollTop`),
    s,
    async type(text, perChar = 75) {
      mark(`type "${text}"`);
      for (const ch of text) {
        await s('Input.insertText', { text: ch });
        await sleep(perChar + Math.round(Math.random() * 40));
      }
    },
    waitText: (t, timeout = 8000) => waitFor(s, `document.body.innerText.includes(${JSON.stringify(t)})`, timeout),
    settleImages: () => waitFor(s, `[...document.images].every((i) => i.complete)`, 8000).catch(() => {}),
  };
  return ctx;
}

// ---- Clips ----------------------------------------------------------------------------------
const CLIPS = {
  // Tour row 01: Add a recipe, quick. Name the dish, pick Grandma, choose two videos. The file
  // chooser is answered over CDP with two local copies named like iPhone files; nothing uploads
  // (the Upload button is never tapped, and every non-GET request fails anyway).
  add: {
    start: '/upload', ready: 'Auntie Lin',
    pick: ['IMG_4521.MOV', 'IMG_4522.MOV'],
    pickFrom: [`${STOCK}/hero-alt-grandma-baking-1080.mp4`, `${STOCK}/hero-1080.mp4`],
    async run(c) {
      await c.hold(600);
      await c.tap('Dish name', { lead: 180, after: 60 });
      await c.type('Sunday dumplings', 26);
      await c.hold(150);
      await c.tap('Grandma', { nth: 0, lead: 180, after: 100 });
      await c.hold(200);
      await c.tap('Choose videos', { lead: 200, after: 60 });
      await c.waitText('2 videos');
      await c.hold(250);
      await c.scroll(170, 550);
      await c.hold(1300);
    },
    poster: 0.3,
  },

  // Tour row 02 (replaces the 10.7 s version): Grandma's noodle soup, straight to her ingredients,
  // check off flour and salt.
  recipe: {
    start: '/recipe/grandma-hand-pulled-noodle-soup', ready: 'Start cooking',
    async run(c) {
      await c.hold(700);
      const tab = await c.find('Ingredients');
      await c.scroll(tab.top - 120, 900);
      await c.hold(300);
      await c.tap('flour, ', { prefix: true, dx: 22, lead: 220, after: 100 });
      await c.hold(200);
      await c.tap('salt, ', { prefix: true, dx: 22, lead: 220, after: 100 });
      await c.hold(1300);
    },
    poster: 0.3,
  },

  // Tour row 03: cook mode, step 1, tap the big still to Watch: the sheet plays the step's video
  // with Grandma's words as the transcript. The video is the stand-in above.
  watch: {
    start: '/cook/grandma-hand-pulled-noodle-soup?step=1', ready: 'Mix the dough',
    curate: {
      recipeOverrides: { 'grandma-hand-pulled-noodle-soup': withStandInVideo },
      files: { [STAND_IN_STILL]: { path: 'frames/stand-in-step-1.jpg', type: 'image/jpeg', make: [STOCK + '/hero-alt-grandma-baking-1080.mp4', 0.5] } },
    },
    prewarmFetch: [STAND_IN_VIDEO],
    async run(c) {
      await c.hold(800);
      await c.tap('Watch step 1', { lead: 220, after: 60 });
      await waitFor(c.s, `[...document.querySelectorAll('video')].some((v) => !v.paused && v.currentTime > 0.05)`, 8000);
      await c.hold(3700);
    },
    poster: 0.3,
  },

  // Tour row 04: keep it (the family table, Grandma's recipes) and send it (Share on her pork belly).
  keep: {
    // Load the pork belly first and go back inside the app, so the app already holds the recipe
    // when it opens (no "Setting the table…" frame); a fresh page load would forget it.
    start: '/recipe/grandma-red-braised-pork', ready: 'Start cooking',
    async setup(c) {
      await c.tap('Back', { lead: 0, after: 0 });
      await c.waitText('Our');
    },
    async run(c) {
      await c.hold(700);
      await c.tap('Grandma', { lead: 200, after: 100 });
      await c.hold(550);
      await c.tap("Grandma's Red-Braised Pork Belly, by Grandma", { lead: 220, after: 60 });
      await c.waitText('Start cooking');
      await c.settleImages();
      await c.hold(500);
      await c.tap('Share recipe', { lead: 300, after: 100 });
      await c.hold(1400);
    },
    poster: 0.3,
  },

  // "Store": the family table. Scroll the recipes, then filter by a cook & back to everyone.
  library: {
    start: '/', ready: 'Our',
    async run(c) {
      await c.hold(1000);
      const max = await c.ev(`(() => { const el = window.__rec.scroller(); return el.scrollHeight - el.clientHeight; })()`);
      await c.scroll(Math.min(max, 420), 1500);
      await c.hold(1000);
      await c.scroll(-2000, 1300);
      await c.hold(450);
      await c.tap('Dad');
      await c.hold(1500);
      await c.tap('Grandma');
      await c.hold(1500);
      await c.tap('Everyone');
      await c.hold(1100);
    },
    poster: 0.3,
  },

  // Cook mode for Dad's chili: a step, his story, next steps, and what made it special.
  cook: {
    start: '/cook/dad-sunday-chili?step=1', ready: 'Brown the beef hard',
    async run(c) {
      await c.hold(900);
      await c.scroll(200, 900);
      await c.tap('The first pot', { lead: 240, after: 200 });
      await c.hold(350);
      await c.scroll(260, 1000);
      await c.hold(1500);
      await c.tap('Next step', { lead: 300, after: 150 });
      await c.hold(550);
      await c.tap('Next step', { lead: 260, after: 150 });
      await c.hold(800);
      await c.scroll(300, 1000);
      await c.tap('What made it special', { lead: 240, after: 200 });
      await c.hold(300);
      await c.scroll(260, 900);
      await c.hold(1500);
    },
    poster: 5.4,
  },

  // The share moment on Grandma's red-braised pork.
  share: {
    start: '/recipe/grandma-red-braised-pork', ready: 'Start cooking',
    async run(c) {
      await c.hold(1100);
      await c.scroll(330, 1300);
      await c.hold(1500);
      await c.scroll(-2000, 1200);
      await c.hold(500);
      await c.tap('Share recipe', { lead: 380, after: 200 });
      await c.hold(1800);
    },
    poster: 0.4,
  },

  // "Set up your camera, record, done": the before-cooking prompts, then Add a recipe.
  record: {
    start: '/prompts', ready: 'Play aloud', prewarm: ['/upload'],
    async run(c) {
      await c.hold(700);
      await c.tap('Play this prompt aloud', { lead: 240, after: 150 });
      await c.hold(1000);
      for (let i = 0; i < 4; i++) {
        await c.tap('Next prompt', { lead: 200, after: 120 });
        await c.hold(i === 3 ? 750 : 520);
      }
      await c.tap('Upload the videos', { lead: 240, after: 150 });
      await c.waitText('What’s the dish?');
      await c.hold(650);
      await c.tap('Dish name', { lead: 200, after: 120 });
      await c.type('Sunday dumplings', 55);
      await c.hold(350);
      await c.tap('Grandma', { nth: 0, lead: 220, after: 150 });
      await c.hold(1800);
    },
    poster: 0.3,
  },

  // Follow-up questions for Dad: from the recipe's Method tab to the questions.
  questions: {
    start: '/recipe/dad-sunday-chili', ready: 'Start cooking', prewarm: ['/questions/dad-sunday-chili'],
    async run(c) {
      await c.hold(800);
      const tab = await c.find('Method');
      await c.scroll(tab.top - 110, 1200);
      await c.hold(300);
      await c.tap('Method');
      await c.hold(900);
      await c.scroll(2000, 1300);
      await c.hold(500);
      await c.tap('3 questions to ask Dad', { contains: true });
      await c.waitText('Questions for Dad');
      await c.hold(1500);
      // Lift the last question clear of the home indicator while the title stays below the status bar.
      const title = await c.find('Questions for Dad');
      await c.scroll(title.top - 50, 1100);
      await c.hold(1700);
      await c.scroll(-2000, 900);
      await c.hold(900);
    },
    poster: 10.6,
  },
};

// ---- Recording & assembly -------------------------------------------------------------------
function assemble(name, frames, wallDur) {
  const dir = path.join(WORK, name);
  fs.rmSync(dir, { recursive: true, force: true });
  fs.mkdirSync(dir, { recursive: true });
  // The screencast only sends frames on change: resample to constant 30 fps by showing, at each
  // output tick, the latest frame captured at or before it.
  // Timestamps are epoch seconds, aligned with Date.now(): the clip spans exactly the scripted run.
  const tStart = wallDur.t0;
  const tEnd = wallDur.t1 + 0.1;
  frames.forEach((f, i) => fs.writeFileSync(path.join(dir, `f${String(i).padStart(5, '0')}.jpg`), Buffer.from(f.data, 'base64')));
  const seq = path.join(dir, 'seq');
  fs.mkdirSync(seq);
  const n = Math.round((tEnd - tStart) * 30);
  let j = 0;
  for (let k = 0; k < n; k++) {
    const t = tStart + k / 30;
    while (j + 1 < frames.length && frames[j + 1].ts <= t + 1e-4) j++;
    fs.linkSync(path.join(dir, `f${String(j).padStart(5, '0')}.jpg`), path.join(seq, `s${String(k).padStart(5, '0')}.jpg`));
  }
  const mp4 = path.join(OUT, `app-${name}.mp4`);
  const outH = Math.round((OUT_W * 2532) / 1170 / 2) * 2;
  execFileSync(FFMPEG, ['-v', 'error', '-y', '-framerate', '30', '-i', path.join(seq, 's%05d.jpg'),
    '-vf', `scale=${OUT_W}:${outH}:flags=lanczos:in_range=pc:out_range=tv:out_color_matrix=bt709,format=yuv420p`,
    '-c:v', 'libx264', '-preset', 'slow', '-crf', CRF, '-profile:v', 'high', '-tune', 'animation',
    '-color_range', 'tv', '-colorspace', 'bt709', '-color_primaries', 'bt709', '-color_trc', 'bt709',
    '-movflags', '+faststart', '-an', mp4]);
  return { mp4, dur: tEnd - tStart, dir, ticks: n };
}

const cdp = await connectBrowser();
const wanted = process.argv.slice(2).length ? process.argv.slice(2) : Object.keys(CLIPS);
const report = {};
for (const name of wanted) {
  if (!CLIPS[name]) throw new Error(`unknown clip ${name}`);
  console.log(`== recording ${name}`);
  const r = await recordWithId(cdp, name);
  const { mp4, dur } = assemble(name, r.frames, r.wallDur);
  const size = fs.statSync(mp4).size;
  // Poster: a representative frame.
  const jpg = mp4.replace(/\.mp4$/, '.jpg');
  // Poster: a calm, touch-free frame (seconds from the start, or from the end when negative).
  const pt = CLIPS[name].poster;
  execFileSync(FFMPEG, ['-v', 'error', '-y', ...(pt < 0 ? ['-sseof', String(pt)] : ['-ss', String(pt)]), '-i', mp4, '-frames:v', '1', '-q:v', '3', jpg]);
  report[name] = { frames: r.frames.length, dur: +dur.toFixed(2), sizeMB: +(size / 1e6).toFixed(2), shares: r.shares, hiddenNotices: r.hidden, events: r.events };
  console.log(name, JSON.stringify(report[name]));
}
fs.writeFileSync('report.json', JSON.stringify({ report, filterLog }, null, 1));
cdp.close();

async function recordWithId(cdp, name) {
  const clip = CLIPS[name];
  const curate = { ...(clip.curate || {}) };
  if (curate.files) {
    // local stand-in files (e.g. a still from the stand-in video), made on first use
    curate.files = Object.fromEntries(Object.entries(curate.files).map(([url, f]) => {
      const abs = path.resolve(f.path);
      if (f.make && !fs.existsSync(abs)) {
        fs.mkdirSync(path.dirname(abs), { recursive: true });
        execFileSync(FFMPEG, ['-v', 'error', '-y', '-ss', String(f.make[1]), '-i', f.make[0], '-frames:v', '1', '-q:v', '2', abs]);
      }
      return [url, { path: abs, type: f.type }];
    }));
  }
  const { s, targetId, sessionId } = await openCuratedPage(cdp, curate);
  if (clip.pick) {
    // The app's "Choose videos" opens a file input on web: answer it with local copies named like
    // iPhone files, without a dialog.
    const dir = path.resolve('frames', 'picked');
    fs.mkdirSync(dir, { recursive: true });
    const files = clip.pick.map((name, i) => { const f = path.join(dir, name); fs.copyFileSync(clip.pickFrom[i], f); return f; });
    await s('Page.setInterceptFileChooserDialog', { enabled: true });
    cdp.on((msg) => {
      if (msg.sessionId === sessionId && msg.method === 'Page.fileChooserOpened')
        s('DOM.setFileInputFiles', { files, backendNodeId: msg.params.backendNodeId }).catch((e) => console.error('pick failed', e.message));
    });
  }
  for (const p of [...(clip.prewarm || []), clip.start]) {
    await s('Page.navigate', { url: BASE + p });
    await waitFor(s, `document.body && document.body.innerText.length > 40`, 60000);
    await settle(s);
  }
  await waitFor(s, `document.body.innerText.includes(${JSON.stringify(clip.ready)})`, 20000);
  // warm the HTTP cache (e.g. the stand-in video) so playback starts as fast as on a phone
  for (const u of clip.prewarmFetch || []) await evaluate(s, `fetch(${JSON.stringify(u)}, { mode: "no-cors" }).then((r) => r.blob()).then((b) => b.size)`);
  await settle(s);
  if (clip.setup) {
    await clip.setup(makeCtx(s));
    await settle(s);
  }
  await sleep(800);

  const frames = [];
  let firstResolve;
  const first = new Promise((r) => (firstResolve = r));
  cdp.on((msg) => {
    if (msg.method === 'Page.screencastFrame' && msg.sessionId === sessionId) {
      frames.push({ data: msg.params.data, ts: msg.params.metadata.timestamp });
      s('Page.screencastFrameAck', { sessionId: msg.params.sessionId }).catch(() => {});
      firstResolve();
    }
  });
  await s('Page.startScreencast', { format: 'jpeg', quality: 92, maxWidth: 1170, maxHeight: 2532, everyNthFrame: 1 });
  await first;
  const c = makeCtx(s);
  await sleep(300);
  const t0 = Date.now() / 1000;
  c.t0 = t0;
  await clip.run(c);
  c.mark('end');
  const wallDur = { t0, t1: Date.now() / 1000 };
  await s('Page.stopScreencast');
  await sleep(200);
  const shares = await evaluate(s, `window.__rec.shares`);
  const hidden = await evaluate(s, `window.__rec.hiddenNotices || 0`);
  await cdp.send('Target.closeTarget', { targetId });
  return { frames, wallDur, shares, hidden, events: c.events };
}
