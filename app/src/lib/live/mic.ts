// The microphone for homie: 16 kHz mono 16-bit PCM in ~100 ms chunks, handed to `onChunk` as
// ArrayBuffers for the voice service's WebSocket (docs/build/STACK.md "App ↔ voice service"). Native
// only (@siteed/audio-studio needs a dev build, not Expo Go); nothing is saved.
//
//   const mic = useMicStream((pcm) => socket.send(pcm), (level) => setHomieLevel(level));
//   await mic.start();  await mic.stop();  mic.on
//   await mic.start({ camera: true })   while the app's own camera films (lib/live/camera): the audio
//                                       session the camera uses, so neither changes it under the other
//
// The iOS session is PlayAndRecord in VoiceChat mode, and DefaultToSpeaker keeps playback off the
// earpiece. VoiceChat alone does NOT cancel echo: Apple only does that with voice processing (the
// VPIO audio unit), which audio-studio 3.2.1 never turns on. So half duplex is done here, for every
// caller, on every frame: while the app itself makes sound (lib/homie/logic halfDuplex: homie lit or
// speaking, anything on the shared player, a step video), `onChunk` gets zeroed PCM of the same
// length instead of the mic, with `quiet` true, and `onLevel` gets 0. The recorder never stops for it;
// homie's voice, the cook's clip and her voice note never reach the service as what the person said
// (the service also ignores audio while it speaks). /record sends the zeros, so its stream keeps its
// timing; cook mode sends nothing for a quiet frame (Ink bills silence too: lib/live/voiceLogic
// cookSendsFrame).
// `onLevel` (optional) gets each chunk's loudness, 0..1 (lib/homie/logic pcmLevel), for homie's steam.
// In Expo Go the native module isn't there: the module is never loaded and start() says 'error'.
// Stopping hands the session back to the app's playback mode (lib/media PLAYBACK_AUDIO_MODE): left in
// PlayAndRecord / VoiceChat, the next step video played near silent (Caleb, Oct 25). Not after a camera
// start: the camera owns its session then.
import type * as Studio from '@siteed/audio-studio';
import Constants, { ExecutionEnvironment } from 'expo-constants';
import { requestRecordingPermissionsAsync, setAudioModeAsync } from 'expo-audio';
import { useCallback, useEffect, useRef, useState } from 'react';
import { Platform } from 'react-native';

import { halfDuplex, pcmLevel } from '@/lib/homie/logic';
import { CAMERA_AUDIO_SESSION } from '@/lib/live/camera';
import { getHomie } from '@/lib/homie/store';
import { audioNow, PLAYBACK_AUDIO_MODE, videoPlaying } from '@/lib/media';

import { silence } from './voiceLogic';

export const MIC_SAMPLE_RATE = 16000;

const inExpoGo = Constants.executionEnvironment === ExecutionEnvironment.StoreClient;
// eslint-disable-next-line @typescript-eslint/no-require-imports -- loaded only where the native module exists
const studio: typeof Studio | null = inExpoGo ? null : require('@siteed/audio-studio');
const useRecorder: () => Studio.UseAudioRecorderState | null = studio?.useAudioRecorder ?? (() => null);

/** base64 PCM from the native module -> bytes for the socket. */
function decode(b64: string): ArrayBuffer {
  const bin = atob(b64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out.buffer;
}

/** The app is making sound right now: the next frame goes out as silence. */
function appSounding(): boolean {
  return halfDuplex({ homie: getHomie().state, audio: audioNow().phase, video: videoPlaying() });
}

export function micStreamingSupported(): boolean {
  return Platform.OS !== 'web' && !!studio;
}

export function useMicStream(onChunk: (pcm: ArrayBuffer, quiet: boolean) => void, onLevel?: (level: number) => void) {
  const rec = useRecorder();
  const [on, setOn] = useState(false);
  const sink = useRef(onChunk);
  const levelSink = useRef(onLevel);
  // Started for the app's own camera: its session isn't ours to hand back.
  const withCamera = useRef(false);
  useEffect(() => {
    sink.current = onChunk;
    levelSink.current = onLevel;
  });

  const start = useCallback(async ({ camera = false }: { camera?: boolean } = {}): Promise<'ok' | 'denied' | 'error'> => {
    if (!rec || !micStreamingSupported()) return 'error';
    const perm = await requestRecordingPermissionsAsync().catch(() => null);
    if (!perm?.granted) return 'denied';
    withCamera.current = camera;
    try {
      await rec.startRecording({
        sampleRate: MIC_SAMPLE_RATE,
        channels: 1,
        encoding: 'pcm_16bit',
        interval: 100,
        keepFullAnalysis: false,
        output: { primary: { enabled: false } },
        ios: {
          audioSession: camera
            ? { category: CAMERA_AUDIO_SESSION.category, mode: CAMERA_AUDIO_SESSION.mode, categoryOptions: [...CAMERA_AUDIO_SESSION.categoryOptions] }
            : { category: 'PlayAndRecord', mode: 'VoiceChat', categoryOptions: ['DefaultToSpeaker', 'AllowBluetooth', 'MixWithOthers'] },
        },
        onAudioStream: async (e) => {
          const pcm = typeof e.data === 'string' ? decode(e.data) : e.data instanceof Int16Array ? e.data.slice().buffer : null;
          if (!pcm) return;
          const quiet = appSounding();
          sink.current(quiet ? silence(pcm.byteLength) : pcm, quiet);
          levelSink.current?.(quiet ? 0 : pcmLevel(pcm));
        },
      });
      setOn(true);
      return 'ok';
    } catch (e) {
      console.warn('[mic] could not start', String(e));
      return 'error';
    }
  }, [rec]);

  /** Resolves once the recorder has let go of the audio session (await it before the camera opens). */
  const stop = useCallback(async (): Promise<void> => {
    setOn(false);
    await rec?.stopRecording().catch(() => {});
    if (!withCamera.current) await setAudioModeAsync(PLAYBACK_AUDIO_MODE).catch(() => {});
  }, [rec]);

  // Leaving the screen never leaves the microphone on.
  const recRef = useRef(rec);
  useEffect(() => {
    recRef.current = rec;
  });
  useEffect(
    () => () =>
      void recRef.current
        ?.stopRecording()
        .catch(() => {})
        .then(() => (withCamera.current ? undefined : setAudioModeAsync(PLAYBACK_AUDIO_MODE).catch(() => {}))),
    [],
  );

  return { on, start, stop };
}
