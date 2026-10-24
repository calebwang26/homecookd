// homie's moments in cook mode (lib/homie showMoment: the pot to the centre, the screen blurred, big
// buttons under it). Plain replies and hints are only spoken; a moment is for when homie needs a tap:
//   useCookMoments()  "Want me to read each step out loud?" (Yes, read it / Not now; the choice is kept
//                     on this phone, and the next visit answers it for the kid), a story offer (Hear it /
//                     Later), "Ask Grandma anything" (a listening moment: the kid's next words are the
//                     question), and a tap on the pot (the help line, and the mic on or off)
//   <CookAnswers/>    "Grandma answered your question" (Play it / Later): her voice note plays on the
//                     shared player, and the English translation shows small under the chips, labelled
//                     "Translated from Grandma" (her real voice is what plays)
// Words the kid says closes an offer or the ask (they answered by voice). Leaving the screen closes them.
import { useIsFocused } from 'expo-router';
import { useCallback, useEffect, useRef, useState } from 'react';
import { StyleSheet } from 'react-native';
import Animated, { FadeIn, FadeOut } from 'react-native-reanimated';

import { Txt } from '@/components/ui';
import { closeMoment, getHomie, HELP, showMoment, useAiSpeaking, useHomie, type HomieMoment, type HomieOption } from '@/lib/homie';
import { useHeardAnswers, useRecipeAnswers } from '@/lib/live/answers';
import { stopSay } from '@/lib/live/say';
import { speak } from '@/lib/live/speak';
import type { VoiceCooking, VoiceOffer } from '@/lib/live/voice';
import { answersToHear, type SayKind } from '@/lib/live/voiceLogic';
import { playClip, useNowPlaying } from '@/lib/media';
import { useSession } from '@/lib/session';
import { kvGet, kvSet } from '@/lib/storage';
import { colors, radii, shadows } from '@/theme/tokens';

const READ_KEY = 'homie.readAloud';
const ANSWER_KEY = 'cook-answer:';
const ASK_OPEN_MS = 25_000;
const HELP_SHOWN_MS = 8000;
/** Answers to questions older than this don't pop up any more. */
const ANSWER_MAX_AGE_MS = 7 * 24 * 3600_000;

type ReadChoice = 'yes' | 'no';

/** The kid's answer to "read it out loud?", kept on this phone. */
function useReadAloud() {
  const [choice, setChoice] = useState<ReadChoice | null>(null);
  const ref = useRef<ReadChoice | null>(null);
  useEffect(() => {
    let alive = true;
    void kvGet(READ_KEY).then((v) => {
      if (!alive || (v !== 'yes' && v !== 'no')) return;
      ref.current = v;
      setChoice(v);
    });
    return () => {
      alive = false;
    };
  }, []);
  const set = useCallback((c: ReadChoice) => {
    ref.current = c;
    setChoice(c);
    void kvSet(READ_KEY, c);
  }, []);
  return { choice, ref, set };
}

/** Moments this screen opened, closed when it goes. */
function useOwnMoments() {
  const ids = useRef(new Set<string>());
  useEffect(() => {
    const own = ids.current;
    return () => own.forEach((id) => closeMoment(id));
  }, []);
  return useCallback((m: HomieMoment) => {
    ids.current.add(m.id);
    showMoment(m);
  }, []);
}

type Args = {
  cookName: string;
  /** Opens my chat about this step (the existing Ask); null when there's nobody to ask. */
  onWrite: (() => void) | null;
  /** Who that chat goes to: the cook, or "the family" when the cook isn't in it. */
  writeTo: string;
};

/** The voice line as it is when a chip or the pot is tapped. */
type VoiceNow = Pick<VoiceCooking, 'live' | 'muted' | 'status' | 'setMuted' | 'listen'>;

/** `ask(voice)` and `potPress(voice)` take the voice line as it is at the tap. */
export function useCookMoments({ cookName, onWrite, writeTo }: Args) {
  const { me } = useSession();
  const read = useReadAloud();
  const open = useOwnMoments();
  // The offer, story or ask up now: the kid's words close it.
  const spoken = useRef<string | null>(null);
  // The read-aloud offer, until the kid's choice is known (a tap, or homie starting to read).
  const offer = useRef<{ id: string; heard: boolean } | null>(null);
  const args = useRef({ cookName, onWrite, writeTo, meId: me?.id });
  useEffect(() => {
    args.current = { cookName, onWrite, writeTo, meId: me?.id };
  });
  const { ref: readRef, set: setRead } = read;

  const onOffer = useCallback(
    (o: VoiceOffer): 'play' | 'skip' => {
      if (o.kind === 'read') {
        if (readRef.current === 'yes') {
          o.accept();
          return 'skip';
        }
        if (readRef.current === 'no') return 'skip';
        const id = `read:${Date.now()}`;
        offer.current = { id, heard: false };
        spoken.current = id;
        open({
          id,
          question: 'Want me to read each step out loud?',
          options: [
            { id: 'yes', label: 'Yes, read it', kind: 'primary' },
            { id: 'not_now', label: 'Not now' },
          ],
          onChoose: (choice) => {
            stopSay();
            offer.current = null;
            setRead(choice === 'yes' ? 'yes' : 'no');
            if (choice === 'yes') o.accept();
          },
        });
        return 'play';
      }
      // A story: only when nothing else is asking (homie still says it; "yes" by voice still works).
      if (getHomie().moment) return 'play';
      const id = `story:${Date.now()}`;
      spoken.current = id;
      open({
        id,
        question: `${args.current.cookName} has a story about this step`,
        options: [
          { id: 'yes', label: 'Hear it', kind: 'primary' },
          { id: 'not_now', label: 'Later' },
        ],
        onChoose: (choice) => {
          stopSay();
          if (choice === 'yes') o.accept();
        },
      });
      return 'play';
    },
    [open, readRef, setRead],
  );

  const onHeard = useCallback(() => {
    if (spoken.current) closeMoment(spoken.current);
    spoken.current = null;
    if (offer.current) offer.current.heard = true;
  }, []);

  // homie reading a step after the offer = the kid said yes out loud; any other line = they didn't.
  const onSay = useCallback(
    (kind: SayKind) => {
      const o = offer.current;
      if (!o || kind === 'offer') return;
      if (kind === 'step') {
        setRead('yes');
        closeMoment(o.id);
        offer.current = null;
      } else if (o.heard) offer.current = null;
    },
    [setRead],
  );

  /** The Ask chip: by voice when homie is listening, else the chat with the cook. */
  const ask = useCallback((v: VoiceNow) => {
    const { cookName: name, onWrite: write, writeTo, meId } = args.current;
    if (!v.live || v.muted) return write?.();
    const id = `ask:${Date.now()}`;
    spoken.current = id;
    const options: HomieOption[] = [...(write ? [{ id: 'write', label: `Write to ${writeTo}` }] : []), { id: 'not_now', label: 'Not now' }];
    open({
      id,
      question: `Ask ${name} anything`,
      listening: { label: 'I’m listening', sublabel: 'Just say your question' },
      options,
      onChoose: (choice) => {
        if (choice === 'write') args.current.onWrite?.();
      },
    });
    void speak(`Ask ${name} anything.`, { profileId: meId });
    setTimeout(() => closeMoment(id), ASK_OPEN_MS);
  }, [open]);

  /** A tap on the resting pot: what you can say, and the mic on or off. */
  const potPress = useCallback((v: VoiceNow) => {
    const meId = args.current.meId;
    const id = `mic:${Date.now()}`;
    if (v.status === 'listening' && !v.muted) {
      open({
        id,
        question: HELP.cook,
        options: [
          { id: 'ok', label: 'OK', kind: 'primary' },
          { id: 'mic', label: 'Turn the mic off' },
        ],
        onChoose: (choice) => choice === 'mic' && v.setMuted(true),
      });
      void speak(HELP.cook, { translate: true, profileId: meId });
      setTimeout(() => closeMoment(id), HELP_SHOWN_MS);
      return;
    }
    open({
      id,
      question: 'Cook with your voice?',
      questionEn: HELP.cook,
      options: [
        { id: 'mic', label: 'Turn the mic on', kind: 'primary' },
        { id: 'not_now', label: 'Not now' },
      ],
      onChoose: (choice) => choice === 'mic' && v.listen(),
    });
    void speak('Cook with your voice?', { translate: true, profileId: meId });
  }, [open]);

  return { onOffer, onHeard, onSay, ask, potPress, readAloud: read.choice === 'yes' };
}

/**
 * "Grandma answered your question": one at a time, when nothing else is asking or speaking. Play it
 * plays her voice note (heard: never offered again on this phone); Later waits for the next visit.
 * `top` (window pt): where the translation shows while it plays.
 */
export function CookAnswers({ libraryId, cookName, asked, top }: { libraryId: string | null; cookName: string; asked: ReadonlySet<string>; top: number }) {
  const rows = useRecipeAnswers(libraryId);
  const heard = useHeardAnswers();
  const { me } = useSession();
  const focused = useIsFocused();
  const open = useOwnMoments();
  const [since] = useState(() => Date.now() - ANSWER_MAX_AGE_MS);
  const [skipped, setSkipped] = useState<ReadonlySet<string>>(() => new Set());
  const { moment } = useHomie();
  const speaking = useAiSpeaking();
  const now = useNowPlaying();
  const sounding = now.phase === 'playing' || now.phase === 'loading';

  const next = heard.loaded ? answersToHear(rows, { myName: me?.name, mine: asked, heard: heard.ids, skipped, since })[0] : undefined;
  const free = focused && !moment && !speaking && !sounding;
  const { add } = heard;
  const meId = me?.id;
  useEffect(() => {
    if (!next || !free || !next.answerAudioUrl) return;
    const url = next.answerAudioUrl;
    const questionId = next._id;
    open({
      id: `answer:${questionId}`,
      question: `${cookName} answered your question`,
      questionEn: `“${next.text}”`,
      options: [
        { id: 'play', label: 'Play it', kind: 'primary' },
        { id: 'not_now', label: 'Later' },
      ],
      onChoose: (choice) => {
        if (choice !== 'play') return setSkipped((s) => new Set(s).add(questionId));
        add(questionId);
        playClip({ url, key: `${ANSWER_KEY}${questionId}` });
      },
    });
    void speak(`${cookName} answered your question.`, { translate: true, profileId: meId });
  }, [next, free, open, add, cookName, meId]);

  const playingId = sounding && now.key?.startsWith(ANSWER_KEY) ? now.key.slice(ANSWER_KEY.length) : null;
  const english = playingId ? rows.find((r) => r._id === playingId)?.answer?.translation : null;
  if (!english) return null;
  return (
    <Animated.View entering={FadeIn.duration(200)} exiting={FadeOut.duration(150)} pointerEvents="none" style={[styles.caption, { top }]} accessibilityLiveRegion="polite">
      <Txt variant="caption" size={11} weight={700} color={colors.lavenderInk} style={styles.captionLabel}>
        {`Translated from ${cookName}`}
      </Txt>
      <Txt variant="bodyInk" size={15} leading={1.35}>
        {english}
      </Txt>
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  caption: {
    position: 'absolute',
    zIndex: 3,
    right: 24,
    maxWidth: 300,
    gap: 6,
    paddingHorizontal: 14,
    paddingVertical: 12,
    borderRadius: radii.tile,
    backgroundColor: colors.card,
    boxShadow: shadows.cardRaised,
  },
  captionLabel: { alignSelf: 'flex-start', paddingHorizontal: 8, paddingVertical: 2, borderRadius: radii.pill, backgroundColor: colors.lavender, overflow: 'hidden' },
});
