// The in-app camera for a phone recording (react-native-vision-camera 4.7, docs/agents/memory/in-app-recording.md).
// Native only, and only in a build made with it (EAS dev or TestFlight after Oct 24): Expo Go, the web and an
// older build get null, and the recording screen keeps the system camera (components/record/pick).
//
//   const vc = visionCamera();   vc?.Camera, vc?.useCameraDevice ...   inAppCameraSupported()
//   const m = imageManipulator(); m?.manipulateAsync(...)   (homie's small stills; null = send none)
// Neither package may be imported by value anywhere else: both load their native half at import, and a
// build without them (TestFlight build 4 and older) would crash on the Record screen after an EAS Update
// (app/scripts/test-recording-ui.mjs checks the whole app/src tree).
//
// Why VisionCamera 4 and not expo-camera or VisionCamera 5: homie's mic (lib/live/mic, @siteed/audio-studio)
// and the camera's own audio share iOS's one audio session. VisionCamera 4 records sound through its own
// audio capture session with `automaticallyConfiguresApplicationAudioSession = false`, and sets the session
// to PlayAndRecord / VideoRecording / [MixWithOthers, AllowBluetoothA2DP, DefaultToSpeaker, AllowAirPlay]
// (only when it differs). expo-camera 57 and VisionCamera 5 let AVCaptureSession reconfigure the session
// itself, which can stop the mic stream and send homie's voice to the earpiece. The mic uses the same
// settings while the camera is up (CAMERA_AUDIO_SESSION), so the camera never changes anything.
import type * as ImageManipulator from 'expo-image-manipulator';
import Constants, { ExecutionEnvironment } from 'expo-constants';
import { requireOptionalNativeModule } from 'expo-modules-core';
import type * as VisionCamera from 'react-native-vision-camera';
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

let manipulator: typeof ImageManipulator | null | undefined;

/** expo-image-manipulator, only where its native module is in this build. */
export function imageManipulator(): typeof ImageManipulator | null {
  if (manipulator !== undefined) return manipulator;
  manipulator = null;
  if (Platform.OS === 'web' || !requireOptionalNativeModule('ExpoImageManipulator')) return manipulator;
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports -- loaded only where the native module exists
    manipulator = require('expo-image-manipulator') as typeof ImageManipulator;
  } catch (e) {
    console.warn('[camera] the image manipulator did not load', String(e).slice(0, 160));
  }
  return manipulator;
}
