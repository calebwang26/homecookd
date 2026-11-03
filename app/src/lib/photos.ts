// A photo of the dish someone made (the postcard after "I made it", retention PR 3):
//
//   const r = await takePhoto();          // the camera, or choosePhoto() for the photo library
//   if (r.ok) const path = await uploadPhoto(r.photo);
//   -> api.postcard(cookedMessageId, { photo_path: path, rating })
//      (or sendPostcard() in lib/messaging, which does the upload and the post)
//
// Photos go into the private `photos` bucket through a signed upload URL (POST /photo-upload), like
// voice notes; messages carry a fresh 1-hour signed `photo_url`. Pictures are taken or picked as a
// compressed JPEG so they stay well under the bucket's 10 MB.
import { File, UploadType } from 'expo-file-system';
import * as ImagePicker from 'expo-image-picker';
import { Linking, Platform } from 'react-native';

import { api, ApiError } from './api';
import { AWS_ON } from './aws/config';
import { sendAwsFile } from './aws/sendFile';

export type Photo = { uri: string; mimeType: string };

export type PhotoResult =
  | { ok: true; photo: Photo }
  | { ok: false; cancelled: true }
  | { ok: false; cancelled?: false; error: string; settings?: boolean };

const QUALITY = 0.7;

export function openPhotoSettings() {
  Linking.openSettings().catch(() => {});
}

function photoOf(asset: ImagePicker.ImagePickerAsset): Photo {
  const type = (asset.mimeType ?? '').toLowerCase();
  return { uri: asset.uri, mimeType: type.startsWith('image/') ? type : 'image/jpeg' };
}

/** Opens the camera for one photo. */
export async function takePhoto(): Promise<PhotoResult> {
  try {
    const perm = await ImagePicker.requestCameraPermissionsAsync();
    if (!perm.granted) {
      return { ok: false, error: 'homecookd needs the camera. Turn it on in Settings.', settings: !perm.canAskAgain };
    }
    const r = await ImagePicker.launchCameraAsync({ mediaTypes: ['images'], quality: QUALITY, cameraType: ImagePicker.CameraType.back });
    if (r.canceled || !r.assets?.length) return { ok: false, cancelled: true };
    return { ok: true, photo: photoOf(r.assets[0]) };
  } catch (e) {
    return { ok: false, error: `The camera didn't open. ${e instanceof Error ? e.message : ''}`.trim() };
  }
}

/** Opens the photo library for one photo (HEIC comes back as a JPEG). */
export async function choosePhoto(): Promise<PhotoResult> {
  try {
    const r = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ['images'],
      quality: QUALITY,
      preferredAssetRepresentationMode: ImagePicker.UIImagePickerPreferredAssetRepresentationMode.Compatible,
    });
    if (r.canceled || !r.assets?.length) return { ok: false, cancelled: true };
    return { ok: true, photo: photoOf(r.assets[0]) };
  } catch (e) {
    return { ok: false, error: `We couldn't open your photos. ${e instanceof Error ? e.message : ''}`.trim() };
  }
}

const TOO_BIG = 'That photo is too big to send. Try another.';
const DIDNT_UPLOAD = 'The photo didn’t upload. Try again.';
const WRONG_KIND = 'That kind of picture can’t be sent. Try another photo.';
/** What POST /photo-upload (and the photos bucket) takes; anything else (a GIF) is a 400. */
const SENDABLE = new Set(['image/jpeg', 'image/jpg', 'image/png', 'image/heic', 'image/webp']);

function sendableType(type: string): string {
  const t = type.toLowerCase();
  if (!SENDABLE.has(t)) throw new ApiError(WRONG_KIND, 415, 'http');
  return t;
}

/** Uploads a photo to the private photos bucket. Returns its storage path for a postcard (or a `cooked` message). */
export async function uploadPhoto(photo: Photo): Promise<string> {
  // 1.1: the AWS api's upload (link, PUT, confirm); the key goes where the path went.
  if (AWS_ON) return sendAwsFile('photo', sendableType(photo.mimeType || 'image/jpeg'), photo.uri);
  if (Platform.OS === 'web') {
    const blob = await (await fetch(photo.uri)).blob();
    const up = await api.photoUpload(sendableType(blob.type || photo.mimeType));
    if (blob.size > up.max_bytes) throw new ApiError(TOO_BIG, 413, 'http');
    const res = await fetch(up.upload_url, { method: 'PUT', headers: up.headers, body: blob });
    if (!res.ok) throw new ApiError(DIDNT_UPLOAD, res.status, 'http');
    return up.path;
  }
  const file = new File(photo.uri);
  // iOS closes the app on an upload task for a file that isn't there (lib/uploads fileOnPhone).
  if (!file.exists) throw new Error('That photo isn’t on this phone any more.');
  const up = await api.photoUpload(sendableType(photo.mimeType));
  if (file.size > up.max_bytes) throw new ApiError(TOO_BIG, 413, 'http');
  let lastStatus = 0;
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const result = await file
        .createUploadTask(up.upload_url, { httpMethod: 'PUT', headers: up.headers, uploadType: UploadType.BINARY_CONTENT })
        .uploadAsync();
      lastStatus = result.status;
      if (result.status >= 200 && result.status < 300) return up.path;
      if (result.status < 500) break;
    } catch {
      lastStatus = 0;
    }
  }
  throw new ApiError(
    lastStatus ? DIDNT_UPLOAD : "Can't reach homecookd right now. Check your connection.",
    lastStatus,
    lastStatus ? 'http' : 'network',
  );
}
