// The ways out of the Ask sheet, for a browser (the app's share/shareLink.ts). The message is
// askText (lib/miss/text.ts): "Mom, I'm trying to make your tomato egg. Can you help me with 3 things?
// You can just tell me here: <url>". Call every opener inside the tap: Safari only lets a page copy,
// share or open a window while the tap is being handled.

export const NO_COPY = 'That didn’t copy. Tap More to share it.';
/** How long the share sheet gets to answer before the row takes taps again (some in-app browsers never answer). */
export const SHARE_WAIT_MS = 3000;
const INSTAGRAM_INBOX = 'https://www.instagram.com/direct/inbox/';

/** Messages with the text filled in, no recipient. This one form works on iPhone and Android. */
export const smsHref = (text: string) => `sms:?&body=${encodeURIComponent(text)}`;

/** WhatsApp with the text filled in: the app on a phone, WhatsApp Web on a computer. */
export const whatsAppHref = (text: string) => `https://wa.me/?text=${encodeURIComponent(text)}`;

/** Instagram's inbox in a new tab (Instagram has no "send this text" link). False when the browser blocked it. */
export function openInstagram(): boolean {
  try {
    const win = window.open(INSTAGRAM_INBOX, '_blank');
    if (!win) return false;
    // What 'noopener' does; passing it instead would make window.open return null even when it opened.
    win.opener = null;
    return true;
  } catch {
    return false;
  }
}

export type ShareAnswer = 'shared' | 'cancelled' | 'failed';

/** The browser's share sheet, or null when it has none. Never rejects. */
export function shareSheet(title: string, text: string): Promise<ShareAnswer> | null {
  if (typeof navigator === 'undefined' || typeof navigator.share !== 'function') return null;
  try {
    // The text already carries the link; passing `url` too would paste it twice on iOS (as in the app).
    return navigator.share({ title, text }).then(
      () => 'shared',
      (e: unknown) => (e instanceof DOMException && e.name === 'AbortError' ? 'cancelled' : 'failed'),
    );
  } catch {
    return Promise.resolve('failed');
  }
}

export const later = (ms: number) => new Promise<'late'>((resolve) => window.setTimeout(() => resolve('late'), ms));
