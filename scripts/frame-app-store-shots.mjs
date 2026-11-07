// Frames the 1.1 App Store screenshots: a caption on top, the raw screen below, 1320 × 2868 (6.9").
// Reads docs/app-store/screenshots/1.1/raw/*.png and writes the framed copies next to raw/.
// Usage: node scripts/frame-app-store-shots.mjs [only-this-file.png ...]
// Needs web/node_modules (cd web && npm ci) and Google Chrome.
import { createRequire } from 'node:module';
import { readdirSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const { chromium } = createRequire(path.join(root, 'web/package.json'))('playwright-core');
const dir = path.join(root, 'docs/app-store/screenshots/1.1');
// Data URIs: a page made with setContent can't load file:// URLs.
const dataUri = (file, type) => `data:${type};base64,${readFileSync(file).toString('base64')}`;
const font = dataUri(path.join(root, 'web/public/fonts/fraunces-roman-latin.0ba5251864.woff2'), 'font/woff2');

// Same captions as LISTING-1.1.md's screenshot table.
const CAPTIONS = {
  '01-cook-it-their-way.png': 'Cook it the way they make it',
  '02-your-kids-ask.png': 'Your kids ask. You answer.',
  '03-tell-them-how.png': 'Tell them how, out loud',
  '04-just-cook.png': 'Just cook. We write it down.',
  '05-a-real-amount.png': '“A handful” becomes a real amount',
  '06-hear-it-in-their-voice.png': 'Hear it in their voice',
  '07-send-home-a-photo.png': 'Send home a photo',
};

const W = 1320, H = 2868, SCREEN_W = 1100, SCREEN_TOP = 430;
const page = (caption, img) => `<!doctype html><meta charset="utf-8"><style>
@font-face { font-family: Fraunces; src: url(${font}) format('woff2'); font-weight: 100 900; }
html, body { margin: 0; width: ${W}px; height: ${H}px; overflow: hidden; background: #EEF3F0; }
h1 { position: absolute; top: 0; left: 70px; right: 70px; height: ${SCREEN_TOP - 20}px; margin: 0;
  display: flex; align-items: center; justify-content: center; text-align: center; text-wrap: balance;
  font: 600 112px/1.04 Fraunces, Georgia, serif; font-variation-settings: "SOFT" 100, "opsz" 144;
  letter-spacing: -0.01em; color: #18221D; }
img { position: absolute; top: ${SCREEN_TOP}px; left: ${(W - SCREEN_W) / 2}px; width: ${SCREEN_W}px;
  border-radius: 64px; box-shadow: 0 30px 80px rgba(24, 34, 29, 0.16), 0 0 0 2px rgba(24, 34, 29, 0.06); }
</style><h1>${caption}</h1><img src="${img}">`;

const only = process.argv.slice(2);
const files = readdirSync(path.join(dir, 'raw')).filter((f) => f in CAPTIONS && (!only.length || only.includes(f)));
const browser = await chromium.launch({
  executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  headless: true,
});
try {
  const tab = await browser.newPage({ viewport: { width: W, height: H }, deviceScaleFactor: 1 });
  for (const f of files) {
    await tab.setContent(page(CAPTIONS[f], dataUri(path.join(dir, 'raw', f), 'image/png')), { waitUntil: 'load' });
    await tab.evaluate(async () => {
      await document.fonts.ready;
      if (!document.fonts.check('600 112px Fraunces')) throw new Error('Fraunces did not load');
    });
    await tab.screenshot({ path: path.join(dir, f) });
    console.log('framed', f);
  }
} finally {
  await browser.close();
}
