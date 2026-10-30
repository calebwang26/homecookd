// The walkie-talkie's flow (app/answer/[id], Caleb's v2), with no buttons:
//   reading    homie reads the kid's question aloud in her language
//   listening  once that has played, the recorder runs with metering (walkieLogic): ~2 s quiet after
//              at least ~1 s of talking ends her answer (a share ask's yes or no: a short word)
//   sending    the voice note goes (questions.answer)
//   sent       homie says and shows "Shreya ला पाठवलं", then the screen closes by itself
// No answer in ~15 s: homie asks once more, then the screen closes with nothing sent. A failed send
// listens again once; a second failure closes with a toast. `again()` (a tap on the question) reads it
// again. `nomic`: the microphone is off (or this isn't a phone): the screen says so.
//
//   const walkie = useWalkie({ ready, kind, talking, read, send, thank, close });
import { useCallback, useEffect, useRef, useState } from 'react';

import { recordingSupported, useVoiceRecorder, type VoiceRecording } from '@/lib/voice';

import { afterNoAnswer, hear, startListening, verdict, type Listen } from './walkieLogic';

export type WalkieStep = 'waiting' | 'reading' | 'listening' | 'sending' | 'sent' | 'retry' | 'nomic' | 'nomicHere';

/** "Shreya ला पाठवलं" shows at least this long. */
export const SENT_HOLD_MS = 2600;
/** Reading the question never takes longer than this (a voice that never says it ended). */
const READ_MAX_MS = 25_000;
const TICK_MS = 100;
const RETRY_PAUSE_MS = 1200;

type Props = {
  /** The question and her language are known. */
  ready: boolean;
  /** The question's kind: 'share' (a yes or no to the Community map) and 'followUp' (homie's own) take a short answer. */
  kind?: string | null;
  /** homie is lit or speaking (the egg's state). */
  talking: boolean;
  /** homie reads the question; resolves once its voice starts (or didn't: 'none'). */
  read: () => Promise<{ via: 'homie' | 'phone' | 'none' }>;
  send: (note: VoiceRecording) => Promise<unknown>;
  /** homie says "Sent to Shreya" (in her language). */
  thank: () => void;
  /** Leave the screen. `failed`: it didn't send. */
  close: (failed?: boolean) => void;
};

export function useWalkie(props: Props) {
  const rec = useVoiceRecorder();
  const [step, setStep] = useState<WalkieStep>('waiting');
  const stepRef = useRef(step);
  const latest = useRef({ props, rec });
  useEffect(() => {
    latest.current = { props, rec };
    stepRef.current = step;
  });
  const asked = useRef(0);
  const failures = useRef(0);
  const heardHomie = useRef(false);
  const listen = useRef<Listen | null>(null);

  const go = useCallback((s: WalkieStep) => {
    stepRef.current = s;
    setStep(s);
  }, []);

  const listenNow = useCallback(async () => {
    go('listening');
    const ok = await latest.current.rec.start();
    if (stepRef.current !== 'listening') return; // a tap on the question meanwhile (the effect below stops the recorder)
    if (!ok) return go(recordingSupported() ? 'nomic' : 'nomicHere');
    listen.current = startListening(Date.now(), latest.current.props.kind);
  }, [go]);

  const readIt = useCallback(async () => {
    listen.current = null;
    await latest.current.rec.cancel();
    heardHomie.current = false;
    asked.current += 1;
    go('reading');
    const said = await latest.current.props.read();
    if (said.via === 'none' && stepRef.current === 'reading') void listenNow();
  }, [go, listenNow]);

  const noAnswer = useCallback(async () => {
    listen.current = null;
    await latest.current.rec.cancel();
    if (afterNoAnswer(asked.current) === 'ask_again') void readIt();
    else latest.current.props.close();
  }, [readIt]);

  const sendIt = useCallback(async () => {
    listen.current = null;
    go('sending');
    const note = await latest.current.rec.stop();
    if (!note) return void noAnswer();
    try {
      await latest.current.props.send(note);
      go('sent');
      latest.current.props.thank();
    } catch (e) {
      console.warn('[walkie] send', String(e).slice(0, 160));
      failures.current += 1;
      if (failures.current >= 2) return latest.current.props.close(true);
      go('retry');
      setTimeout(() => stepRef.current === 'retry' && void listenNow(), RETRY_PAUSE_MS);
    }
  }, [go, noAnswer, listenNow]);

  // 1. Read it once the question and her language are known.
  const { ready, talking } = props;
  useEffect(() => {
    if (ready && stepRef.current === 'waiting') void readIt();
  }, [ready, readIt]);

  // 2. Once homie's voice has played: listen.
  useEffect(() => {
    if (step !== 'reading') return;
    if (talking) heardHomie.current = true;
    else if (heardHomie.current) void listenNow();
  }, [step, talking, listenNow]);
  useEffect(() => {
    if (step !== 'reading') return;
    const t = setTimeout(() => stepRef.current === 'reading' && void listenNow(), READ_MAX_MS);
    return () => clearTimeout(t);
  }, [step, listenNow]);

  // The recorder runs only while listening (and until a send has the note): any other step stops it,
  // however it got there (a tap on the question while the microphone was starting, for one).
  const recording = rec.recording;
  const cancel = rec.cancel;
  useEffect(() => {
    if (recording && step !== 'listening' && step !== 'sending') void cancel();
  }, [recording, step, cancel]);

  // 3. Listening: every meter reading, and the verdict.
  useEffect(() => {
    if (step !== 'listening') return;
    const t = setInterval(() => {
      const l = listen.current;
      if (!l) return;
      const now = Date.now();
      listen.current = hear(l, latest.current.rec.level, now);
      const v = verdict(listen.current, now);
      if (v === 'send') void sendIt();
      else if (v === 'no_answer') void noAnswer();
    }, TICK_MS);
    return () => clearInterval(t);
  }, [step, sendIt, noAnswer]);

  // 4. Sent: close once homie has said so and the line has shown long enough.
  const [held, setHeld] = useState(false);
  useEffect(() => {
    if (step !== 'sent') return;
    const t = setTimeout(() => setHeld(true), SENT_HOLD_MS);
    return () => clearTimeout(t);
  }, [step]);
  useEffect(() => {
    if (step === 'sent' && held && !talking) latest.current.props.close();
  }, [step, held, talking]);

  /** A tap on the question: homie reads it again (not while it sends). */
  const again = useCallback(() => {
    if (stepRef.current === 'sending' || stepRef.current === 'sent') return;
    asked.current -= 1; // a replay isn't another try
    void readIt();
  }, [readIt]);

  return { step, level: rec.level, again };
}
