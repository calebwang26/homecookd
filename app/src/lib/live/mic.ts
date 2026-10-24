// The kid's microphone while voice cooking: 16 kHz mono 16-bit PCM in ~100 ms chunks, handed to
// `onChunk` as ArrayBuffers for the voice service's WebSocket (docs/build/STACK.md "App ↔ voice
// service"). Native only (@siteed/audio-studio needs a dev build, not Expo Go); nothing is saved.
//
//   const mic = useMicStream((pcm) => socket.send(pcm), (level) => setHomieLevel(level));
//   await mic.start();  mic.stop();  mic.on
//
// The iOS session is PlayAndRecord in VoiceChat mode, and DefaultToSpeaker keeps playback off the
// earpiece. VoiceChat alone does NOT cancel echo: Apple only does that with voice processing (the
// VPIO audio unit), which audio-studio 3.2.1 never turns on. What keeps the cook's clip and homie's
// voice out of what the kid "said" is half duplex: the caller sends the voice service no mic frames
// while a say or clip plays (lib/homie/hooks useAiSpeaking), and the service ignores audio while it
// speaks. Never stop the recorder for it; just don't send.
// `onLevel` (optional) gets each chunk's loudness, 0..1 (lib/homie/logic pcmLevel), for homie's steam.
// In Expo Go the native module isn't there: the module is never loaded and start() says 'error'.
import type * as Studio from '@siteed/audio-studio';
import Constants, { ExecutionEnvironment } from 'expo-constants';
import { requestRecordingPermissionsAsync } from 'expo-audio';
import { useCallback, useEffect, useRef, useState } from 'react';
import { Platform } from 'react-native';

import { pcmLevel } from '@/lib/homie/logic';

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

export function micStreamingSupported(): boolean {
  return Platform.OS !== 'web' && !!studio;
}

export function useMicStream(onChunk: (pcm: ArrayBuffer) => void, onLevel?: (level: number) => void) {
  const rec = useRecorder();
  const [on, setOn] = useState(false);
  const sink = useRef(onChunk);
  const levelSink = useRef(onLevel);
  useEffect(() => {
    sink.current = onChunk;
    levelSink.current = onLevel;
  });

  const start = useCallback(async (): Promise<'ok' | 'denied' | 'error'> => {
    if (!rec || !micStreamingSupported()) return 'error';
    const perm = await requestRecordingPermissionsAsync().catch(() => null);
    if (!perm?.granted) return 'denied';
    try {
      await rec.startRecording({
        sampleRate: MIC_SAMPLE_RATE,
        channels: 1,
        encoding: 'pcm_16bit',
        interval: 100,
        keepFullAnalysis: false,
        output: { primary: { enabled: false } },
        ios: { audioSession: { category: 'PlayAndRecord', mode: 'VoiceChat', categoryOptions: ['DefaultToSpeaker', 'AllowBluetooth', 'MixWithOthers'] } },
        onAudioStream: async (e) => {
          const pcm = typeof e.data === 'string' ? decode(e.data) : e.data instanceof Int16Array ? e.data.slice().buffer : null;
          if (!pcm) return;
          sink.current(pcm);
          levelSink.current?.(pcmLevel(pcm));
        },
      });
      setOn(true);
      return 'ok';
    } catch (e) {
      console.warn('[mic] could not start', String(e));
      return 'error';
    }
  }, [rec]);

  const stop = useCallback(() => {
    setOn(false);
    void rec?.stopRecording().catch(() => {});
  }, [rec]);

  // Leaving the screen never leaves the microphone on.
  const recRef = useRef(rec);
  useEffect(() => {
    recRef.current = rec;
  });
  useEffect(() => () => void recRef.current?.stopRecording().catch(() => {}), []);

  return { on, start, stop };
}
