// The in-app camera for a phone recording (react-native-vision-camera 4.7, docs/agents/memory/in-app-recording.md).
// Native only, and only in a build made with it (EAS dev or TestFlight after Oct 24): Expo Go, the web and an
// older build get null, and the recording screen keeps the system camera (components/record/pick).
//
//   const vc = visionCamera();   vc?.Camera, vc?.useCameraDevice ...   inAppCameraSupported()
//
// Why VisionCamera 4 and not expo-camera or VisionCamera 5: homie's mic (lib/live/mic, @siteed/audio-studio)
// and the camera's own audio share iOS's one audio session. VisionCamera 4 records sound through its own
// audio capture session with `automaticallyConfiguresApplicationAudioSession = false`, and sets the session
// to PlayAndRecord / VideoRecording / [MixWithOthers, AllowBluetoothA2DP, DefaultToSpeaker, AllowAirPlay]
// (only when it differs). expo-camera 57 and VisionCamera 5 let AVCaptureSession reconfigure the session
// itself, which can stop the mic stream and send homie's voice to the earpiece. The mic uses the same
// settings while the camera is up (CAMERA_AUDIO_SESSION), so the camera never changes anything.
import type * as VisionCamera from 'react-native-vision-camera';
import Constants, { ExecutionEnvironment } from 'expo-constants';
import { NativeModules, Platform } from 'react-native';

/** The audio session VisionCamera 4 sets when it records with sound (CameraSession+Audio.swift). */
export const CAMERA_AUDIO_SESSION = {
  category: 'PlayAndRecord',
  mode: 'VideoRecording',
  categoryOptions: ['MixWithOthers', 'AllowBluetoothA2DP', 'DefaultToSpeaker', 'AllowAirPlay'],
} as const;

let loaded: typeof VisionCamera | null | undefined;

export function visionCamera(): typeof VisionCamera | null {
  if (loaded !== undefined) return loaded;
  loaded = null;
  // The JS module throws at import when its native half isn't in this build.
  if (Platform.OS === 'web' || Constants.executionEnvironment === ExecutionEnvironment.StoreClient || !NativeModules.CameraView) return loaded;
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports -- loaded only where the native module exists
    loaded = require('react-native-vision-camera') as typeof VisionCamera;
  } catch (e) {
    console.warn('[camera] VisionCamera did not load', String(e).slice(0, 160));
  }
  return loaded;
}

export function inAppCameraSupported(): boolean {
  return !!visionCamera();
}
