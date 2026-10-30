// Retention PR 7, the little touches (RETENTION-HANDOFF 4): the pure parts, so they're tested in
// scripts/test-retention.mjs. Every touch is polish only: no new action, no new words, and Reduce
// Motion gets a fade or nothing.
//   potDotLayout    cook mode's step dots (little yolks; they were pots): how big they can be in the
//                   header, or null (too many: bars)
//   strikeStrokes   the ingredient checklist's hand-drawn strike-through, one wobbly stroke per line
//   buzzForUnread   the double tap for a new family message while the app is open
//   unreadSeenAfter its baseline, forgotten when the app leaves the foreground (no tap on coming back)
//   tapStillDue     a beat later: still play it? (not when a message push already said it, nor in a chat)
// (The brand row's clock moods, sleepy at night and waving on Sunday, went with the pot: the egg logo
// never changes its face.)

/** The step dots' sizes: as big as POT_MAX, never below POT_MIN (under that they stop reading as steps). */
export const POT_MAX = 16;
export const POT_MIN = 10;
const POT_GAP = 6;
const POT_GAP_TIGHT = 4;

/**
 * How `total` step pots fit a header `width` pt wide: their size and the gap between them. Null when
 * they can't (no width yet, no steps, or so many steps the pots would shrink below POT_MIN): cook
 * mode then keeps the plain progress bars.
 */
export function potDotLayout(width: number, total: number): { size: number; gap: number } | null {
  if (!(width > 0) || !(total > 0)) return null;
  for (const gap of [POT_GAP, POT_GAP_TIGHT]) {
    const size = Math.min(POT_MAX, Math.floor((width - gap * (total - 1)) / total));
    if (size >= POT_MIN) return { size, gap };
  }
  return null;
}

export type TextLine = { x: number; y: number; width: number; height: number };
export type Stroke = { d: string; length: number };

/** Small, stable jitter in [-1, 1] for a seed (the same row always gets the same hand). */
function jitter(seed: number): number {
  const s = Math.sin(seed * 12.9898 + 78.233) * 43758.5453;
  return (s - Math.floor(s)) * 2 - 1;
}

const r1 = (n: number) => Math.round(n * 10) / 10;

/**
 * A hand-drawn strike-through over the given text lines (from onTextLayout, or the text's own box):
 * one stroke per line through the middle of its letters, overshooting each end by a few points, with
 * a slight rise and a soft S-bend, so it reads as a pen line, not `line-through`. `length` is a little
 * more than the stroke's real length (for the draw-on dash). Lines thinner than a letter are skipped.
 * `pad` shifts everything right/down when the drawing box is larger than the text's (for overshoot).
 */
export function strikeStrokes(lines: TextLine[], seed = 0, pad = 0): Stroke[] {
  const out: Stroke[] = [];
  lines.forEach((l, i) => {
    if (!(l.width >= 4) || !(l.height > 0)) return;
    const k = seed * 7 + i * 3;
    const over = 2 + jitter(k) * 1;
    const x0 = l.x + pad - over;
    const x1 = l.x + pad + l.width + over;
    const mid = l.y + pad + l.height * 0.55;
    const rise = Math.min(3, 0.8 + l.width / 70) * (0.75 + 0.25 * jitter(k + 1));
    const bend = 1.3 + 0.5 * jitter(k + 2);
    const w = x1 - x0;
    const d = [
      `M${r1(x0)} ${r1(mid + rise / 2)}`,
      `C${r1(x0 + w * 0.3)} ${r1(mid - bend)} ${r1(x0 + w * 0.62)} ${r1(mid + bend)} ${r1(x1)} ${r1(mid - rise / 2)}`,
    ].join(' ');
    out.push({ d, length: Math.ceil(w + 2 * bend + rise + 4) });
  });
  return out;
}

/**
 * Line boxes from the browser (a Range's client rects over the text, relative to the text's box):
 * fragments of the same line (inline pieces) merge into one, top to bottom. Web only: iOS and
 * Android say the lines in onTextLayout.
 */
export function mergeLineRects(rects: TextLine[]): TextLine[] {
  const rows: TextLine[] = [];
  for (const r of [...rects].filter((x) => x.width > 0 && x.height > 0).sort((a, b) => a.y - b.y || a.x - b.x)) {
    const row = rows.find((l) => Math.abs(l.y + l.height / 2 - (r.y + r.height / 2)) < Math.min(l.height, r.height) / 2);
    if (!row) {
      rows.push({ ...r });
      continue;
    }
    const x0 = Math.min(row.x, r.x);
    const x1 = Math.max(row.x + row.width, r.x + r.width);
    const y0 = Math.min(row.y, r.y);
    const y1 = Math.max(row.y + row.height, r.y + r.height);
    Object.assign(row, { x: x0, y: y0, width: x1 - x0, height: y1 - y0 });
  }
  return rows;
}

/**
 * Lines for a text block when nothing better is known: one per line of
 * `lineHeight`, each the block's full width. The block is sized to its text (alignSelf flex-start),
 * so a one-line ingredient is exact; a wrapped one strikes each line edge to edge.
 */
export function blockLines(width: number, height: number, lineHeight: number): TextLine[] {
  if (!(width > 0) || !(height > 0) || !(lineHeight > 0)) return [];
  const n = Math.max(1, Math.round(height / lineHeight));
  const h = height / n;
  return Array.from({ length: n }, (_, i) => ({ x: 0, y: i * h, width, height: h }));
}

/** The last unread count read for someone (the double tap's baseline). */
export type UnreadSeen = { owner: string | null; total: number };

/**
 * The double tap for a new family message (RETENTION-HANDOFF 4, haptics): only when the unread count
 * read from the server goes up for the same person while the app is open. Never on the first read
 * for someone (opening the app with messages waiting), never when it goes down or stays.
 */
export function buzzForUnread(prev: UnreadSeen | null, next: UnreadSeen, active: boolean): boolean {
  if (!active || !next.owner || !prev || prev.owner !== next.owner) return false;
  return next.total > prev.total;
}

/**
 * The baseline to keep in an AppState ('active' | 'inactive' | 'background'): only in the foreground.
 * Leaving it forgets the baseline, and a read that lands while away never becomes one, so the first
 * read after coming back is a silent baseline, as on a cold start. Messages that landed while the
 * app was away already had their push.
 */
export function unreadSeenAfter(appState: string, seen: UnreadSeen | null): UnreadSeen | null {
  return appState === 'active' ? seen : null;
}

/** A message push that came with the app open stands in for the double tap this long. */
export const PUSH_COVERS_MS = 20_000;
/** The double tap waits this beat for a message push still on its way (Expo lands it a second or so after the message). */
export const TAP_WAIT_MS = 3_000;

/**
 * Whether the double tap that buzzForUnread asked for still plays TAP_WAIT_MS later. One message, one
 * signal, so not:
 * - when a message push came with the app open in the last PUSH_COVERS_MS, before the poll or during
 *   the wait (`pushAt`, lib/push.ts lastMessagePushAt): its banner and sound were the note, or it was
 *   kept quiet because that chat was on screen;
 * - while a chat is open (`path` '/chat/…'): its messages land in front of the person (with pushes on,
 *   a message for another chat still gets its banner);
 * - when the count went back down meanwhile (the open chat marked it read), someone else is in, or
 *   the app left the front (`seen`, the baseline now, is then gone or someone else's).
 */
export function tapStillDue(o: {
  due: UnreadSeen;
  seen: UnreadSeen | null;
  active: boolean;
  pushAt: number | null;
  now: number;
  path: string | null;
}): boolean {
  if (!o.active || !o.seen || o.seen.owner !== o.due.owner || o.seen.total < o.due.total) return false;
  if (o.path?.startsWith('/chat/')) return false;
  return o.pushAt == null || o.now - o.pushAt > PUSH_COVERS_MS;
}
