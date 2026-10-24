// Dev page for the Watch / Hear plumbing (not linked from the app). Exercises inline range video,
// the shared audio player, and the Watch / Hear sheet on a real recipe and a sample one.
import { router } from 'expo-router';
import { useState } from 'react';
import { ScrollView, StyleSheet, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { ClipVideo, HearCard, useMediaSheet } from '@/components/media';
import { ActionButton, BackPill, Txt } from '@/components/ui';
import { mmss } from '@/lib/format';
import { stepAudioClip, useNowPlaying } from '@/lib/media';
import { stepClip, useRecipe } from '@/lib/recipes';
import { useVoicePlayback, useVoiceRecorder, type VoiceRecording } from '@/lib/voice';
import { colors } from '@/theme/tokens';

export default function MediaDev() {
  const insets = useSafeAreaInsets();
  const media = useMediaSheet();
  const { recipe } = useRecipe('gordon-gnocchi');
  const { recipe: sample } = useRecipe('dad-sunday-chili');
  const now = useNowPlaying();
  const step = recipe?.steps[3] ?? null;
  const clip = step ? stepClip(step) : null;

  return (
    <ScrollView style={styles.root} contentContainerStyle={[styles.content, { paddingTop: insets.top + 16 }]}>
      <BackPill onPress={() => (router.canGoBack() ? router.back() : router.replace('/'))} />
      <Txt variant="display">Media plumbing</Txt>
      <Txt variant="meta" testID="engine">
        engine: {now.phase} {now.key ? `@ ${now.position.toFixed(1)}s` : ''}
      </Txt>
      {recipe && step && clip ? (
        <>
          <Txt variant="heading">
            Inline Watch · step {step.order} ({mmss(clip.start_s)}–{mmss(clip.end_s)})
          </Txt>
          <View testID="inline-video">
            <ClipVideo
              url={recipe.media.video_url}
              poster={step.image_url ?? recipe.media.poster_url}
              start_s={clip.start_s}
              end_s={clip.end_s}
              accessibilityLabel="Watch step 4"
            />
          </View>
          <Txt variant="heading">Hear card</Txt>
          <HearCard clip={stepAudioClip(recipe, step)} quote={step.quote} cookName={recipe.cook.name} />
          <ActionButton label="Open Watch sheet" variant="outline" onPress={() => media.watch({ recipe, step })} />
          <ActionButton label="Open Hear sheet" variant="outline" onPress={() => media.hear({ recipe, step })} />
          <ActionButton label="Watch whole video" variant="outline" onPress={() => media.watch({ recipe, whole: true })} />
        </>
      ) : (
        <Txt variant="meta">Loading…</Txt>
      )}
      <RecorderTest />
      {sample ? (
        <>
          <Txt variant="heading">Sample recipe (no media)</Txt>
          <ClipVideo url={sample.media.video_url} poster={sample.media.poster_url} start_s={0} end_s={10} height={180} />
          <ActionButton label="Sample: Watch sheet" variant="outline" onPress={() => media.watch({ recipe: sample, step: sample.steps[0] })} />
          <ActionButton label="Sample: Hear sheet" variant="outline" onPress={() => media.hear({ recipe: sample, step: sample.steps[0] })} />
        </>
      ) : null}
    </ScrollView>
  );
}

function RecorderTest() {
  const rec = useVoiceRecorder();
  const [note, setNote] = useState<VoiceRecording | null>(null);
  const play = useVoicePlayback(note ? { id: 'local', audio_url: note.uri, duration_s: note.duration_s, clip_start_s: null, clip_end_s: null } : null);
  return (
    <View style={{ gap: 12 }}>
      <Txt variant="heading">Voice recorder (local only, nothing is sent)</Txt>
      <Txt variant="meta" testID="rec-state">
        recorder: {rec.phase} {rec.recording ? mmss(rec.elapsed) : ''} {rec.error ?? ''} {note ? `note ${note.duration_s}s ${note.contentType}` : ''}
      </Txt>
      <ActionButton
        label={rec.recording ? 'Stop' : 'Record'}
        variant="ink"
        onPress={async () => {
          if (rec.recording) setNote(await rec.stop());
          else await rec.start();
        }}
      />
      {note ? (
        <ActionButton label={`${play.playing ? 'Pause' : 'Play'} · ${mmss(play.elapsed)} / ${mmss(play.total)}`} variant="outline" onPress={play.toggle} />
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.page },
  content: { paddingHorizontal: 24, paddingBottom: 80, gap: 16 },
});
