// One flow for "Start recording" / "Use videos I already took" (Record screen and Send's "Add more"):
// web -> the "Open homecookd on your phone" sheet; phone -> camera or camera roll -> clips in the draft.
// Problems become a toast (or an alert with a Settings button when a permission is off).
import { useCallback, useEffect, useRef, useState } from 'react';
import { Alert } from 'react-native';

import { useToast } from '@/components/ui';

import { addClips } from './draft';
import { openSettings, phoneOnly, pickFromLibrary, recordWithCamera, type PickResult } from './pick';

export type PickContext = { dish?: string | null; requestFrom?: string | null; glasses?: boolean };

// Once the camera or picker is up it covers the app, so a tap that reaches us this long after the
// last open means it never presented (iOS can refuse while another modal is still going away, and
// expo-image-picker's promise then never settles). Don't let that lock Record forever.
const STUCK_MS = 4000;

export function usePickVideos() {
  const toast = useToast();
  const [phoneSheet, setPhoneSheet] = useState(false);
  const [busy, setBusy] = useState<'camera' | 'library' | null>(null);
  const lock = useRef(0); // when the open camera / picker was asked for (0 = none)
  const run_ = useRef(0);
  const busyTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => () => void (busyTimer.current && clearTimeout(busyTimer.current)), []);

  const run = useCallback(
    async (kind: 'camera' | 'library', ctx: PickContext = {}): Promise<boolean> => {
      if (phoneOnly) {
        setPhoneSheet(true);
        return false;
      }
      if (lock.current && Date.now() - lock.current < STUCK_MS) return false;
      const id = ++run_.current;
      lock.current = Date.now();
      setBusy(kind);
      // The spinner is for the moment before the camera covers the screen; never leave it spinning.
      if (busyTimer.current) clearTimeout(busyTimer.current);
      busyTimer.current = setTimeout(() => run_.current === id && setBusy(null), STUCK_MS);
      let res: PickResult;
      try {
        res = kind === 'camera' ? await recordWithCamera() : await pickFromLibrary();
      } finally {
        if (run_.current === id) {
          lock.current = 0;
          setBusy(null);
        }
      }
      if (res.ok) {
        addClips(res.clips, ctx);
        if (res.note) toast.show(res.note, { tone: 'info' });
        return true;
      }
      if (!('error' in res)) return false; // cancelled
      if (res.settings) {
        Alert.alert(res.need === 'microphone' ? 'homecookd needs the microphone' : 'homecookd needs the camera', res.error, [
          { text: 'Not now', style: 'cancel' },
          { text: 'Open Settings', onPress: openSettings },
        ]);
      } else {
        toast.show(res.error, { tone: 'error', durationMs: 3200 });
      }
      return false;
    },
    [toast],
  );

  return {
    record: (ctx?: PickContext) => run('camera', ctx),
    library: (ctx?: PickContext) => run('library', ctx),
    busy,
    phoneSheet,
    closePhoneSheet: () => setPhoneSheet(false),
  };
}
