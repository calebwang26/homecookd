// Injected into every recorded page: a touch indicator (recording aid, like iOS "show touches"),
// eased scrolling of the page's scroll container, element lookup, and a navigator.share spy.
(() => {
  const ease = (t) => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2);
  let dot = null;
  function ensureDot() {
    if (dot && document.body.contains(dot)) return dot;
    dot = document.createElement('div');
    dot.id = '__touchdot';
    Object.assign(dot.style, {
      position: 'fixed', left: '0px', top: '0px', width: '44px', height: '44px', marginLeft: '-22px', marginTop: '-22px',
      borderRadius: '50%', background: 'rgba(255,255,255,0.55)', border: '2px solid rgba(40,40,30,0.30)',
      boxShadow: '0 2px 12px rgba(0,0,0,0.18)', pointerEvents: 'none', zIndex: 2147483647, opacity: '0',
      transform: 'scale(1.15)', transition: 'opacity 140ms ease, transform 140ms ease', willChange: 'transform, opacity',
    });
    document.body.appendChild(dot);
    return dot;
  }
  const rec = {
    showTouch(x, y) {
      const d = ensureDot();
      d.style.transition = 'opacity 140ms ease, transform 140ms ease';
      d.style.left = `${x}px`; d.style.top = `${y}px`;
      d.style.opacity = '1'; d.style.transform = 'scale(1)';
    },
    pressTouch() { const d = ensureDot(); d.style.transform = 'scale(0.82)'; },
    moveTouch(x, y) { const d = ensureDot(); d.style.transition = 'opacity 140ms ease, transform 140ms ease'; d.style.left = `${x}px`; d.style.top = `${y}px`; },
    hideTouch() { const d = ensureDot(); d.style.transition = 'opacity 260ms ease, transform 260ms ease'; d.style.opacity = '0'; d.style.transform = 'scale(1.25)'; },
    // The element the user would scroll: the visible one with the most overflow.
    scroller() {
      let best = document.scrollingElement, bestOver = 0;
      for (const el of document.querySelectorAll('div')) {
        const cs = getComputedStyle(el);
        if (!/(auto|scroll)/.test(cs.overflowY)) continue;
        const over = el.scrollHeight - el.clientHeight;
        const r = el.getBoundingClientRect();
        if (over > 4 && r.width > 200 && r.height > 300 && r.bottom > 0 && r.top < innerHeight && over > bestOver) { best = el; bestOver = over; }
      }
      return best;
    },
    // Eased scroll by dy px over ms, with the touch dot dragging along (finger moves opposite to content).
    smoothScroll(dy, ms = 900, withDot = true, x = 300, y0 = null) {
      const el = rec.scroller();
      const start = el.scrollTop;
      const target = Math.max(0, Math.min(el.scrollHeight - el.clientHeight, start + dy));
      const delta = target - start;
      const yStart = y0 ?? (dy > 0 ? innerHeight * 0.72 : innerHeight * 0.32);
      const travel = Math.max(-260, Math.min(260, -delta * 0.55));
      if (withDot) { rec.showTouch(x, yStart); }
      return new Promise((resolve) => {
        const t0 = performance.now() + (withDot ? 120 : 0);
        const tick = (now) => {
          const t = Math.max(0, Math.min(1, (now - t0) / ms));
          const e = ease(t);
          el.scrollTop = start + delta * e;
          if (withDot) rec.moveTouch(x, yStart + travel * Math.min(1, e * 1.15));
          if (t < 1) requestAnimationFrame(tick);
          else { if (withDot) rec.hideTouch(); resolve(el.scrollTop); }
        };
        requestAnimationFrame(tick);
      });
    },
    scrollTo(y, ms = 900, withDot = true) { const el = rec.scroller(); return rec.smoothScroll(y - el.scrollTop, ms, withDot); },
    // Find a visible element by aria-label (exact), then by exact text; returns its center.
    find(q, { nth = 0, contains = false, prefix = false } = {}) {
      const vis = (el) => { const r = el.getBoundingClientRect(); return r.width > 0 && r.height > 0; };
      let hits = [...document.querySelectorAll('[aria-label]')].filter((el) => {
        const l = el.getAttribute('aria-label') || '';
        return (prefix ? l.startsWith(q) : l === q) && vis(el);
      });
      if (!hits.length) {
        const all = [...document.querySelectorAll('body *')].filter((el) => {
          const t = (el.textContent || '').replace(/\s+/g, ' ').trim();
          return (contains ? t.includes(q) : t === q) && vis(el);
        });
        // Deepest matches only.
        hits = all.filter((el) => !all.some((o) => o !== el && el.contains(o)));
        hits = hits.map((el) => el.closest('[role="button"],[role="tab"],[role="checkbox"],[role="link"],button,a,[tabindex]') || el);
      }
      const el = hits[nth];
      if (!el) return null;
      const r = el.getBoundingClientRect();
      return { x: r.left + r.width / 2, y: r.top + r.height / 2, w: r.width, h: r.height, top: r.top, bottom: r.bottom, left: r.left, tag: el.tagName, label: el.getAttribute('aria-label') };
    },
    shares: [],
  };
  window.__rec = rec;
  try {
    Object.defineProperty(navigator, 'share', {
      configurable: true,
      value: (data) => { rec.shares.push(data); return new Promise((res) => setTimeout(res, 1500)); },
    });
    Object.defineProperty(navigator, 'canShare', { configurable: true, value: () => true });
  } catch {}
  const st = document.createElement('style');
  // .__expo_fast_refresh is the dev server's loading toast (a lightning badge, bottom-left, shown
  // while a lazily bundled module loads); #error-toast is the dev LogBox badge. Dev builds only.
  st.textContent = '*::-webkit-scrollbar{display:none!important} *{scrollbar-width:none!important} *{-webkit-tap-highlight-color:transparent} .__expo_fast_refresh,#error-toast{display:none!important}';

  // iOS device chrome (what a real iPhone screen recording shows): status bar + home indicator.
  function deviceChrome() {
    if (!window.__DEVICE_CHROME || document.getElementById('__statusbar')) return;
    const ink = '#0E0F0C';
    const bar = document.createElement('div');
    bar.id = '__statusbar';
    Object.assign(bar.style, { position: 'fixed', left: '0', right: '0', top: '0', height: '47px', pointerEvents: 'none', zIndex: 2147483646 });
    bar.innerHTML = `
      <div style="position:absolute;left:0;width:150px;top:0;height:47px;display:flex;align-items:center;justify-content:center;padding-top:4px;box-sizing:border-box;font:600 17px/1 -apple-system,'SF Pro Text',system-ui,sans-serif;letter-spacing:-0.2px;color:${ink}">9:41</div>
      <div style="position:absolute;right:26px;top:0;height:47px;display:flex;align-items:center;gap:6px;padding-top:4px;box-sizing:border-box">
        <svg width="18" height="12" viewBox="0 0 18 12"><rect x="0" y="8" width="3" height="4" rx="0.8" fill="${ink}"/><rect x="5" y="5.5" width="3" height="6.5" rx="0.8" fill="${ink}"/><rect x="10" y="3" width="3" height="9" rx="0.8" fill="${ink}"/><rect x="15" y="0" width="3" height="12" rx="0.8" fill="${ink}"/></svg>
        <svg width="16" height="12" viewBox="0 0 16 12"><path d="M8 11.6 10.4 9.2a3.4 3.4 0 0 0-4.8 0Z" fill="${ink}"/><path d="M3.6 7.2a6.2 6.2 0 0 1 8.8 0l1.5-1.5a8.4 8.4 0 0 0-11.8 0Z" fill="${ink}"/><path d="M.6 4.2a10.4 10.4 0 0 1 14.8 0L16 3.5 15.9 3.4a12.6 12.6 0 0 0-15.8 0L0 3.5Z" fill="${ink}"/></svg>
        <svg width="27" height="13" viewBox="0 0 27 13"><rect x="0.5" y="0.5" width="23" height="12" rx="3.6" fill="none" stroke="${ink}" stroke-opacity="0.38"/><rect x="2" y="2" width="20" height="9" rx="2.2" fill="${ink}"/><path d="M25 4.4v4.2c.8-.3 1.4-1.1 1.4-2.1s-.6-1.8-1.4-2.1Z" fill="${ink}" fill-opacity="0.45"/></svg>
      </div>`;
    const home = document.createElement('div');
    home.id = '__homeind';
    Object.assign(home.style, { position: 'fixed', left: '50%', bottom: '8px', width: '134px', height: '5px', marginLeft: '-67px', borderRadius: '3px', background: ink, pointerEvents: 'none', zIndex: 2147483646 });
    document.body.appendChild(bar);
    document.body.appendChild(home);
  }

  // The upload screen shows a web-only notice ("This web preview can't send videos…") that the
  // phone app never shows; hide just that card so the recording matches the phone.
  function hideWebOnlyNotice() {
    for (const el of document.querySelectorAll('div')) {
      if (el.dataset.recHidden) continue;
      const kids = el.children;
      if (kids.length === 2 && (kids[0].textContent || '').trim() === 'Uploads work from the homecookd app on your phone.' &&
          /web preview/.test(kids[1].textContent || '')) {
        el.style.display = 'none';
        el.dataset.recHidden = '1';
        rec.hiddenNotices = (rec.hiddenNotices || 0) + 1;
      }
    }
  }

  document.addEventListener('DOMContentLoaded', () => {
    document.head.appendChild(st);
    const m = document.querySelector('meta[name=viewport]');
    if (m) m.content = 'width=device-width, initial-scale=1, viewport-fit=cover';
    deviceChrome();
    new MutationObserver(() => { deviceChrome(); hideWebOnlyNotice(); }).observe(document.body, { childList: true, subtree: true });
  });
})();
