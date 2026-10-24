// The newest glasses video, on Record: after "I'm done", the laptop builds the full video from its backup
// and saves it (glasses.videos). While it builds, "Your glasses video is on its way"; once it's there,
// "Save to Photos" downloads it and opens the share sheet, where "Save Video" puts it in Photos. Then she
// sends it like any video: Start recording → Videos I took (no job is made automatically). A saved one is
// remembered on this phone and the card goes away.
import { Directory, File, Paths } from 'expo-file-system';
import * as Sharing from 'expo-sharing';
import { useEffect, useState } from 'react';
import { ActivityIndicator, Platform, StyleSheet, View } from 'react-native';

import { ActionButton, Txt, useToast } from '@/components/ui';
import { useGlassesVideos, type GlassesVideo } from '@/lib/live/convex';
import { kvGetJson, kvSetJson } from '@/lib/storage';
import { colors, radii } from '@/theme/tokens';

const SAVED_KEY = 'glasses.savedVideos';

async function saveToPhotos(v: GlassesVideo): Promise<void> {
  const dir = new Directory(Paths.cache, 'glasses');
  if (!dir.exists) dir.create();
  const target = new File(dir, `${v.recordingId}.mp4`);
  if (target.exists) target.delete();
  const file = await File.downloadFileAsync(v.videoUrl!, target);
  await Sharing.shareAsync(file.uri, { mimeType: 'video/mp4', UTI: 'public.mpeg-4', dialogTitle: 'Save your glasses video' });
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
      await saveToPhotos(v);
      const next = [...(saved ?? []), v.recordingId];
      setSaved(next);
      void kvSetJson(SAVED_KEY, next);
      toast.show('Now tap Start recording, then Videos I took');
    } catch (e) {
      console.warn('[glasses] save to Photos', String(e).slice(0, 160));
      toast.show('Couldn’t get the video. Check the connection and try again.', { tone: 'error' });
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
