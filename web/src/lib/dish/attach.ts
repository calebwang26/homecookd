// What the kid adds from home, made ready for POST /dish/files (DISH-ASK-SPEC §4 Files): photos are
// redrawn at 1600 px as JPEG (at most 5 MB), a voice note goes as it is (at most 3 MB, the spec's
// audio types). Ported from the MVP's lib/miss/attach.ts. Errors carry a words key the page shows.
export class AttachError extends Error {
  constructor(public key: 'photoFailed' | 'voiceFailed' | 'voiceLong') {
    super(key);
  }
}

const MAX_SIDE = 1600;
const QUALITY = 0.82;
export const MAX_VOICE_BYTES = 3 * 1024 * 1024;

export async function photoToJpeg(file: Blob): Promise<Blob> {
  const url = URL.createObjectURL(file);
  const canvas = document.createElement('canvas');
  try {
    const img = new Image();
    await new Promise<void>((resolve, reject) => {
      img.onload = () => resolve();
      img.onerror = () => reject(new AttachError('photoFailed'));
      img.src = url;
    });
    const w = img.naturalWidth;
    const h = img.naturalHeight;
    if (!w || !h) throw new AttachError('photoFailed');
    const scale = Math.min(1, MAX_SIDE / Math.max(w, h));
    canvas.width = Math.max(1, Math.round(w * scale));
    canvas.height = Math.max(1, Math.round(h * scale));
    const ctx = canvas.getContext('2d');
    if (!ctx) throw new AttachError('photoFailed');
    ctx.fillStyle = '#ffffff'; // JPEG has no transparency
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
    const jpeg = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, 'image/jpeg', QUALITY));
    if (!jpeg) throw new AttachError('photoFailed');
    return jpeg;
  } finally {
    URL.revokeObjectURL(url);
    canvas.width = 0; // iOS caps the memory all canvases share
    canvas.height = 0;
  }
}

const AUDIO_TYPES: Record<string, string> = {
  'audio/mp4': 'audio/mp4',
  'audio/x-m4a': 'audio/x-m4a',
  'audio/m4a': 'audio/m4a',
  'audio/aac': 'audio/aac',
  'audio/mpeg': 'audio/mpeg',
  'audio/mp3': 'audio/mpeg',
  'audio/wav': 'audio/wav',
  'audio/x-wav': 'audio/wav',
  'audio/ogg': 'audio/ogg',
  'audio/webm': 'audio/webm',
};
const AUDIO_EXTENSIONS: Record<string, string> = { m4a: 'audio/mp4', mp4: 'audio/mp4', aac: 'audio/aac', mp3: 'audio/mpeg', wav: 'audio/wav', ogg: 'audio/ogg', opus: 'audio/ogg', webm: 'audio/webm' };

/** The type the server takes for this audio, or throws. */
export function voiceType(file: Blob & { name?: string }): string {
  if (file.size > MAX_VOICE_BYTES) throw new AttachError('voiceLong');
  const type = AUDIO_TYPES[file.type.split(';')[0].trim().toLowerCase()] ?? AUDIO_EXTENSIONS[file.name?.split('.').pop()?.toLowerCase() ?? ''];
  if (!file.size || !type) throw new AttachError('voiceFailed');
  return type;
}
