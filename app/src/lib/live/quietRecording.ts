// The recording screen with homie switched off (lib/homie/switch): the same shape as useHomieRecording
// (lib/live/homie), with no /record socket, no mic stream and no voice. Filming starts and ends through Convex
// alone (live.startFilming, live.endRecording, as the glasses' Start and Stop already do), so the video still goes
// and nothing asks her a question. Filming starts on her tap (introDone is true at once), and the screen ends the recording after
// the last file is saved (app/recording doneInApp), never before.
import { useCallback, useRef, useState } from 'react';

import type { RecordPhase } from '@/components/record/recordingLogic';
import { NOT_HELD } from '@/components/record/recordingLogic';

import { endRecording, startFilming } from './convex';
import type { HomieError, RecordingInfo, useHomieRecording } from './homie';

const none = () => {};

export function useQuietRecording(
  recordingId: string | null | undefined,
  _info: RecordingInfo,
  _opts: { camera?: boolean } = {},
): ReturnType<typeof useHomieRecording> {
  const [phase, setPhaseState] = useState<RecordPhase>('intro');
  const [error, setError] = useState<HomieError | null>(null);
  const phaseRef = useRef<RecordPhase>('intro');
  const ending = useRef<Promise<boolean> | null>(null);
  const goPhase = useCallback((p: RecordPhase) => {
    phaseRef.current = p;
    setPhaseState(p);
  }, []);

  /** intro -> recording on the server (startedAt is set). Filming goes on even when this fails. */
  const start = useCallback(async () => {
    if (!recordingId || phaseRef.current !== 'intro') return;
    const ok = await startFilming(recordingId).catch(() => false);
    if (!ok) console.warn('[recording] live.startFilming failed; filming anyway');
    if (phaseRef.current === 'intro') goPhase('recording');
  }, [recordingId, goPhase]);

  /** Ends the recording through Convex. True once ended; a failure shows the lost-line error (Try again ends it). */
  const end = useCallback((): Promise<boolean> => {
    if (!recordingId) return Promise.resolve(false);
    if (phaseRef.current === 'ended') return Promise.resolve(true);
    ending.current ??= endRecording(recordingId).then((ok) => {
      ending.current = null;
      if (ok) {
        setError(null);
        goPhase('ended');
      } else setError('lostConnection');
      return ok;
    });
    return ending.current;
  }, [recordingId, goPhase]);

  const done = useCallback(() => void end(), [end]);

  const filmInApp = useCallback(
    async (begin: () => Promise<boolean>) => {
      await start();
      return begin();
    },
    [start],
  );

  /** The system camera (older builds): start, film, then end. False when no video came back. */
  const filmWithPhone = useCallback(
    async (record: () => Promise<boolean>) => {
      await start();
      if (!(await record())) return false;
      await end();
      return true;
    },
    [start, end],
  );

  // No recording yet (a glasses one before her Start, the web previews): nothing to film, as homie's 'connecting'.
  return {
    phase: recordingId ? phase : 'connecting',
    info: null,
    introDone: !!recordingId,
    ask: null,
    hold: NOT_HELD.hold,
    said: NOT_HELD.said,
    micOn: false,
    micDenied: false,
    error,
    serverError: false,
    start: useCallback(() => void start(), [start]),
    done,
    end,
    notNow: none,
    filmWithPhone,
    filmInApp,
    cameraFilming: none,
    restartMic: useCallback(async () => {}, []),
    sendFrame: none,
    pause: none,
    resume: none,
    plateDone: none,
    retry: done,
  };
}
