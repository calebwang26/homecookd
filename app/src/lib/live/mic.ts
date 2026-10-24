// The kid's microphone while voice cooking: 16 kHz mono 16-bit PCM in ~100 ms chunks, handed to
// `onChunk` as ArrayBuffers for the voice service's WebSocket (docs/build/STACK.md "App ↔ voice
// service"). Native only (@siteed/audio-studio needs a dev build, not Expo Go); nothing is saved.
//
//   const mic = useMicStream((pcm) => socket.send(pcm));
//   await mic.start();  mic.stop();  mic.on
//
// The iOS session is PlayAndRecord in VoiceChat mode: echo cancellation keeps the cook's clip and
// the AI voice out of what the kid "said", and DefaultToSpeaker keeps playback off the earpiece.
// In Expo Go the native module isn't there: the module is never loaded and start() says 'error'.
import type * as Studio from '@siteed/audio-studio';
import Constants, { ExecutionEnvironment } from 'expo-constants';
import { requestRecordingPermissionsAsync } from 'expo-audio';
import { useCallback, useEffect, useRef, useState } from 'react';
import { Platform } from 'react-native';

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

export function useMicStream(onChunk: (pcm: ArrayBuffer) => void) {
  const rec = useRecorder();
  const [on, setOn] = useState(false);
  const sink = useRef(onChunk);
  useEffect(() => {
    sink.current = onChunk;
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
          if (typeof e.data === 'string') sink.current(decode(e.data));
          else if (e.data instanceof Int16Array) sink.current(e.data.slice().buffer);
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
