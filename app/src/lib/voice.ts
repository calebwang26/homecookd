// Voice notes: record (expo-audio, m4a on the phone / webm in a browser), upload to the private
// voice bucket through a signed URL, and play back with progress.
//
//   const rec = useVoiceRecorder();
//   await rec.start();               // asks for the microphone the first time
//   rec.elapsed, rec.level           // seconds so far, 0..1 input level (for a live waveform)
//   const note = await rec.stop();   // { uri, duration_s, contentType } | null (too short / failed)
//   const { path, duration_s } = await uploadVoice(note);
//   -> api.sendMessage(threadId, { kind: 'voice', audio_path: path, duration_s })
//      (or useThread(id).sendVoice(note), which does all of this with an optimistic bubble)
//
//   const v = useVoicePlayback(message); v.toggle(); v.progress; v.elapsed; v.duration
//
// On the web, recording uses the browser's MediaRecorder when it exists; otherwise `supported` is
// false and screens should say "Recording works in the homecookd app".
import {
  AudioQuality,
  IOSOutputFormat,
  requestRecordingPermissionsAsync,
  setAudioModeAsync,
  useAudioRecorder,
  useAudioRecorderState,
  type RecordingOptions,
} from 'expo-audio';
import { File, UploadType } from 'expo-file-system';
import { useCallback, useEffect, useRef, useState } from 'react';
import { Linking, Platform } from 'react-native';

import { api, ApiError, type Message } from './api';
import { useClipAudio, type ClipAudio } from './media';

/** The server's limit (API.md: voice <= 5 min). Recording stops itself here. */
export const MAX_VOICE_S = 300;
/** Shorter than this is treated as an accidental tap. */
export const MIN_VOICE_S = 0.8;

export const MIC_DENIED_MESSAGE = 'homecookd needs the microphone. Turn it on in Settings.';
export const WEB_UNSUPPORTED_MESSAGE = 'Recording works in the homecookd app on your phone.';

const VOICE_OPTIONS: RecordingOptions = {
  extension: '.m4a',
  sampleRate: 44100,
  numberOfChannels: 1,
  bitRate: 64000,
  isMeteringEnabled: true,
  android: { outputFormat: 'mpeg4', audioEncoder: 'aac' },
  ios: {
    outputFormat: IOSOutputFormat.MPEG4AAC,
    audioQuality: AudioQuality.HIGH,
    linearPCMBitDepth: 16,
    linearPCMIsBigEndian: false,
    linearPCMIsFloat: false,
  },
  web: { mimeType: 'audio/webm', bitsPerSecond: 64000 },
};

export type VoiceRecording = {
  uri: string;
  duration_s: number;
  contentType: string;
};

export type RecorderPhase = 'idle' | 'requesting' | 'recording' | 'stopping' | 'denied' | 'unsupported' | 'error';

export function recordingSupported(): boolean {
  if (Platform.OS !== 'web') return true;
  const g = globalThis as { MediaRecorder?: unknown; navigator?: { mediaDevices?: { getUserMedia?: unknown } } };
  return typeof g.MediaRecorder === 'function' && typeof g.navigator?.mediaDevices?.getUserMedia === 'function';
}

/** Opens the system settings so someone can allow the microphone. */
export function openMicSettings() {
  Linking.openSettings().catch(() => {});
}

export function useVoiceRecorder(opts: { maxSeconds?: number; onAutoStop?: (rec: VoiceRecording | null) => void } = {}) {
  const max = Math.min(opts.maxSeconds ?? MAX_VOICE_S, MAX_VOICE_S);
  const supported = recordingSupported();
  const recorder = useAudioRecorder(VOICE_OPTIONS);
  const status = useAudioRecorderState(recorder, 100);
  const [phase, setPhase] = useState<RecorderPhase>(supported ? 'idle' : 'unsupported');
  const [error, setError] = useState<string | null>(supported ? null : WEB_UNSUPPORTED_MESSAGE);
  const startedAt = useRef(0);
  const autoStop = useRef(opts.onAutoStop);
  useEffect(() => {
    autoStop.current = opts.onAutoStop;
  });

  const elapsed = phase === 'recording' ? Math.max(status.durationMillis / 1000, 0) : 0;
  // Metering is dBFS (about -60 quiet .. 0 loud). Map to 0..1.
  const level = phase === 'recording' && typeof status.metering === 'number' ? Math.max(0, Math.min(1, (status.metering + 60) / 60)) : 0;

  const start = useCallback(async (): Promise<boolean> => {
    if (!supported) {
      setPhase('unsupported');
      setError(WEB_UNSUPPORTED_MESSAGE);
      return false;
    }
    setPhase('requesting');
    setError(null);
    try {
      const perm = await requestRecordingPermissionsAsync();
      if (!perm.granted) {
        setPhase('denied');
        setError(MIC_DENIED_MESSAGE);
        return false;
      }
      await setAudioModeAsync({ allowsRecording: true, playsInSilentMode: true }).catch(() => {});
      await recorder.prepareToRecordAsync();
      recorder.record();
      startedAt.current = Date.now();
      setPhase('recording');
      return true;
    } catch {
      setPhase('error');
      setError('The microphone didn’t start. Try again.');
      await setAudioModeAsync({ allowsRecording: false, playsInSilentMode: true }).catch(() => {});
      return false;
    }
  }, [recorder, supported]);

  const finish = useCallback(async (): Promise<VoiceRecording | null> => {
    if (phase !== 'recording') return null;
    setPhase('stopping');
    const wall = (Date.now() - startedAt.current) / 1000;
    try {
      await recorder.stop();
    } catch {
      // fall through: uri may still be set
    }
    await setAudioModeAsync({ allowsRecording: false, playsInSilentMode: true }).catch(() => {});
    const uri = recorder.uri;
    const measured = recorder.currentTime || status.durationMillis / 1000;
    const duration = Math.min(max, Math.round((measured > 0 ? measured : wall) * 10) / 10);
    setPhase('idle');
    if (!uri || duration < MIN_VOICE_S) return null;
    return { uri, duration_s: duration, contentType: Platform.OS === 'web' ? 'audio/webm' : 'audio/m4a' };
  }, [phase, recorder, status.durationMillis, max]);

  const cancel = useCallback(async () => {
    if (phase !== 'recording') return;
    try {
      await recorder.stop();
    } catch {
      // ignore
    }
    await setAudioModeAsync({ allowsRecording: false, playsInSilentMode: true }).catch(() => {});
    setPhase('idle');
  }, [phase, recorder]);

  // Unmounted mid-recording: stop the mic and give the audio session back to playback.
  const phaseRef = useRef(phase);
  useEffect(() => {
    phaseRef.current = phase;
  }, [phase]);
  useEffect(
    () => () => {
      if (phaseRef.current !== 'recording') return;
      try {
        void Promise.resolve(recorder.stop()).catch(() => {});
      } catch {
        // already released
      }
      void setAudioModeAsync({ allowsRecording: false, playsInSilentMode: true }).catch(() => {});
    },
    [recorder],
  );

  // Stop at the server's limit.
  useEffect(() => {
    if (phase !== 'recording' || elapsed < max) return;
    const t = setTimeout(() => void finish().then((r) => autoStop.current?.(r)), 0);
    return () => clearTimeout(t);
  }, [phase, elapsed, max, finish]);

  return {
    phase,
    recording: phase === 'recording',
    supported,
    elapsed,
    level,
    maxSeconds: max,
    error,
    start,
    stop: finish,
    cancel,
  };
}

export type VoiceRecorder = ReturnType<typeof useVoiceRecorder>;

/** Uploads a recording to the private voice bucket. Returns the storage path for a `voice` message. */
export async function uploadVoice(rec: VoiceRecording): Promise<{ path: string; duration_s: number }> {
  if (Platform.OS === 'web') {
    const blob = await (await fetch(rec.uri)).blob();
    const type = (blob.type || rec.contentType || 'audio/webm').split(';')[0].trim() || 'audio/webm';
    const up = await api.voiceUpload(type);
    if (blob.size > up.max_bytes) throw new ApiError('That voice note is too long to send.', 413, 'http');
    const res = await fetch(up.upload_url, { method: 'PUT', headers: up.headers, body: blob });
    if (!res.ok) throw new ApiError('The voice note didn’t upload. Try again.', res.status, 'http');
    return { path: up.path, duration_s: rec.duration_s };
  }
  const file = new File(rec.uri);
  // iOS closes the app on an upload task for a file that isn't there (lib/uploads fileOnPhone).
  if (!file.exists) throw new Error('That voice note isn’t on this phone any more.');
  const up = await api.voiceUpload(rec.contentType || 'audio/m4a');
  if (file.size > up.max_bytes) throw new ApiError('That voice note is too long to send.', 413, 'http');
  let lastStatus = 0;
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const result = await file
        .createUploadTask(up.upload_url, { httpMethod: 'PUT', headers: up.headers, uploadType: UploadType.BINARY_CONTENT })
        .uploadAsync();
      lastStatus = result.status;
      if (result.status >= 200 && result.status < 300) return { path: up.path, duration_s: rec.duration_s };
      if (result.status < 500) break;
    } catch {
      lastStatus = 0;
    }
  }
  throw new ApiError(
    lastStatus ? 'The voice note didn’t upload. Try again.' : "Can't reach homecookd right now. Check your connection.",
    lastStatus,
    lastStatus ? 'http' : 'network',
  );
}

/** Playback for a voice message (or any message with an audio clip), on the shared player. */
export function useVoicePlayback(
  msg: Pick<Message, 'id' | 'audio_url' | 'duration_s' | 'clip_start_s' | 'clip_end_s'> | null,
): ClipAudio & { total: number } {
  const clip = msg?.audio_url
    ? {
        url: msg.audio_url,
        start_s: msg.clip_start_s ?? 0,
        end_s: msg.clip_end_s ?? null,
        key: `msg:${msg.id}`,
      }
    : null;
  const a = useClipAudio(clip, { stopOnUnmount: false });
  // Prefer the stored length: browser recordings (webm) often report no duration at all.
  const clipLen = msg?.clip_end_s != null && msg.clip_start_s != null ? msg.clip_end_s - msg.clip_start_s : 0;
  const total = clipLen > 0 ? clipLen : Number(msg?.duration_s) || (Number.isFinite(a.duration) ? a.duration : 0);
  const progress = total > 0 ? Math.min(1, a.elapsed / total) : 0;
  return { ...a, duration: total, total, progress: a.phase === 'ended' ? 1 : progress };
}
