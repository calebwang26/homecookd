// A kid's ask (/request/<askId>, Phase 5 screen 6, mockup Request): opened from Home's card (components/request/
// AskCard) and the push. A close button, "Caleb wants your" / "braised pork" big, his voice note when he sent
// one, his guess ("about 1 lb pork belly") and "Is Caleb close?", so she wants to correct it. Then two doors:
//   Film it next time you make it    the reminder sheet (components/request/ReminderSheet)
//   Tell Caleb how you make it now   the 2-minute voice recipe (/request/voice)
// Once a reminder is set, the first door becomes "We'll remind you Sunday" (a tap changes the day) and the second
// "Tell Caleb a quick version tonight", so a reminder never leaves him with nothing. When her voice recipe
// couldn't be heard (voiceRecipe 'failed'), the second door is "Tell Caleb again".
// Nothing here talks: homie's voice is off. Dev aid (web): /request/preview-craving?preview=craving.
import { router, useLocalSearchParams } from 'expo-router';
import { useEffect, useState } from 'react';
import { ActivityIndicator, ScrollView, StyleSheet, View } from 'react-native';
import Animated from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { ReminderSheet } from '@/components/request/ReminderSheet';
import { Avatar, CheckIcon, CloseIcon, IconButton, listEnter, MicIcon, PauseIcon, PlayIcon, PressableScale, ScreenWash, Txt } from '@/components/ui';
import { useAskReminder } from '@/lib/askReminders';
import { useCravingAsk, type CravingAsk } from '@/lib/cravings';
import { mmss } from '@/lib/format';
import { useClipAudio } from '@/lib/media';
import { dayName, everyLine } from '@/lib/reminders';
import { useWords } from '@/lib/words/useWords';
import { alpha, colors, radii, shadows, space } from '@/theme/tokens';

const MISSING_MS = 4000;

function goBack() {
  if (router.canGoBack()) router.back();
  else router.replace('/parent/home');
}


function openVoice(askId: string) {
  router.push({ pathname: '/request/voice', params: { ask: askId } });
}

export default function RequestScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const insets = useSafeAreaInsets();
  const { t } = useWords();
  const ask = useCravingAsk(id);
  const [missing, setMissing] = useState(false);
  useEffect(() => {
    if (ask) return;
    const timer = setTimeout(() => setMissing(true), MISSING_MS);
    return () => clearTimeout(timer);
  }, [ask]);

  return (
    <View style={styles.page}>
      <ScreenWash tone="parent" height={420} />
      <ScrollView
        bounces={false}
        showsVerticalScrollIndicator={false}
        contentContainerStyle={[styles.col, { paddingTop: Math.max(space.topDetail, insets.top + 4), paddingBottom: Math.max(space.xxxl, insets.bottom + 16) }]}>
        <IconButton icon={<CloseIcon size={18} color={colors.ink} />} accessibilityLabel={t('request.close')} onPress={goBack} size={44} />
        {ask ? (
          <Ask ask={ask} />
        ) : (
          <View style={styles.missing}>
            {missing ? (
              <Txt variant="title" size={18} align="center">
                {t('request.missing')}
              </Txt>
            ) : (
              <ActivityIndicator color={colors.green} />
            )}
          </View>
        )}
      </ScrollView>
    </View>
  );
}

function Ask({ ask }: { ask: CravingAsk }) {
  const { t } = useWords();
  const kid = ask.kidName.trim() || t('dish.yourKid');
  const reminder = useAskReminder(ask.id);
  const [sheet, setSheet] = useState(false);
  const failed = ask.voiceRecipe === 'failed';

  return (
    <>
      <Animated.View entering={listEnter(0)} style={styles.head} accessible accessibilityRole="header" accessibilityLabel={t('request.wants', { kid, dish: ask.dish })}>
        <Avatar name={kid} avatarKey={null} size={56} ring />
        <View style={styles.flex}>
          <Txt variant="label" size={18} weight={600} color={colors.greenDeep} numberOfLines={1}>
            {t('request.wantsYour', { kid })}
          </Txt>
          <Txt variant="display" size={40} leading={1.05}>
            {ask.dish}
          </Txt>
        </View>
      </Animated.View>

      {ask.kidVoiceUrl ? <KidVoice askId={ask.id} url={ask.kidVoiceUrl} kid={kid} /> : null}

      {ask.guess.length ? (
        <Animated.View entering={listEnter(1)} style={styles.guess}>
          <Txt variant="heading" size={17} weight={600} color={colors.peachInk}>
            {t('request.guess.title', { kid })}
          </Txt>
          <View style={styles.lines}>
            {ask.guess.map((g, i) => (
              <Txt key={`${i}:${g.name}`} variant="bodyInk" size={18} leading={1.3} color={g.amount ? colors.ink : colors.muted}>
                {g.amount ? (
                  <Txt variant="bodyInk" size={18} weight={700} leading={1.3}>
                    {g.amount}{' '}
                  </Txt>
                ) : null}
                {g.name}
              </Txt>
            ))}
          </View>
          <Txt variant="quote" size={20} leading={1.3} color={colors.peachInk}>
            {t('request.guess.close', { kid })}
          </Txt>
        </Animated.View>
      ) : null}

      <Animated.View entering={listEnter(2)} style={styles.doors}>
        {reminder ? (
          <PressableScale
            onPress={() => setSheet(true)}
            scaleTo={0.97}
            accessibilityLabel={`${t('request.reminded', { day: dayName(reminder.day, t) })}. ${everyLine(reminder.day, reminder.part, t)}`}
            accessibilityHint={t('request.remindedHint')}
            style={[styles.door, styles.reminded]}>
            <View style={[styles.disc, { backgroundColor: colors.green }]}>
              <CheckIcon size={22} color={colors.card} />
            </View>
            <View style={styles.doorText}>
              <Txt variant="title" size={20} leading={1.2} color={colors.butterInk}>
                {t('request.reminded', { day: dayName(reminder.day, t) })}
              </Txt>
              <Txt variant="lead" size={17} color={colors.butterInk}>
                {everyLine(reminder.day, reminder.part, t)}
              </Txt>
            </View>
          </PressableScale>
        ) : (
          <PressableScale onPress={() => setSheet(true)} scaleTo={0.97} accessibilityLabel={`${t('request.film.title')}. ${t('request.film.line')}`} style={[styles.door, styles.film]}>
            <View style={[styles.disc, { backgroundColor: colors.card }]}>
              <View style={styles.redDot} />
            </View>
            <View style={styles.doorText}>
              <Txt variant="title" size={20} leading={1.2} color={colors.card}>
                {t('request.film.title')}
              </Txt>
              <Txt variant="lead" size={17} weight={500} color={colors.card} style={styles.soft}>
                {t('request.film.line')}
              </Txt>
            </View>
          </PressableScale>
        )}

        <TellDoor
          title={failed ? t('request.failed.again', { kid }) : reminder ? t('request.quick.title', { kid }) : t('request.tell.title', { kid })}
          line={failed ? t('request.failed.line') : t('request.tell.line', { kid })}
          warn={failed}
          onPress={() => openVoice(ask.id)}
        />
      </Animated.View>

      <ReminderSheet ask={ask} visible={sheet} onClose={() => setSheet(false)} />
    </>
  );
}

function TellDoor({ title, line, warn, onPress }: { title: string; line: string; warn: boolean; onPress: () => void }) {
  return (
    <PressableScale onPress={onPress} scaleTo={0.97} accessibilityLabel={`${title}. ${line}`} style={[styles.door, styles.tell]}>
      <View style={[styles.disc, { backgroundColor: colors.sage }]}>
        <MicIcon size={22} color={colors.sageInk} />
      </View>
      <View style={styles.doorText}>
        <Txt variant="title" size={20} leading={1.2}>
          {title}
        </Txt>
        <Txt variant="lead" size={17} color={warn ? colors.danger : colors.muted}>
          {line}
        </Txt>
      </View>
    </PressableScale>
  );
}

/** His voice note: the lavender pill, played on the app's shared player. */
function KidVoice({ askId, url, kid }: { askId: string; url: string; kid: string }) {
  const { t } = useWords();
  const play = useClipAudio({ url, key: `ask:${askId}`, start_s: 0, end_s: null });
  const length = play.duration > 0 ? mmss(play.playing ? play.elapsed : play.duration) : null;
  return (
    <Animated.View entering={listEnter(1)}>
      <PressableScale
        onPress={play.toggle}
        accessibilityLabel={play.playing ? t('request.voiceNotePause', { kid }) : t('request.voiceNotePlay', { kid })}
        style={styles.voice}>
        <View style={styles.play}>{play.playing ? <PauseIcon size={18} color={colors.card} /> : <PlayIcon size={18} color={colors.card} />}</View>
        <Txt variant="title" size={18} color={colors.lavenderInk} style={styles.flex} numberOfLines={1}>
          {length ? t('request.voiceNoteLength', { kid, time: length }) : t('request.voiceNote', { kid })}
        </Txt>
      </PressableScale>
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  page: { flex: 1, backgroundColor: colors.page },
  col: { flexGrow: 1, paddingHorizontal: space.gutter, gap: 18 },
  flex: { flex: 1 },
  missing: { flex: 1, alignItems: 'center', justifyContent: 'center', paddingBottom: 80 },
  head: { flexDirection: 'row', alignItems: 'center', gap: 14 },
  voice: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    backgroundColor: colors.lavender,
    borderRadius: 22,
    paddingVertical: 12,
    paddingLeft: 12,
    paddingRight: 16,
  },
  play: { width: 44, height: 44, borderRadius: 22, backgroundColor: colors.lavenderInk, alignItems: 'center', justifyContent: 'center' },
  guess: { backgroundColor: colors.card, borderRadius: radii.panel, paddingVertical: 20, paddingHorizontal: 22, gap: 12, boxShadow: shadows.card },
  lines: { gap: 10 },
  doors: { gap: 12, marginTop: 'auto', paddingTop: 6 },
  door: { flexDirection: 'row', alignItems: 'center', gap: 16, borderRadius: radii.panel, paddingVertical: 18, paddingHorizontal: 20 },
  film: { backgroundColor: colors.green, boxShadow: shadows.cta },
  reminded: { backgroundColor: colors.butter },
  tell: { backgroundColor: colors.card, borderWidth: 1.5, borderColor: alpha.border },
  disc: { width: 48, height: 48, borderRadius: 24, alignItems: 'center', justifyContent: 'center' },
  redDot: { width: 15, height: 15, borderRadius: 8, backgroundColor: colors.danger },
  doorText: { flex: 1, gap: 3 },
  soft: { opacity: 0.9 },
});
