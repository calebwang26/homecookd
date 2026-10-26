// The app row: the ways out of homecookd, as Spotify's share sheet draws them (big round buttons
// with a label underneath). All five fit across the sheet with no scrolling (RoundTarget's grid,
// QA B09), so none sits half past the edge. The one row every share sheet uses, the recipe
// ShareSheet (and its dinner invite, which leaves Instagram off) and the family invite sheet
// (components/profiles/AddFamilySheet), so the order never drifts:
//
//   Copy link   the clipboard; the button says "Copied" with a check for a moment
//   Messages    the Messages composer with the text, no recipient (else the link is copied)
//   Instagram   copies the link, says "Link copied. Paste it in Instagram.", then opens Instagram.
//               Always shown: it only opens the app.
//   WhatsApp    whatsapp://send?text=…, only when the phone says WhatsApp can open (never in Expo Go)
//   More        the system share sheet, always last
//
// The caller owns the link: `getUrl` is called on every tap and should hand back the same link for
// the whole opening (a new opening makes a new one). While it is on its way (past a beat) the tapped
// button spins and the others wait.
// A link that can't be made says why in a toast, and the next tap tries again.
import { useEffect, useRef, useState, type ReactNode } from 'react';
import { AccessibilityInfo } from 'react-native';
import Svg, { Circle, Rect } from 'react-native-svg';

import { CloseIcon, LinkIcon, MessageIcon, MoreIcon, WhatsAppIcon, useToast, type IconProps } from '@/components/ui';
import { errorMessage } from '@/lib/api';
import { useWords } from '@/lib/words/useWords';
import type { WordKey } from '@/lib/words/words';
import { colors } from '@/theme/tokens';

import { RoundTarget, TargetRow } from './RoundTarget';
import { canOpenWhatsApp, copyLink, knownWhatsApp, openInstagram, openMessages, openMore, openWhatsApp } from './shareLink';

export type ExternalAction = 'copy' | 'sms' | 'instagram' | 'whatsapp' | 'more';

export type ExternalRowProps = {
  /** The link for this opening (the same one on every tap). Throws when it can't be made. */
  getUrl: () => Promise<string>;
  /** The message that goes out, link included. */
  text: (url: string) => string;
  /** The system share sheet's title (and an email's subject). */
  title: string;
  /** The toast once Messages says it went (default "Sent"). */
  sentLabel?: string;
  /** Breadcrumbs (the share trail). */
  onTrace?: (what: string) => void;
  /** Ways out this sheet leaves off (the dinner invite has no Instagram). */
  omit?: ExternalAction[];
};

/** label, a11y and hint are word keys, read with t() as the row draws. */
type Item = { id: ExternalAction; label: WordKey; a11y: WordKey; hint?: WordKey; fill: string; icon: () => ReactNode };

// Hearth tints in place of Spotify's brand colours.
const ITEMS: Item[] = [
  { id: 'copy', label: 'share.app.copy', a11y: 'share.app.copy', fill: colors.ink, icon: () => <LinkIcon size={26} color={colors.card} /> },
  { id: 'sms', label: 'share.app.messages', a11y: 'share.app.messagesA11y', fill: colors.green, icon: () => <MessageIcon size={26} color={colors.card} /> },
  {
    id: 'instagram',
    label: 'share.app.instagram',
    a11y: 'share.app.instagramA11y',
    hint: 'share.app.instagramHint',
    fill: colors.potLid,
    icon: () => <InstagramIcon size={26} color={colors.ink} />,
  },
  { id: 'whatsapp', label: 'share.app.whatsapp', a11y: 'share.app.whatsappA11y', fill: colors.olive, icon: () => <WhatsAppIcon size={27} color={colors.card} /> },
  { id: 'more', label: 'share.app.more', a11y: 'share.app.moreA11y', fill: colors.well, icon: () => <MoreIcon size={26} color={colors.ink} /> },
];

const NO_LINK: WordKey = 'share.app.noLink';
const NO_COPY: WordKey = 'share.app.noCopy';
const COPIED_MS = 2000;
const SPIN_AFTER_MS = 120;
/** Long enough to read "Link copied. Paste it in Instagram." before Instagram takes over. */
const INSTAGRAM_BEAT_MS = 800;

const errorToast = { tone: 'error' as const, icon: <CloseIcon size={14} color={colors.card} /> };

export function ExternalRow({ getUrl, text, title, sentLabel, onTrace, omit }: ExternalRowProps) {
  const { t } = useWords();
  const toast = useToast();
  const [whatsApp, setWhatsApp] = useState(knownWhatsApp() ?? false);
  // The button waiting for the link (it spins), and "Copied" on Copy link.
  const [waiting, setWaiting] = useState<ExternalAction | null>(null);
  const [copied, setCopied] = useState(false);
  const running = useRef(false);

  useEffect(() => {
    let live = true;
    void canOpenWhatsApp().then((ok) => {
      if (live) setWhatsApp(ok);
    });
    return () => {
      live = false;
    };
  }, []);

  useEffect(() => {
    if (!copied) return;
    const t = setTimeout(() => setCopied(false), COPIED_MS);
    return () => clearTimeout(t);
  }, [copied]);

  async function run(a: ExternalAction) {
    if (running.current) return;
    running.current = true;
    onTrace?.(`external: ${a}`);
    try {
      let url: string;
      // Spin only when the link is really on its way, so a link already made never flashes it.
      const slow = setTimeout(() => setWaiting(a), SPIN_AFTER_MS);
      try {
        url = await getUrl();
      } catch (e) {
        onTrace?.('link failed');
        toast.show(errorMessage(e, t(NO_LINK)), errorToast);
        return;
      } finally {
        clearTimeout(slow);
        setWaiting(null);
      }
      // Where the way out isn't here: the link on the clipboard, and a word on where to paste it.
      const copyInstead = async (lead: string) => {
        if (await copyLink(url)) toast.show(lead);
        else toast.show(t(NO_COPY), errorToast);
      };

      if (a === 'copy') {
        if (await copyLink(url)) {
          setCopied(true);
          AccessibilityInfo.announceForAccessibility?.(t('share.app.linkCopied'));
        } else toast.show(t(NO_COPY), errorToast);
        return;
      }
      if (a === 'sms') {
        const r = await openMessages(text(url));
        onTrace?.(`messages: ${r}`);
        if (r === 'sent') toast.show(sentLabel ?? t('share.app.sent'));
        else if (r === 'unavailable') await copyInstead(t('share.app.pasteInText'));
        return;
      }
      if (a === 'instagram') {
        if (!(await copyLink(url))) {
          toast.show(t(NO_COPY), errorToast);
          return;
        }
        toast.show(t('share.app.pasteInInstagram'));
        await new Promise((r) => setTimeout(r, INSTAGRAM_BEAT_MS));
        if (!(await openInstagram())) toast.show(t('share.app.openInstagram'));
        return;
      }
      if (a === 'whatsapp') {
        if (!(await openWhatsApp(text(url)))) await copyInstead(t('share.app.pasteInWhatsApp'));
        return;
      }
      const r = await openMore(text(url), title);
      onTrace?.(`system share: ${r}`);
      if (r === 'unavailable') await copyInstead(t('share.app.linkCopied'));
    } finally {
      running.current = false;
    }
  }

  return (
    <TargetRow accessibilityLabel={t('share.app.label')}>
      {ITEMS.filter((it) => (it.id !== 'whatsapp' || whatsApp) && !omit?.includes(it.id)).map((it) => (
        <RoundTarget
          key={it.id}
          label={t(it.label)}
          accessibilityLabel={it.id === 'copy' && copied ? t('share.app.linkCopied') : t(it.a11y)}
          accessibilityHint={it.hint ? t(it.hint) : undefined}
          fill={it.fill}
          onPress={() => void run(it.id)}
          busy={waiting === it.id}
          done={it.id === 'copy' && copied}
          doneLabel={t('share.app.copied')}
          disabled={waiting !== null && waiting !== it.id}>
          {it.icon()}
        </RoundTarget>
      ))}
    </TargetRow>
  );
}

/** A camera-like glyph for Instagram: rounded square, lens, flash dot (not the brand mark). */
function InstagramIcon({ size = 24, color = colors.ink }: IconProps) {
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
      <Rect x={3.5} y={3.5} width={17} height={17} rx={5} />
      <Circle cx={12} cy={12} r={3.8} />
      <Circle cx={17.1} cy={6.9} r={0.6} fill={color} />
    </Svg>
  );
}
