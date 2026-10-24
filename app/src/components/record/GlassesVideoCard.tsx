// The newest glasses video, on Record: after "I'm done", the laptop builds the full video from its backup
// and saves it (glasses.videos). While it builds, "Your glasses video is on its way"; once it's there,
// "Save to Photos" downloads it and puts it straight in Photos (expo-media-library, asking once). A build
// without that native module (TestFlight build 3) gets the share sheet instead, where "Save Video" does it. Then she
// sends it like any video: Start recording → Videos I took (no job is made automatically). A saved one is
// remembered on this phone and the card goes away.
import { Directory, File, Paths } from 'expo-file-system';
import { requireOptionalNativeModule } from 'expo-modules-core';
import * as Sharing from 'expo-sharing';
import { useEffect, useState } from 'react';
import { ActivityIndicator, Platform, StyleSheet, View } from 'react-native';

import { ActionButton, Txt, useToast } from '@/components/ui';
import { useGlassesVideos, type GlassesVideo } from '@/lib/live/convex';
import { kvGetJson, kvSetJson } from '@/lib/storage';
import { colors, radii } from '@/theme/tokens';

const SAVED_KEY = 'glasses.savedVideos';

/** 'saved': it's in Photos. 'shared': the share sheet was shown (no Photos module in this build). */
async function saveToPhotos(v: GlassesVideo): Promise<'saved' | 'shared'> {
  const dir = new Directory(Paths.cache, 'glasses');
  if (!dir.exists) dir.create();
  const target = new File(dir, `${v.recordingId}.mp4`);
  if (target.exists) target.delete();
  const file = await File.downloadFileAsync(v.videoUrl!, target);
  // Only builds that include the native module can save directly; loading it elsewhere would crash.
  if (requireOptionalNativeModule('ExpoMediaLibrary')) {
    // eslint-disable-next-line @typescript-eslint/no-require-imports -- loaded only where the native module exists
    const MediaLibrary = require('expo-media-library/legacy') as typeof import('expo-media-library/legacy');
    const perm = await MediaLibrary.requestPermissionsAsync(true);
    if (!perm.granted) throw new Error('Photos access was not allowed. Turn it on in Settings > homecookd > Photos.');
    await MediaLibrary.saveToLibraryAsync(file.uri);
    return 'saved';
  }
  await Sharing.shareAsync(file.uri, { mimeType: 'video/mp4', UTI: 'public.mpeg-4', dialogTitle: 'Save your glasses video' });
  return 'shared';
}

export function GlassesVideoCard() {
  const videos = useGlassesVideos(Platform.OS !== 'web');
  const toast = useToast();
  const [saved, setSaved] = useState<string[] | null>(null);
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    void kvGetJson<string[]>(SAVED_KEY).then((ids) => setSaved(ids ?? []));
  }, []);

  const v = saved ? videos.find((x) => !saved.includes(x.recordingId)) : undefined;
  if (!v) return null;
  const name = v.dish ? `your ${v.dish} video` : 'your glasses video';

  const save = async () => {
    setBusy(true);
    try {
      const how = await saveToPhotos(v);
      const next = [...(saved ?? []), v.recordingId];
      setSaved(next);
      void kvSetJson(SAVED_KEY, next);
      toast.show(how === 'saved' ? 'Saved to Photos. Now Start recording → Videos I took' : 'Tap Save Video, then Start recording → Videos I took');
    } catch (e) {
      console.warn('[glasses] save to Photos', String(e).slice(0, 160));
      const msg = String((e as Error)?.message ?? e);
      toast.show(msg.includes('Photos access') ? msg : 'Couldn’t get the video. Check the connection and try again.', { tone: 'error' });
    } finally {
      setBusy(false);
    }
  };

  return (
    <View style={styles.card} accessible={!v.videoUrl} accessibilityLabel={v.videoUrl ? undefined : `${name} is on its way from the laptop`}>
      <Txt variant="label" size={17} weight={700} color={colors.ink}>
        {v.videoUrl ? `${name[0].toUpperCase()}${name.slice(1)} is ready` : `${name[0].toUpperCase()}${name.slice(1)} is on its way`}
      </Txt>
      {v.videoUrl ? (
        <>
          <Txt variant="meta" size={15} color={colors.muted}>
            Save it to Photos, then send it with Start recording → Videos I took.
          </Txt>
          <ActionButton label={busy ? 'Getting the video…' : 'Save to Photos'} size="lg" state={busy ? 'loading' : 'idle'} onPress={() => void save()} />
        </>
      ) : (
        <View style={styles.row}>
          <ActivityIndicator color={colors.muted} />
          <Txt variant="meta" size={15} color={colors.muted} style={styles.flex}>
            The laptop is putting the full video together. Keep it open; this takes a few minutes for a long cook.
          </Txt>
        </View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  card: { backgroundColor: colors.card, borderRadius: radii.panel, padding: 18, gap: 10 },
  row: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  flex: { flex: 1 },
});
