// Minimal Chrome DevTools Protocol client + curated-session setup for recording the homecookd app.
import fs from 'node:fs';

export const W = 390, H = 844, DPR = 3;

export async function connectBrowser(port = 9333) {
  const v = await (await fetch(`http://127.0.0.1:${port}/json/version`)).json();
  const ws = new WebSocket(v.webSocketDebuggerUrl);
  await new Promise((res, rej) => { ws.onopen = res; ws.onerror = rej; });
  let id = 0;
  const pending = new Map();
  const listeners = [];
  ws.onmessage = (ev) => {
    const msg = JSON.parse(ev.data);
    if (msg.id && pending.has(msg.id)) {
      const { res, rej, method } = pending.get(msg.id);
      pending.delete(msg.id);
      if (msg.error) rej(new Error(`${method}: ${msg.error.message}`));
      else res(msg.result);
    } else if (msg.method) {
      for (const l of listeners) l(msg);
    }
  };
  const send = (method, params = {}, sessionId) =>
    new Promise((res, rej) => {
      const mid = ++id;
      pending.set(mid, { res, rej, method });
      ws.send(JSON.stringify({ id: mid, method, params, ...(sessionId ? { sessionId } : {}) }));
    });
  return { ws, send, on: (fn) => listeners.push(fn), close: () => ws.close() };
}

export const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// ---- Curation rules -------------------------------------------------------------------------
const BAD_ID = (id) => /weed/i.test(id) || /^gordon/i.test(id);
export function isExcluded(e) {
  const id = String(e.id ?? '');
  const title = String(e.title ?? '');
  const cook = String(e.cook_name ?? e.cook?.name ?? '');
  const rel = String(e.relation ?? e.cook?.relation ?? '');
  return (
    BAD_ID(id) ||
    /weed/i.test(title) ||
    /gordon|ramsay/i.test(cook) ||
    /youtube/i.test(rel) ||
    (e.source != null && e.source !== '')
  );
}

export const filterLog = [];
const jsonCache = new Map(); // url (no query) -> parsed JSON, so in-clip navigation never waits on the network

// Options:
//  - keepSampleTags: keep the synthetic recipes' "sample" labels;
//  - recipeOverrides: { [recipeId]: (recipe) => recipe }, applied in memory after curation (e.g.
//    app-watch gives Grandma's noodle soup a stand-in video; see app-recordings.md);
//  - files: { [url]: { path, type } }, GET requests answered from a local file (e.g. a step still).
export async function openCuratedPage(cdp, { keepSampleTags = false, log = filterLog, recipeOverrides = {}, files = {} } = {}) {
  const { targetId } = await cdp.send('Target.createTarget', { url: 'about:blank' });
  const { sessionId } = await cdp.send('Target.attachToTarget', { targetId, flatten: true });
  const s = (m, p) => cdp.send(m, p, sessionId);
  const events = [];
  cdp.on((msg) => { if (msg.sessionId === sessionId) events.push(msg); });

  await s('Page.enable');
  await s('Runtime.enable');
  await s('Network.enable');
  await s('Emulation.setDeviceMetricsOverride', { width: W, height: H, deviceScaleFactor: DPR, mobile: true, screenWidth: W, screenHeight: H });
  await s('Emulation.setTouchEmulationEnabled', { enabled: true, maxTouchPoints: 5 });
  await s('Emulation.setUserAgentOverride', {
    userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.5 Mobile/15E148 Safari/604.1',
    platform: 'iPhone',
  });
  await s('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-color-scheme', value: 'light' }, { name: 'prefers-reduced-motion', value: 'no-preference' }] });
  // iPhone-like safe areas (status bar 47pt, home indicator 34pt); the app reads them via env().
  await s('Emulation.setSafeAreaInsetsOverride', { insets: { top: 47, bottom: 34, left: 0, right: 0 } });
  const chrome = process.env.NO_STATUSBAR ? 'false' : 'true';
  await s('Page.addScriptToEvaluateOnNewDocument', { source: `window.__DEVICE_CHROME = ${chrome};` + fs.readFileSync(new URL('./inpage.js', import.meta.url), 'utf8') });

  // Fetch interception (cache disabled so every request is seen):
  //  - fail every non-GET/HEAD request (nothing is ever uploaded, deleted or written);
  //  - library.json / recipe.json are fetched here in Node, curated, and fulfilled;
  //  - recipe posters are served from data/synthetic/posters (byte-identical to the bucket copies).
  // HTTP cache stays on (so posters reappear instantly, as on a phone) but is emptied first, and
  // every JSON response we fulfill is marked no-store, so curated JSON is never bypassed.
  await s('Network.clearBrowserCache');
  await s('Network.setCacheDisabled', { cacheDisabled: false });
  await s('Fetch.enable', { patterns: [{ urlPattern: '*', requestStage: 'Request' }] });
  const json = (obj) => ({ responseCode: 200, responseHeaders: [
    { name: 'Content-Type', value: 'application/json' }, { name: 'Access-Control-Allow-Origin', value: '*' },
    { name: 'Cache-Control', value: 'no-store, max-age=0' } ], body: Buffer.from(JSON.stringify(obj), 'utf8').toString('base64') });
  cdp.on(async (msg) => {
    if (msg.sessionId !== sessionId || msg.method !== 'Fetch.requestPaused') return;
    const { requestId, request } = msg.params;
    const url = request.url;
    try {
      if (request.method !== 'GET' && request.method !== 'HEAD') {
        log.push({ blocked: `${request.method} ${url}` });
        await s('Fetch.failRequest', { requestId, errorReason: 'BlockedByClient' });
        return;
      }
      const isLib = /\/library\.json(\?|$)/.test(url);
      const rm = url.match(/\/([^/?]+)\/recipe\.json(\?|$)/);
      if (isLib || rm) {
        const key = url.split('?')[0];
        if (!jsonCache.has(key)) {
          const res = await fetch(url);
          jsonCache.set(key, res.ok ? await res.json() : { __status: res.status });
        }
        let data = structuredClone(jsonCache.get(key));
        if (data && data.__status) { await s('Fetch.fulfillRequest', { requestId, responseCode: data.__status, body: '' }); return; }
        if (isLib && Array.isArray(data)) {
          const removed = data.filter(isExcluded).map((e) => `${e.id} (${e.title}, ${e.cook_name}/${e.relation})`);
          data = data.filter((e) => !isExcluded(e));
          if (!keepSampleTags) data = data.map((e) => ({ ...e, sample: false }));
          log.push({ library: url.split('?')[0], removed, kept: data.map((e) => e.id), sampleTagsRemoved: !keepSampleTags });
        } else if (rm) {
          if (BAD_ID(rm[1]) || isExcluded({ ...data, cook_name: data?.cook?.name, relation: data?.cook?.relation })) {
            log.push({ blockedRecipe: url.split('?')[0] });
            await s('Fetch.fulfillRequest', { requestId, responseCode: 404, body: '' });
            return;
          }
          if (!keepSampleTags) data = { ...data, sample: false };
          if (recipeOverrides[data.id]) data = recipeOverrides[data.id](data);
          log.push({ recipe: data.id, sampleTagRemoved: !keepSampleTags, overridden: !!recipeOverrides[data.id] });
        }
        await s('Fetch.fulfillRequest', { requestId, ...json(data) });
        return;
      }
      const local = files[url.split('?')[0]];
      if (local) {
        await s('Fetch.fulfillRequest', { requestId, responseCode: 200, responseHeaders: [
          { name: 'Content-Type', value: local.type }, { name: 'Access-Control-Allow-Origin', value: '*' },
          { name: 'Cache-Control', value: 'public, max-age=86400' } ],
          body: fs.readFileSync(local.path).toString('base64') });
        return;
      }
      const pm = url.match(/storage\.googleapis\.com\/[^/]+\/([^/?]+)\/poster\.jpg/);
      if (pm) {
        if (BAD_ID(pm[1]) || pm[1] === 'chicken-biryani') { await s('Fetch.failRequest', { requestId, errorReason: 'BlockedByClient' }); return; }
        const local = new URL(`../../../../data/synthetic/posters/${pm[1]}.jpg`, import.meta.url);
        if (fs.existsSync(local)) {
          await s('Fetch.fulfillRequest', { requestId, responseCode: 200, responseHeaders: [
            { name: 'Content-Type', value: 'image/jpeg' }, { name: 'Access-Control-Allow-Origin', value: '*' },
            { name: 'Cache-Control', value: 'public, max-age=86400' } ],
            body: fs.readFileSync(local).toString('base64') });
          return;
        }
      }
      await s('Fetch.continueRequest', { requestId });
    } catch (err) {
      console.error('fetch handler error', url, err.message);
      try { await s('Fetch.continueRequest', { requestId }); } catch {}
    }
  });

  return { s, sessionId, targetId, events };
}

export async function evaluate(s, expr) {
  const r = await s('Runtime.evaluate', { expression: expr, awaitPromise: true, returnByValue: true });
  if (r.exceptionDetails) throw new Error(`eval failed: ${r.exceptionDetails.exception?.description ?? r.exceptionDetails.text}`);
  return r.result.value;
}

export async function waitFor(s, expr, timeout = 20000) {
  const t0 = Date.now();
  while (Date.now() - t0 < timeout) {
    try { if (await evaluate(s, expr)) return true; } catch {}
    await sleep(150);
  }
  throw new Error(`timeout waiting for: ${expr}`);
}

export async function settle(s) {
  await waitFor(s, `document.fonts.ready.then(() => true)`);
  await waitFor(s, `[...document.images].every((i) => i.complete)`, 20000).catch(() => console.warn('images not all complete'));
  await sleep(600);
}

export async function screenshot(s, path) {
  const { data } = await s('Page.captureScreenshot', { format: 'png' });
  fs.writeFileSync(path, Buffer.from(data, 'base64'));
}
