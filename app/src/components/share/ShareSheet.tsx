// Spotify's share sheet, almost one to one (FEEDBACK-OCT16c E5), in Hearth colours and type.
// Rendered once by ShareSheetProvider (lib/share.tsx); screens call `useShare().open({ recipeId })`.
//
//   ┌──────────── grabber ──────── (x) ┐
//   │        ┌── swatch stage ──┐       │  big card, about half the sheet: dish photo, name,
//   │        │  ┌─ cream card ┐ │       │  "by Dad · ~50 min", homecookd mark
//   │        │  └─────────────┘ │       │
//   │        └──────────────────┘       │
//   │          ( ) ( ) ( )              │  swatches: peach, sage, ink
//   │     [ ✓ Sent to Leo ]             │  after a send: a toast above the rows, ~2.5 s
//   │  (Leo) (Maya) (Dad) (Grandma) (…  │  everyone else in the family, the ones who miss it first
//   │   Leo  Maya   Dad   Grandma       │  (QA B09; FamilyRow kidsFirst), scrolling: tap -> the
//   ├───────────────────────────────────┤  face scrolls fully into view -> POST /send-recipe ->
//   │  (⛓) (✉) (◎) (✆) (…)             │  a check + "Sent". ExternalRow (shared with the invite
//   │  Copy  Messages  Instagram ...    │  sheet): Copy link, Messages, Instagram, WhatsApp (if it
//   └───────────────────────────────────┘  opens), More. One POST /shares per open, reused.
//
// Whoever cooked or opened this dish (GET /recipes/:id/activity) moves to the front if that answer
// comes within ACTIVITY_WAIT_MS of opening and before the first tap; after that the faces never
// move, so a finger never lands on someone who slid into its place.
//
// Contract:
//   visible   true while the sheet should show (animates out when it turns false)
//   recipeId  the bucket recipe id being shared (null while closed)
//   onClose   dismiss (backdrop tap, close button, drag down)
//   onShown   the native Modal finished presenting (the provider's watchdog)
import { Component, useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { AccessibilityInfo, ScrollView, StyleSheet, View, useWindowDimensions } from 'react-native';
import Animated, { FadeIn, FadeOut } from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { BottomSheet, CheckIcon, CloseIcon, PotMark, Txt, haptic, useToast } from '@/components/ui';
import { api, errorMessage, type Profile } from '@/lib/api';
import { totalTimeLabel } from '@/lib/format';
import { useRecipe } from '@/lib/recipes';
import { useSession } from '@/lib/session';
import { alpha, colors } from '@/theme/tokens';

import { ExternalRow } from './ExternalRow';
import { FamilyRow, kidsFirst, type SendState } from './FamilyRow';
import { useRowMetrics } from './RoundTarget';
import { sendRecipes } from './sendRecipe';
import { ShareCard, stageFor, type ShareCardData } from './ShareCard';
import { getShareLink, shareText, type ShareLink } from './shareLink';
import { SwatchRow } from './SwatchRow';
import type { SwatchId } from './swatches';
import { trail } from './trail';

export type ShareSheetProps = {
  visible: boolean;
  recipeId: string | null;
  onClose: () => void;
  onShown?: () => void;
};

const traceSheet = (what: string) => trail(`sheet: ${what}`);

// The last picked card colour, for the rest of this app session.
let lastSwatch: SwatchId = 'peach';

/** The dish's activity reorders the faces only if it comes this soon after opening. */
const ACTIVITY_WAIT_MS = 1200;
/** How long "Sent to Leo" stays above the rows. */
const SENT_TOAST_MS = 2600;

export function ShareSheet({ visible, recipeId, onClose, onShown }: ShareSheetProps) {
  // A fresh body (send states, link) for every open; derived during render, no effect.
  const [seq, setSeq] = useState(0);
  const [wasVisible, setWasVisible] = useState(visible);
  if (visible !== wasVisible) {
    setWasVisible(visible);
    if (visible) setSeq((n) => n + 1);
  }

  const { recipe, entry, missing } = useRecipe(recipeId);
  const title = recipe?.title ?? entry?.title ?? '';
  const gone: ShareCardData | null = missing && !title ? { title: 'We couldn’t find this recipe', cook: null, time: null, poster: null } : null;

  return (
    <BottomSheet
      visible={visible && !!recipeId}
      onClose={onClose}
      accessibilityLabel={title ? `Share ${title}` : 'Share this recipe'}
      contentStyle={styles.sheetContent}
      onTrace={traceSheet}
      onShown={onShown}>
      {recipeId ? (
        <BodyGuard key={seq}>
          <ShareBody
            recipeId={recipeId}
            available={!gone}
            ready={!!title}
            data={
              title
                ? {
                    title,
                    cook: recipe?.cook.name ?? entry?.cook_name ?? null,
                    time: totalTimeLabel(recipe?.total_time),
                    poster: recipe?.media.poster_url ?? entry?.poster_url ?? null,
                  }
                : gone
            }
          />
        </BodyGuard>
      ) : null}
    </BottomSheet>
  );
}

function ShareBody({
  recipeId,
  data,
  available,
  ready,
}: {
  recipeId: string;
  data: ShareCardData | null;
  available: boolean;
  /** The recipe is known (it has a title); the link waits for it and for the profile. */
  ready: boolean;
}) {
  const { me, profiles } = useSession();
  const toast = useToast();
  const { height: winH } = useWindowDimensions();
  const insets = useSafeAreaInsets();
  const [swatch, setSwatch] = useState<SwatchId>(lastSwatch);
  const [states, setStates] = useState<Record<string, SendState>>({});
  const linkRef = useRef<Promise<ShareLink> | null>(null);
  const meId = me?.id ?? null;
  const { circle } = useRowMetrics();
  // Who cooked or opened this dish (moved to the front), the order frozen at the first tap, the
  // face to scroll into view, and "Sent to Leo" above the rows.
  const [front, setFront] = useState<ReadonlySet<string>>(() => new Set());
  const [frozen, setFrozen] = useState<Profile[] | null>(null);
  const [reveal, setReveal] = useState<{ index: number } | null>(null);
  const [sentTo, setSentTo] = useState<{ name: string; n: number } | null>(null);

  useEffect(() => {
    trail(`body: ${!available ? 'recipe missing' : ready ? 'recipe found' : 'loading recipe'}, ${data?.poster ? 'photo' : 'no photo'}`);
  }, [available, ready, data?.poster]);

  // One link per open: ask once the recipe and the profile are known, so it is ready by the time a
  // finger reaches "Copy link" (a tap before then makes it on demand).
  useEffect(() => {
    if (!available || !ready || !meId) return;
    trail('link requested');
    const p = getShareLink(recipeId, meId, true);
    p.then(
      () => trail('link ready'),
      (e) => trail('link failed (shown on tap)', errorMessage(e, 'error')),
    ); // surfaced when someone taps an option
    linkRef.current = p;
  }, [recipeId, meId, available, ready]);

  // The link for the app row; a failure there says why in a toast and the next tap asks again.
  const getUrl = useCallback(async (): Promise<string> => {
    try {
      return (await (linkRef.current ?? getShareLink(recipeId, meId))).url;
    } catch {
      // One more try on tap (the first may have gone out while offline).
      const p = getShareLink(recipeId, meId, true);
      linkRef.current = p;
      return (await p).url;
    }
  }, [recipeId, meId]);
  const text = useCallback((url: string) => shareText(data?.title ?? '', data?.cook, url), [data?.title, data?.cook]);

  // The dish's activity, asked as the sheet opens (it needs only the id), if it comes quickly (see
  // ACTIVITY_WAIT_MS). No answer: the plain order.
  useEffect(() => {
    if (!available) return;
    let live = true;
    const asked = Date.now();
    api.activity(recipeId).then(
      (a) => {
        if (!live || Date.now() - asked > ACTIVITY_WAIT_MS) return;
        const ids = [...(a.cooked ?? []), ...(a.viewed ?? [])].map((x) => x.profile?.id).filter((id): id is string => !!id);
        if (ids.length) setFront(new Set(ids));
      },
      () => {},
    );
    return () => {
      live = false;
    };
  }, [recipeId, available]);

  const ranked = useMemo(() => (meId ? kidsFirst(profiles.filter((p) => p.id !== meId), front) : []), [profiles, meId, front]);
  const people = frozen ?? ranked;

  useEffect(() => {
    if (!sentTo) return;
    const t = setTimeout(() => setSentTo((s) => (s === sentTo ? null : s)), SENT_TOAST_MS);
    return () => clearTimeout(t);
  }, [sentTo]);

  const send = useCallback(
    async (p: Profile) => {
      trail('send in homecookd');
      // From the first tap on, nobody moves; the tapped face comes fully into view.
      setFrozen((f) => f ?? people);
      setReveal({ index: Math.max(0, people.findIndex((x) => x.id === p.id)) });
      setStates((s) => ({ ...s, [p.id]: 'sending' }));
      const { failed, error } = await sendRecipes([recipeId], [p.id]);
      if (!failed.length) {
        setStates((s) => ({ ...s, [p.id]: 'sent' }));
        setSentTo((s) => ({ name: p.name, n: (s?.n ?? 0) + 1 }));
        AccessibilityInfo.announceForAccessibility?.(`Sent to ${p.name}`);
        haptic('success');
        trail('sent');
      } else {
        trail('send failed', errorMessage(error, 'error'));
        setStates((s) => ({ ...s, [p.id]: 'idle' }));
        toast.show(errorMessage(error, `That didn’t reach ${p.name}. Try again.`), { tone: 'error', icon: <CloseIcon size={14} color={colors.card} /> });
      }
    },
    [recipeId, toast, people],
  );

  // Budget: the sheet may use 92% of the window minus its grabber and bottom padding. The app row
  // is pinned under the scroller (hairline + 12 gap + the row), so it is always in reach; the
  // scroller holds the card (about half the sheet), the swatches and the faces.
  const bodyMax = winH * 0.92 - 28 - (Math.max(insets.bottom, 16) + 8);
  const row = rowHeight(circle);
  const pinned = PINNED_EXTRA + row;
  const scrollMax = bodyMax - pinned;
  const budget = bodyMax - (pinned + REST_EXTRA + row);
  const compact = budget < 300;
  // Photo between 64 and 168. Where even 64 would push the people row under the pinned row (an
  // iPhone SE: about 17 px of room), the card drops the photo so names stay in view.
  const room = budget - stageFor(0, compact);
  const photo = room < PHOTO_MIN ? 0 : Math.round(Math.min(168, room));
  const stageHeight = stageFor(photo, compact);

  if (!available) {
    return (
      <View style={styles.gone} accessibilityRole="summary">
        <PotMark size={64} />
        <Txt variant="display" size={24} leading={1.2} align="center">
          We couldn’t find this recipe
        </Txt>
      </View>
    );
  }

  return (
    <View style={styles.bleed}>
      <ScrollView
        style={[styles.scroller, { maxHeight: scrollMax }]}
        contentContainerStyle={styles.body}
        showsVerticalScrollIndicator={false}
        bounces={false}>
        <ShareCard data={data} swatch={swatch} photo={photo} stageHeight={stageHeight} compact={compact} />
        <SwatchRow
          value={swatch}
          onChange={(id) => {
            lastSwatch = id;
            setSwatch(id);
          }}
        />
        {people.length ? (
          <View style={styles.rowBleed}>
            <FamilyRow people={people} states={states} onSend={send} reveal={reveal} />
            {/* Over the swatches, just above the faces: the send can't land out of sight. */}
            <View pointerEvents="none" style={styles.sentLayer}>
              {sentTo ? (
                <Animated.View key={sentTo.n} entering={FadeIn.duration(180)} exiting={FadeOut.duration(180)} style={styles.sentToast}>
                  <View style={styles.sentDisc}>
                    <CheckIcon size={14} strokeWidth={3.5} color={colors.card} />
                  </View>
                  <Txt variant="label" size={15} weight={600} color={colors.card} numberOfLines={1} style={styles.sentText}>
                    Sent to {sentTo.name}
                  </Txt>
                </Animated.View>
              ) : null}
            </View>
          </View>
        ) : null}
      </ScrollView>
      <View style={styles.hairline} />
      <View style={styles.pinned}>
        <ExternalRow getUrl={getUrl} text={text} title={data?.title || 'A family recipe'} onTrace={trail} />
      </View>
    </View>
  );
}

/** A render error inside the sheet shows a calm line in the sheet instead of taking the app down. */
class BodyGuard extends Component<{ children: ReactNode }, { failed: boolean }> {
  state = { failed: false };
  static getDerivedStateFromError() {
    return { failed: true };
  }
  componentDidCatch(error: unknown) {
    trail('sheet body crashed (caught)', error);
  }
  render() {
    if (!this.state.failed) return this.props.children;
    return (
      <View style={styles.gone} accessibilityRole="summary">
        <PotMark size={64} />
        <Txt variant="display" size={24} leading={1.2} align="center">
          Sharing didn’t open
        </Txt>
        <Txt variant="body" leading={1.45} align="center" style={styles.goneBody}>
          Close this and try again.
        </Txt>
      </View>
    );
  }
}

// One row of round targets (RoundTarget): 6 + circle + 8 + 18 label + 6.
const rowHeight = (circle: number) => 6 + circle + 8 + 18 + 6;
// Pinned under the scroller: hairline (1) + 12 + the app row.
const PINNED_EXTRA = 1 + 12;
// Everything in the sheet but the card: the pinned row, plus the scroller's two 18 px gaps (under
// the stage and the swatches), the swatch row (36 + 2 x 6), the faces row and the scroller's
// 12 px bottom padding.
const REST_EXTRA = 18 + 48 + 18 + 12;
const PHOTO_MIN = 64;

const styles = StyleSheet.create({
  sheetContent: { paddingTop: 4 },
  // Full sheet width so the hairlines and the people row can run edge to edge.
  bleed: { marginHorizontal: -24 },
  scroller: { flexGrow: 0 },
  // The 12 px bottom padding is the gap above the pinned hairline. The photo is sized (or dropped)
  // so the content fits scrollMax; the scroller only scrolls if fonts run larger than planned.
  body: { gap: 18, paddingHorizontal: 24, paddingBottom: 12 },
  // The rows run edge to edge and pad themselves (RoundTarget's TargetRow).
  rowBleed: { marginHorizontal: -24 },
  // Sits on the swatch row (the 18 px gap + 48 px row above the faces), centred.
  sentLayer: { position: 'absolute', left: 0, right: 0, bottom: '100%', alignItems: 'center', paddingBottom: 6 },
  sentToast: {
    minHeight: 44,
    maxWidth: 320,
    paddingLeft: 7,
    paddingRight: 18,
    paddingVertical: 6,
    borderRadius: 999,
    backgroundColor: colors.ink,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    boxShadow: '0 10px 30px rgba(30,36,16,0.22)',
  },
  sentDisc: { width: 30, height: 30, borderRadius: 15, backgroundColor: colors.green, alignItems: 'center', justifyContent: 'center' },
  sentText: { flexShrink: 1 },
  hairline: { height: 1, backgroundColor: alpha.hairline },
  pinned: { paddingTop: 12 },
  gone: { alignItems: 'center', gap: 8, paddingVertical: 32, paddingHorizontal: 20 },
  goneBody: { maxWidth: 270 },
});
