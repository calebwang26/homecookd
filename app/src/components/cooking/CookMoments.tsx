// homie's moments in cook mode (lib/homie showMoment: the pot to the centre, the screen blurred). When
// homie needs a yes or no, there are no buttons (Caleb, Oct 24): the question, the listening bars, "Say
// “yes” or “no”" and "Tap anywhere to close" (lib/live/voiceLogic yesNoMoment). A spoken yes does it,
// a spoken no or a tap anywhere closes it, and the mic keeps listening for commands. Only a phone that
// can't hear the answer for as long as it's up (Expo Go, web, homie off, or only a step line's short
// window) gets one button for yes. A tap on homie never opens one (it turns homie on or off).
//   useCookMoments()  "Want me to read each step out loud?" when the service offers it (off by default
//                     since Oct 24: VOICE_READ_OFFER; a spoken answer or the button is kept on this phone,
//                     and the next visit answers it for the kid; a tap anywhere is "not now" for this
//                     visit only. Without a voice line, a kept yes reads the steps here: useReadSteps),
//                     "<cook> has a story about this step", and "Ask <cook> anything" (`ask`: a long
//                     press on homie; the kid's next words go straight to the cook)
//   <CookAnswers/>    "Grandma answered your question": yes plays her voice note on the shared player,
//                     and the English translation shows small under the chips, labelled "Translated
//                     from Grandma" (her real voice is what plays)
// The kid's words close the moment up (homie heard them); yes / no answer it. Leaving the screen closes them.
// The service's read-aloud offer (shared contract, lib/live/voice): the phone says "no" for a tap
// anywhere or a remembered no (that visit, steps change silently), "yes" for the button or a
// remembered yes, and its offer_closed closes the moment and keeps homie's answer when it differs.
import { useIsFocused } from 'expo-router';
import { useCallback, useEffect, useRef, useState } from 'react';
import { StyleSheet } from 'react-native';
import Animated, { FadeIn, FadeOut } from 'react-native-reanimated';

import { Txt } from '@/components/ui';
import { closeMoment, getHomie, showMoment, useAiSpeaking, useHomieSelect, type HomieMoment } from '@/lib/homie';
import { ANSWER_KEY, useHeardAnswers, useRecipeAnswers } from '@/lib/live/answers';
import { stopSay } from '@/lib/live/say';
import { speak, stopSpeaking } from '@/lib/live/speak';
import type { VoiceOffer } from '@/lib/live/voice';
import { answersToHear, askMoment, readAfterOfferClosed, yesNo, yesNoMoment, type SayKind } from '@/lib/live/voiceLogic';
import { playClip, useNowPlaying, useVideoPlaying } from '@/lib/media';
import { useSession } from '@/lib/session';
import { kvGet, kvSet } from '@/lib/storage';
import { colors, radii, shadows } from '@/theme/tokens';

const READ_KEY = 'homie.readAloud';
const READ_QUESTION = 'Want me to read each step out loud?';
/** Answers to questions older than this don't pop up any more. */
const ANSWER_MAX_AGE_MS = 7 * 24 * 3600_000;

type ReadChoice = 'yes' | 'no';

/** The kid's answer to "read it out loud?": kept on this phone, or (a tap anywhere) only for this visit. */
function useReadAloud() {
  const [choice, setChoice] = useState<ReadChoice | null>(null);
  const [loaded, setLoaded] = useState(false);
  const ref = useRef<ReadChoice | null>(null);
  useEffect(() => {
    let alive = true;
    void kvGet(READ_KEY).then((v) => {
      if (!alive) return;
      // A choice made this visit before the saved one loaded wins.
      if ((v === 'yes' || v === 'no') && !ref.current) {
        ref.current = v;
        setChoice(v);
      }
      setLoaded(true);
    });
    return () => {
      alive = false;
    };
  }, []);
  const set = useCallback((c: ReadChoice, keep: boolean) => {
    ref.current = c;
    setChoice(c);
    if (keep) void kvSet(READ_KEY, c);
  }, []);
  return { choice, loaded, ref, set };
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

/** What the kid's words do to the moment up now: yes, no, or anything else (each closes it). */
export type SpokenAnswer = { yes?: () => void; no?: () => void; other?: () => void };
/** Opens a moment the kid can answer out loud. */
export type ListenFor = (m: HomieMoment, on?: SpokenAnswer) => void;

/** How this phone answers the service's offer for the kid. */
type OfferAnswer = Pick<VoiceOffer, 'accept' | 'decline'>;

export function useCookMoments({ cookName }: { cookName: string }) {
  const { me } = useSession();
  const read = useReadAloud();
  const open = useOwnMoments();
  // The moment up now that the kid's words answer or close.
  const spoken = useRef<(SpokenAnswer & { id: string }) | null>(null);
  // The read-aloud offer, until the kid's choice is known (an answer, or homie starting to read).
  const offer = useRef<{ id: string; heard: boolean } | null>(null);
  const args = useRef({ cookName, meId: me?.id });
  useEffect(() => {
    args.current = { cookName, meId: me?.id };
  });
  const { ref: readRef, set: setRead } = read;

  const listenFor = useCallback<ListenFor>(
    (m, on = {}) => {
      spoken.current = { id: m.id, ...on };
      open(m);
    },
    [open],
  );

  /** "Want me to read each step out loud?", answered on the voice line through `answer` (when there is one). */
  const offerRead = useCallback(
    (hearing: boolean, answer: OfferAnswer) => {
      const id = `read:${Date.now()}`;
      offer.current = { id, heard: false };
      const choose = (c: ReadChoice, keep: boolean) => {
        offer.current = null;
        setRead(c, keep);
      };
      listenFor(
        yesNoMoment({
          id,
          question: READ_QUESTION,
          hearing,
          button: 'Read it to me',
          onChoose: (choice) => {
            stopSay();
            if (choice === 'yes') {
              choose('yes', true);
              answer.accept();
              return;
            }
            // A tap anywhere only closes it: "not now" for this visit, never saved (homie's own line
            // says "tap here"), and the service is told no, so steps change silently.
            choose('no', false);
            answer.decline();
          },
        }),
        // Out loud, homie heard the answer itself (it reads, or it closes its offer); anything else
        // may still be a yes it understood.
        {
          yes: () => choose('yes', true),
          no: () => choose('no', true),
          other: () => {
            if (offer.current) offer.current.heard = true;
          },
        },
      );
    },
    [listenFor, setRead],
  );

  const onOffer = useCallback(
    (o: VoiceOffer): 'play' | 'skip' => {
      if (o.kind === 'read') {
        // Answered before (on this phone, or earlier this visit): said for the kid, and not asked again.
        if (readRef.current === 'yes') {
          o.accept();
          return 'skip';
        }
        if (readRef.current === 'no') {
          o.decline();
          return 'skip';
        }
        offerRead(o.hearing, o);
        return 'play';
      }
      // A story: only when nothing else is asking (homie still says it; "yes" by voice still works).
      if (getHomie().moment) return 'play';
      listenFor(
        yesNoMoment({
          id: `story:${Date.now()}`,
          question: `${args.current.cookName} has a story about this step`,
          hearing: o.hearing,
          // TODO(caleb): the one button where the kid can't answer out loud (mic off); the spec names
          // only "Read it to me", so this keeps the same no-mic rule for the story and the answer.
          button: 'Hear it',
          onChoose: (choice) => {
            stopSay();
            if (choice === 'yes') o.accept();
          },
        }),
      );
      return 'play';
    },
    [listenFor, offerRead, readRef],
  );

  /**
   * The service closed its read-aloud offer: its moment closes, if still up. The service's answer is
   * kept whenever the phone's differs (homie heard a yes or no out loud after the phone moved on), so
   * the phone and homie agree on reading aloud.
   */
  const onOfferClosed = useCallback(
    (accepted: boolean) => {
      const o = offer.current;
      if (o) {
        offer.current = null;
        closeMoment(o.id);
      }
      const c = readAfterOfferClosed(readRef.current, accepted);
      if (c) setRead(c, true);
    },
    [readRef, setRead],
  );

  /** What the kid said (or '' when homie moved on by itself): closes the moment up, and answers it. */
  const onHeard = useCallback((text = '') => {
    const s = spoken.current;
    spoken.current = null;
    if (!s || getHomie().moment?.id !== s.id) return;
    closeMoment(s.id);
    const yn = yesNo(text);
    (yn === 'yes' ? s.yes : yn === 'no' ? s.no : s.other)?.();
  }, []);

  // homie reading a step after the offer = the kid said yes out loud; any other line = they didn't.
  // The step line a tap on homie asked for (`tap`) is neither.
  const onSay = useCallback(
    (kind: SayKind, line?: { tap: boolean }) => {
      const o = offer.current;
      if (!o || kind === 'offer' || line?.tap) return;
      if (kind === 'step') {
        setRead('yes', true);
        closeMoment(o.id);
        offer.current = null;
      } else if (o.heard) offer.current = null;
    },
    [setRead],
  );

  /**
   * "Ask <cook> anything" (a long press on homie, voiceLogic askMoment), said out loud too. The kid's next
   * words are the question (the service sends it straight to the cook) and close it, and so does a tap
   * anywhere; the cook screen closes it 25 s after the kid last talked, or once homie can't hear it
   * (voiceLogic askCloseIn). The mic stays on meanwhile (lib/live/voice setMoment('ask')).
   */
  const ask = useCallback(() => {
    const { cookName, meId } = args.current;
    const m = askMoment(cookName, Date.now());
    listenFor(m);
    void speak(`${m.question}.`, { profileId: meId, answer: true });
  }, [listenFor]);

  return { onOffer, onOfferClosed, onHeard, onSay, listenFor, ask, readAloud: read.choice === 'yes' };
}

/**
 * Without a voice line that reads (Expo Go, web, or the line gave up or failed): a kid who said "Read
 * it to me" hears each step here, in homie's voice (lib/live/speak), while this screen is on top, never
 * over the step's video (the line waits for it).
 */
export function useReadSteps({ on, step, text }: { on: boolean; step: number; text: string }) {
  const { me } = useSession();
  const focused = useIsFocused();
  const meId = me?.id;
  useEffect(() => {
    if (!on || !focused || !text) return;
    void speak(`Step ${step}. ${text}`, { profileId: meId });
    return () => stopSpeaking();
  }, [on, focused, step, text, meId]);
}

/**
 * "Grandma answered your question": one at a time, when nothing else is asking or speaking. Yes plays
 * her voice note (heard: never offered again on this phone); no, or a tap, waits for the next visit.
 * `hearing`: the kid can answer out loud (else one "Play it" button). `top` (window pt): where the
 * translation shows while it plays.
 */
export function CookAnswers({
  libraryId,
  cookName,
  asked,
  top,
  hearing,
  listenFor,
}: {
  libraryId: string | null;
  cookName: string;
  asked: ReadonlySet<string>;
  top: number;
  hearing: boolean;
  listenFor: ListenFor;
}) {
  const rows = useRecipeAnswers(libraryId);
  const heard = useHeardAnswers();
  const { me } = useSession();
  const focused = useIsFocused();
  const [since] = useState(() => Date.now() - ANSWER_MAX_AGE_MS);
  const [skipped, setSkipped] = useState<ReadonlySet<string>>(() => new Set());
  const moment = useHomieSelect((h) => h.moment);
  const speaking = useAiSpeaking();
  const now = useNowPlaying();
  const sounding = now.phase === 'playing' || now.phase === 'loading';
  const video = useVideoPlaying();
  // The moments this opened, closed when it goes ("I made it" takes the screen).
  const mine = useRef(new Set<string>());
  useEffect(() => {
    const own = mine.current;
    return () => own.forEach((id) => closeMoment(id));
  }, []);

  const next = heard.loaded ? answersToHear(rows, { myName: me?.name, mine: asked, heard: heard.ids, skipped, since })[0] : undefined;
  // Never over a video: her answer is offered at the next pause.
  const free = focused && !moment && !speaking && !sounding && !video;
  const { add } = heard;
  const meId = me?.id;
  useEffect(() => {
    if (!next || !free || !next.answerAudioUrl) return;
    const url = next.answerAudioUrl;
    const questionId = next._id;
    const play = () => {
      add(questionId);
      playClip({ url, key: `${ANSWER_KEY}${questionId}` });
    };
    const later = () => setSkipped((s) => new Set(s).add(questionId));
    const id = `answer:${questionId}`;
    mine.current.add(id);
    listenFor(
      yesNoMoment({
        id,
        question: `${cookName} answered your question`,
        questionEn: `“${next.text}”`,
        hearing,
        button: 'Play it', // the no-mic button (see the story's TODO(caleb))
        onChoose: (choice) => (choice === 'yes' ? play() : later()),
      }),
      { yes: play, no: later, other: later },
    );
    void speak(`${cookName} answered your question.`, { translate: true, profileId: meId });
  }, [next, free, hearing, listenFor, add, cookName, meId]);

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
