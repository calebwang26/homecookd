// Getting videos onto the Send screen: the camera ("Start recording") or the camera roll ("Use
// videos I already took"). Both return draft clips, or a sentence to show when it didn't work.
import { getRecordingPermissionsAsync, requestRecordingPermissionsAsync } from 'expo-audio';
import * as ImagePicker from 'expo-image-picker';
import { Linking, Platform } from 'react-native';

import { MAX_RECORDING_HOURS } from '@/lib/uploads';

import { clipKeyFor, type DraftClip } from './draft';

const SELECTION_LIMIT = 20;

export type PickResult =
  | { ok: true; clips: DraftClip[]; note?: string }
  | { ok: false; cancelled: true }
  | { ok: false; cancelled?: false; error: string; settings?: boolean; need?: 'camera' | 'microphone' };

/** Uploads (and the camera) only work in the app on a phone. */
export const phoneOnly = Platform.OS === 'web';

export function openSettings() {
  Linking.openSettings().catch(() => {});
}

function isVideo(a: ImagePicker.ImagePickerAsset) {
  return a.type !== 'image' && a.type !== 'livePhoto' && a.type !== 'pairedVideo';
}

/** Opens the camera in video mode. One recording per call. */
export async function recordWithCamera(): Promise<PickResult> {
  try {
    const perm = await ImagePicker.requestCameraPermissionsAsync();
    if (!perm.granted) {
      return {
        ok: false,
        error: 'homecookd needs the camera. Turn it on in Settings.',
        settings: !perm.canAskAgain,
        need: 'camera',
      };
    }
    // iOS records video with no sound when the mic was turned off (say, declined for a hello note),
    // and the recipe needs the cook's voice. Ask here, not an hour later from the worker.
    let mic = await getRecordingPermissionsAsync();
    if (!mic.granted && mic.canAskAgain) mic = await requestRecordingPermissionsAsync();
    if (!mic.granted) {
      return {
        ok: false,
        error: 'homecookd needs the microphone. Turn it on in Settings.',
        settings: !mic.canAskAgain,
        need: 'microphone',
      };
    }
    const startedAt = Date.now();
    const result = await ImagePicker.launchCameraAsync({
      mediaTypes: ['videos'],
      // UIKit stops at 10 minutes unless told otherwise; a long braise needs more.
      videoMaxDuration: MAX_RECORDING_HOURS * 3600,
      videoQuality: ImagePicker.UIImagePickerControllerQualityType.High,
      cameraType: ImagePicker.CameraType.back,
    });
    if (result.canceled) return { ok: false, cancelled: true };
    const clips = result.assets.filter(isVideo).map<DraftClip>((asset) => {
      const lengthMs = asset.duration ?? 0; // ms
      // The recording started `duration` before the camera handed it back (never before we opened it).
      const started = Math.max(startedAt, Date.now() - lengthMs);
      return { key: clipKeyFor(asset), asset, source: 'camera', recordedAt: new Date(started).toISOString(), selected: true };
    });
    if (clips.length === 0) return { ok: false, error: "That didn't record a video. Try again." };
    return { ok: true, clips };
  } catch (e) {
    return { ok: false, error: `The camera didn't open. ${e instanceof Error ? e.message : ''}`.trim() };
  }
}

/** Opens the camera roll for videos, in the order they were picked. */
export async function pickFromLibrary(): Promise<PickResult> {
  try {
    const result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ['videos'],
      allowsMultipleSelection: true,
      orderedSelection: true,
      selectionLimit: SELECTION_LIMIT,
      // Hand over the original file; never re-encode an hour of video on the phone.
      videoExportPreset: ImagePicker.VideoExportPreset.Passthrough,
      preferredAssetRepresentationMode: ImagePicker.UIImagePickerPreferredAssetRepresentationMode.Current,
      shouldDownloadFromNetwork: true, // videos kept in iCloud
    });
    if (result.canceled) return { ok: false, cancelled: true };
    const videos = result.assets.filter(isVideo);
    if (videos.length === 0) return { ok: false, error: 'Pick videos, not photos.' };
    const clips = videos.map<DraftClip>((asset) => ({
      key: clipKeyFor(asset),
      asset,
      source: 'library',
      recordedAt: null,
      selected: true,
    }));
    return { ok: true, clips, note: videos.length < result.assets.length ? 'We kept only the videos.' : undefined };
  } catch (e) {
    return { ok: false, error: `We couldn't open your videos. ${e instanceof Error ? e.message : ''}`.trim() };
  }
}
