// Before recording starts (Record's "Start recording"): the dish (typed, optional), who it's for (each
// kid a toggle, "Everyone" ticks them all: who.ts; the kid who asked starts ticked, else the first
// kid, else Everyone), the language she cooks in (from people.me; a
// change also becomes her account's language), then how she films: From my glasses (homie listens on
// the phone by the stove), Phone camera (homie says hello first, then the phone's camera), or Videos
// I took (the camera roll, as before).
import { useState } from 'react';
import { ScrollView, StyleSheet, TextInput, View } from 'react-native';
import Animated, { FadeIn } from 'react-native-reanimated';
import Svg, { Circle, Path } from 'react-native-svg';

import { ActionButton, Avatar, BottomSheet, Chip, PressableScale, RecordDotIcon, Txt, VideoIcon } from '@/components/ui';
import type { Profile } from '@/lib/api';
import { useMe } from '@/lib/live/convex';
import { useWords } from '@/lib/words/useWords';
import { useSession } from '@/lib/session';
import { colors, fonts, shadows, space } from '@/theme/tokens';

import { LanguagePicker, languageLabel, LANGUAGE_QUESTION } from './LanguagePicker';
import { firstWho, showEveryone, toggleEveryone, toggleKid, whoTo, type Who } from './who';

export type CaptureSource = 'glasses' | 'camera' | 'library';
/**
 * `language` is null until she picked one or people.me loaded: the server then uses her saved
 * language (an explicit 'en' would beat it). `kids`: the ticked kids; `everyone`: every kid ticked
 * (or "Everyone" with no kids); `label`: "Leo & Zoe", "everyone" or null; `who`: the ticks.
 */
export type PreRecordChoice = { source: CaptureSource; dish: string; kids: Profile[]; everyone: boolean; label: string | null; who: Who; language: string | null };

const MAX_DISH = 120;

function GlassesIcon({ size = 24, color = colors.card }: { size?: number; color?: string }) {
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth={2} strokeLinecap="round">
      <Circle cx="6.5" cy="14" r="3.5" />
      <Circle cx="17.5" cy="14" r="3.5" />
      <Path d="M10 13.5q2-1.5 4 0M3 13l1.5-5M21 13l-1.5-5" />
    </Svg>
  );
}

export function PreRecordSheet({
  visible,
  onClose,
  initialDish,
  requestFrom,
  busy,
  onStart,
}: {
  visible: boolean;
  onClose: () => void;
  initialDish: string | null;
  /** The kid who asked for this dish (a profile id), picked first. */
  requestFrom: string | null;
  busy: CaptureSource | null;
  onStart: (choice: PreRecordChoice) => void;
}) {
  const { me, profiles, learners } = useSession();
  const convexMe = useMe(visible);
  const [dish, setDish] = useState<string | null>(null);
  const [who, setWho] = useState<Who | null>(null);
  const [picked, setPicked] = useState<string | null>(null);
  const [choosingLanguage, setChoosingLanguage] = useState(false);
  const { t, choose } = useWords();

  const others = profiles.filter((p) => p.id !== me?.id);
  const people = learners.filter((p) => p.id !== me?.id);
  const whoNow = who ?? firstWho(people, others, { requestFrom });
  const to = whoTo(whoNow, people, others);
  const language = picked ?? convexMe?.language ?? null;
  const dishNow = dish ?? initialDish ?? '';

  const pickLanguage = (code: string) => {
    setPicked(code);
    setChoosingLanguage(false);
    // Her language everywhere: homie, this recording and the app's words.
    if (code !== convexMe?.language) void choose(code).catch((e) => console.warn('[record] setLanguage', String(e)));
  };

  const start = (source: CaptureSource) => {
    if (busy) return;
    onStart({ source, dish: dishNow.trim().slice(0, MAX_DISH), kids: to.picked, everyone: to.everyone, label: to.label, who: whoNow, language });
  };

  const close = () => {
    setChoosingLanguage(false);
    onClose();
  };

  return (
    <BottomSheet visible={visible} onClose={close} accessibilityLabel={t('parent.preRecord.label')} maxHeightRatio={0.92}>
      {choosingLanguage ? (
        <Animated.View key="language" entering={FadeIn.duration(180)} style={styles.col}>
          <Txt variant="display" size={28} leading={1.1} accessibilityRole="header" style={styles.title}>
            {LANGUAGE_QUESTION}
          </Txt>
          <ScrollView style={styles.languages} keyboardShouldPersistTaps="handled" showsVerticalScrollIndicator={false}>
            <LanguagePicker value={language ?? 'en'} onChange={pickLanguage} onSheet />
          </ScrollView>
        </Animated.View>
      ) : (
        <Animated.View key="main" entering={FadeIn.duration(180)} style={styles.col}>
          <Txt variant="display" size={28} leading={1.1} accessibilityRole="header" style={styles.title}>
            {t('parent.preRecord.title')}
          </Txt>
          <View style={styles.field}>
            <TextInput
              value={dishNow}
              onChangeText={setDish}
              placeholder={t('parent.preRecord.dishPlaceholder')}
              placeholderTextColor={colors.muted}
              style={styles.input}
              autoCapitalize="sentences"
              returnKeyType="done"
              maxLength={MAX_DISH}
              accessibilityLabel={t('parent.dish.nameLabel')}
            />
          </View>

          {others.length > 0 ? (
            <View style={styles.section}>
              <Txt variant="title" size={17} weight={700} accessibilityRole="header">
                {t('parent.forWho.title')}
              </Txt>
              <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.peopleScroll} contentContainerStyle={styles.people}>
                {people.map((p) => (
                  <Chip
                    key={p.id}
                    size="lg"
                    selectedTone="ink"
                    label={p.name}
                    selected={whoNow.includes(p.id)}
                    onPress={() => setWho(toggleKid(whoNow, p.id))}
                    leading={<Avatar profile={p} size={40} />}
                  />
                ))}
                {showEveryone(people, others) ? (
                  <Chip
                    size="lg"
                    selectedTone="ink"
                    label={t('parent.forWho.everyone')}
                    selected={to.everyone}
                    onPress={() => setWho(toggleEveryone(whoNow, people, others))}
                    accessibilityLabel={t('parent.forWho.everyoneLabel')}
                  />
                ) : null}
              </ScrollView>
            </View>
          ) : null}

          <PressableScale
            onPress={() => setChoosingLanguage(true)}
            scaleTo={0.98}
            accessibilityRole="button"
            accessibilityLabel={t('parent.preRecord.languageLabel', { language: languageLabel(language) })}
            style={styles.language}>
            <View style={styles.flex}>
              <Txt variant="meta" size={13}>
                {t('parent.preRecord.homieTalks')}
              </Txt>
              <Txt variant="label" size={17} weight={700} numberOfLines={1}>
                {languageLabel(language)}
              </Txt>
            </View>
            <Txt variant="label" size={15} weight={700} color={colors.greenDeep}>
              {t('parent.preRecord.change')}
            </Txt>
          </PressableScale>

          <View style={styles.ways}>
            <ActionButton
              label={t('parent.preRecord.glasses')}
              size="xl"
              labelWeight={700}
              icon={<GlassesIcon />}
              state={busy === 'glasses' ? 'loading' : 'idle'}
              disabled={!!busy && busy !== 'glasses'}
              onPress={() => start('glasses')}
              accessibilityHint={t('parent.preRecord.glassesHint')}
            />
            <ActionButton
              label={t('parent.preRecord.camera')}
              variant="outline"
              size="lg"
              labelWeight={700}
              icon={<RecordDotIcon size={16} color={colors.danger} />}
              state={busy === 'camera' ? 'loading' : 'idle'}
              disabled={!!busy && busy !== 'camera'}
              onPress={() => start('camera')}
              accessibilityHint={t('parent.preRecord.cameraHint')}
            />
            <ActionButton
              label={t('parent.preRecord.library')}
              variant="outline"
              size="lg"
              labelWeight={700}
              icon={<VideoIcon size={22} color={colors.ink} />}
              state={busy === 'library' ? 'loading' : 'idle'}
              disabled={!!busy && busy !== 'library'}
              onPress={() => start('library')}
              accessibilityHint={t('parent.preRecord.libraryHint')}
            />
          </View>
        </Animated.View>
      )}
    </BottomSheet>
  );
}

const styles = StyleSheet.create({
  col: { gap: 18 },
  flex: { flex: 1, minWidth: 0 },
  // Clear of the sheet's round close button.
  title: { paddingRight: 44 },
  field: {
    height: 56,
    borderRadius: 999,
    backgroundColor: colors.page,
    paddingHorizontal: 20,
    justifyContent: 'center',
  },
  input: { fontFamily: fonts.sansMedium, fontSize: 17, color: colors.ink, paddingVertical: 0, outlineStyle: 'none' } as object,
  section: { gap: 10 },
  peopleScroll: { marginHorizontal: -space.xxl, marginVertical: -4, overflow: 'visible' },
  people: { paddingHorizontal: space.xxl, gap: 10, paddingVertical: 4 },
  language: {
    minHeight: 60,
    paddingHorizontal: 18,
    paddingVertical: 8,
    borderRadius: 20,
    backgroundColor: colors.page,
    boxShadow: shadows.chip,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
  },
  ways: { gap: 12, marginTop: 4 },
  languages: { maxHeight: 440 },
});
