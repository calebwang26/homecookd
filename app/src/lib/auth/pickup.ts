// The invisible pickup (docs/build/JOIN-SIMPLE.md §2): someone installed homecookd from a join link's
// web page, whose "Get the app" copied the link. On the signed-out first screen, the app looks for it:
//   1. hasUrl() asks iOS whether the clipboard holds a link, without reading it (no prompt);
//   2. only then, and at most once per launch, it reads the link (iOS shows its own "Allow Paste");
//   3. a homecookd join link (/i?t=, /a?t=, /miss?k=) gives the screen to open; anything else is
//      dropped without a word.
// There's no button: "Got a link from your family? Tap it again." is the backup that always works.
// Pure (node scripts/test-signin.mjs); components/signin/useLinkPickup brings the clipboard and opens the screen.
import { joinLinkHref, parseInviteInput } from './links';

export type PickupClipboard = {
  hasUrl: () => Promise<boolean>;
  readUrl: () => Promise<string | null>;
  readText: () => Promise<string | null>;
};

let read = false;
let checking = false;

const quiet = <T>(p: () => Promise<T>, fallback: T): Promise<T> => p().catch(() => fallback);

/** The join link on the clipboard, as a screen to open, or null (nothing there, not ours, or read already). */
export async function pickUpLink(clip: PickupClipboard): Promise<string | null> {
  if (read || checking) return null;
  checking = true;
  try {
    if (!(await quiet(clip.hasUrl, false)) || read) return null;
    read = true;
    const text = (await quiet(clip.readUrl, null)) || (await quiet(clip.readText, null));
    return joinLinkHref(parseInviteInput(text));
  } finally {
    checking = false;
  }
}
