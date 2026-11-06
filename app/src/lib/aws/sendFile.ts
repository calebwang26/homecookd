// A voice note or a photo up to the AWS api (1.1, MESSAGES.md flow 4): checked first, a link for its exact type and
// size, one PUT of exactly those bytes with exactly its headers (within 2 minutes), then the confirm. The answer is
// the key a message, postcard, answer or hello carries. A key goes on one row only: upload again to send again.

import { File, UploadType } from 'expo-file-system';
import { Platform } from 'react-native';

import { checkUpload, messages, type UploadKind } from './messages';

const TRIES = 2;

export class FileNotSent extends Error {
  why: 'type' | 'size' | 'gone' | 'upload';
  constructor(why: FileNotSent['why']) {
    super(why === 'type' ? 'That kind of file can’t be sent.' : why === 'size' ? 'That’s too big to send.' : why === 'gone' ? 'That file isn’t on this phone any more.' : 'It didn’t upload. Try again.');
    this.why = why;
  }
}

/** The key for `uri` once it's on the api. `as`: who sends it (default: whoever is in). */
export async function sendAwsFile(kind: UploadKind, contentType: string, uri: string, as?: string | null): Promise<string> {
  const type = contentType.split(';')[0].trim().toLowerCase();
  let size: number;
  let blob: Blob | null = null;
  if (Platform.OS === 'web') {
    blob = await (await fetch(uri)).blob();
    size = blob.size;
  } else {
    const file = new File(uri);
    // iOS closes the app on an upload task for a file that isn't there (lib/uploads fileOnPhone).
    if (!file.exists) throw new FileNotSent('gone');
    size = file.size;
  }
  const problem = checkUpload(kind, type, size);
  if (problem) throw new FileNotSent(problem);
  for (let i = 0; i < TRIES; i++) {
    // A fresh link each try: it's good for 2 minutes only.
    const link = await messages.newFile(kind, type, size, as);
    let status = 0;
    try {
      if (blob) {
        status = (await fetch(link.uploadUrl, { method: 'PUT', headers: link.uploadHeaders, body: blob })).status;
      } else {
        status = (
          await new File(uri).createUploadTask(link.uploadUrl, { httpMethod: 'PUT', headers: link.uploadHeaders, uploadType: UploadType.BINARY_CONTENT }).uploadAsync()
        ).status;
      }
    } catch {
      status = 0;
    }
    if (status >= 200 && status < 300) {
      await messages.confirmFile(link.key, as);
      return link.key;
    }
    if (status >= 400 && status < 500 && status !== 403 && status !== 408 && status !== 429) break;
  }
  throw new FileNotSent('upload');
}
