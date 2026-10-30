// The egg brand in the app (TS run by Node's type stripping):
//   assets/brand/              the kit's SVGs and tokens.json, copied byte-identical from docs/brand/
//   src/components/ui/brandSvgs.ts   the same SVGs as strings (scripts/sync-brand.mjs), byte for byte
//   src/components/ui/eggFiles.ts    the logo file by rendered size, the mascot moods
//   src/theme/tokens.ts        the kit's palette (light, and dark for later), and text pairs at 4.5:1 or better
//   src/                       no peach, lavender, butter, sun or old greens left, and no pot
//   node scripts/test-brand.mjs
import assert from 'node:assert/strict';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

import { brandFiles, readBrand } from './sync-brand.mjs';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const load = (p) => import(pathToFileURL(join(root, p)).href);
const { BRAND_SVGS } = await load('src/components/ui/brandSvgs.ts');
const { markFile, moodFile, lockupWidth, LOCKUP_MIN_WIDTH } = await load('src/components/ui/eggFiles.ts');
const { colors, darkColors, washes } = await load('src/theme/tokens.ts');
const kit = JSON.parse(readFileSync(join(root, 'assets/brand/tokens.json'), 'utf8'));

let passed = 0;
const test = (name, fn) => {
  try {
    fn();
    passed += 1;
    console.log(`ok   ${name}`);
  } catch (e) {
    console.error(`FAIL ${name}`);
    throw e;
  }
};

const lum = (hex) => {
  const c = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255).map((v) => (v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4));
  return 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2];
};
const ratio = (a, b) => {
  const [x, y] = [lum(a), lum(b)].sort((p, q) => q - p);
  return (x + 0.05) / (y + 0.05);
};

test('brandSvgs.ts holds every kit SVG in assets/brand, byte for byte', () => {
  const files = brandFiles();
  assert.deepEqual(Object.keys(BRAND_SVGS).sort(), files, 'run node scripts/sync-brand.mjs');
  for (const f of files) assert.equal(BRAND_SVGS[f], readBrand(f), f);
  for (const mood of ['hello', 'listening', 'made-it', 'sleepy', 'oops']) assert.ok(BRAND_SVGS[`mascot/${mood}.svg`], mood);
});

test('the logo file follows the rendered size: 64+ mark, 24-63 mark-small, 23 and under mark-tiny', () => {
  assert.equal(markFile(112), 'mark.svg');
  assert.equal(markFile(64), 'mark.svg');
  assert.equal(markFile(63), 'mark-small.svg');
  assert.equal(markFile(34), 'mark-small.svg');
  assert.equal(markFile(24), 'mark-small.svg');
  assert.equal(markFile(23), 'mark-tiny.svg');
  assert.equal(markFile(16), 'mark-tiny.svg');
  assert.equal(markFile(40, true), 'mark-reversed.svg');
  for (const size of [16, 30, 64]) assert.ok(BRAND_SVGS[markFile(size)], `${size}: the file is there`);
  assert.equal(moodFile('sleepy'), 'mascot/sleepy.svg');
});

test('the brand row lockup is never under the kit minimum (96 wide)', () => {
  // Brand: height = size * 34 / 22; the smallest in the app is the share card's 15 (23 pt tall).
  for (const size of [15, 16, 22]) assert.ok(lockupWidth(Math.round((size * 34) / 22)) >= LOCKUP_MIN_WIDTH, `Brand size ${size}`);
});

test('tokens.ts carries the kit palette (tokens.json) exactly', () => {
  const c = kit.color;
  assert.equal(colors.yolk, c.yolk);
  assert.equal(colors.yolkDeep, c.yolkDeep);
  assert.equal(colors.yolkTint, c.yolkTint);
  assert.equal(colors.ink, c.ink);
  assert.equal(colors.text, c.ink);
  assert.equal(colors.page, c.cream);
  assert.equal(colors.card, c.white);
  assert.equal(colors.muted, c.muted);
  assert.equal(colors.line, c.line);
  assert.equal(colors.green, c.green);
  assert.equal(colors.greenTint, c.greenTint);
  assert.equal(colors.danger, c.record);
  const d = kit.semantic.dark;
  assert.deepEqual(
    [darkColors.page, darkColors.card, darkColors.ink, darkColors.muted, darkColors.line, darkColors.yolk, darkColors.yolkDeep, darkColors.yolkTint, darkColors.green, darkColors.greenTint, darkColors.danger],
    [d.bg, d.surface, d.text, d.textMuted, d.border, d.accent, d.accentText, d.yolkTint, d.green, d.greenTint, d.record],
  );
  for (const [from, to] of Object.values(washes)) {
    assert.equal(from, c.yolkTint);
    assert.equal(to, c.cream);
  }
});

test('every text pair the app uses reads at 4.5:1 or better', () => {
  const pairs = [
    ['ink on yolk (primary buttons)', colors.ink, colors.yolk],
    ['ink on cream', colors.ink, colors.page],
    ['ink on white', colors.ink, colors.card],
    ['ink on yolk tint (asks)', colors.ink, colors.yolkTint],
    ['ink on green tint (the cook)', colors.ink, colors.greenTint],
    ['ink on the sunken cream', colors.ink, colors.well],
    ['muted on cream', colors.muted, colors.page],
    ['muted on white', colors.muted, colors.card],
    ['muted on yolk tint', colors.muted, colors.yolkTint],
    ['muted on green tint', colors.muted, colors.greenTint],
    ['muted on the sunken cream', colors.muted, colors.well],
    ['yolk-deep links on cream', colors.yolkDeep, colors.page],
    ['yolk-deep links on white', colors.yolkDeep, colors.card],
    ['yolk-deep on yolk tint', colors.yolkDeep, colors.yolkTint],
    ['green on green tint', colors.green, colors.greenTint],
    ['green on cream', colors.green, colors.page],
    ['green on white', colors.green, colors.card],
    ['white on green (secondary, success)', colors.card, colors.green],
    ['white on ink', colors.card, colors.ink],
    ['white on record', colors.card, colors.danger],
    ['record on cream', colors.danger, colors.page],
    ['record on white', colors.danger, colors.card],
    ['record on the sunken cream', colors.danger, colors.well],
    ['yolk on ink (dark cards)', colors.yolk, colors.ink],
    ['yolk on green (recap covers)', colors.yolk, colors.green],
  ];
  for (const [name, fg, bg] of pairs) assert.ok(ratio(fg, bg) >= 4.5, `${name}: ${ratio(fg, bg).toFixed(2)}`);
  // And the two the kit forbids really are too faint: yolk text on light grounds, white on yolk.
  assert.ok(ratio(colors.yolk, colors.page) < 4.5);
  assert.ok(ratio(colors.card, colors.yolk) < 4.5);
});

/** Every .ts/.tsx under src/. */
function sources(dir = join(root, 'src')) {
  return readdirSync(dir).flatMap((f) => {
    const p = join(dir, f);
    return statSync(p).isDirectory() ? sources(p) : /\.tsx?$/.test(f) ? [p] : [];
  });
}

test('no peach, lavender, butter, sun, old greens or pot left in src/', () => {
  const OLD_HEX = /#(F9E3CF|ECE6F2|FFF1C7|FEBE29|5B6F00|F7F7F2|FFFDF7|6E4A33|3F3558|5A3A22|4C5A10|3C4A0B|EDF2BE|F6D5CC|F6BFA8|F2A98F|6E5A4C|4A3B30|EFEFE6|E3E3D8|1E2410|2D3222|5F6352)\b/i;
  const OLD_TOKEN = /colors\.(peach|peachInk|lavender|lavenderInk|butter|butterInk|sun|sage|sageInk|olive|limeWash|greenDeep|rose|pot[A-Z]\w*)\b/;
  const OLD_RGBA = /rgba\((30,36,16|254,190,41|255,253,247|247,247,242|91,111,0|110,74,51),/;
  const bad = [];
  for (const p of sources()) {
    const s = readFileSync(p, 'utf8');
    if (OLD_HEX.test(s) || OLD_TOKEN.test(s) || OLD_RGBA.test(s) || /\bPotMark\b|\bPotIcon\b/.test(s)) bad.push(p.slice(root.length + 1));
  }
  assert.deepEqual(bad, []);
});

console.log(`\n${passed} passed`);
