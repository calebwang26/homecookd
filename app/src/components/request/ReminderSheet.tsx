// "When do you make it?" (Phase 5 screen 7, mockup Reminder): day chips Sun to Sat (today's preselected, or
// the day she already picked), then Morning, Afternoon or Evening. "Remind me on Sundays" / "Every Sunday at
// 4 pm" asks the OS first, schedules the weekly reminder (lib/askReminders), tells the server the day
// (setFilmingDay) and closes. Notifications off: the button reads "Turn on reminders" and opens Settings.
// "I'm making it now" opens Record with the dish filled in.
import { router, type Href } from 'expo-router';
import { useEffect, useState } from 'react';
import { AppState, Linking, StyleSheet, View } from 'react-native';

import { ActionButton, BottomSheet, haptic, PressableScale, SegmentedChoice, Txt, useToast } from '@/components/ui';
import { askReminderPermission, reminderPermission, setAskReminder, useAskReminder, type ReminderPermission } from '@/lib/askReminders';
import { setFilmingDay, type CravingAsk } from '@/lib/cravings';
import { dayName, dayPlural, dayShort, everyLine, partName, recordUrl, REMINDER_PARTS, type ReminderPart } from '@/lib/reminders';
import { useSession } from '@/lib/session';
import { useWords } from '@/lib/words/useWords';
import { alpha, colors, radii, shadows } from '@/theme/tokens';

const DAYS = [0, 1, 2, 3, 4, 5, 6];
/** The sheet's Modal is gone before Record slides in (BottomSheet closes in 240 ms). */
const SHEET_GONE_MS = 320;

/** Record with this ask's dish and kid ("Caleb asked for braised pork"); sending it ends the reminder. */
export function recordForAsk(ask: Pick<CravingAsk, 'id' | 'dish' | 'kidName'>): Href {
  return recordUrl({ dish: ask.dish, from: ask.kidName, ask: ask.id }) as Href;
}

export function ReminderSheet({ ask, visible, onClose }: { ask: CravingAsk; visible: boolean; onClose: () => void }) {
  const { t } = useWords();
  const toast = useToast();
  const { me } = useSession();
  const set = useAskReminder(ask.id);
  const [day, setDay] = useState(() => set?.day ?? ask.filmingDay ?? new Date().getDay());
  const [part, setPart] = useState<ReminderPart>(set?.part ?? 'afternoon');
  const [perm, setPerm] = useState<ReminderPermission>('undetermined');
  const [busy, setBusy] = useState(false);

  // Each time it opens: the day she picked before (else today). Only on opening, so a reminder saved while
  // it's open never moves her picks.
  const [shown, setShown] = useState(visible);
  if (visible !== shown) {
    setShown(visible);
    if (visible) {
      setDay(set?.day ?? ask.filmingDay ?? new Date().getDay());
      if (set) setPart(set.part);
    }
  }
  // What the OS says now, and again on coming back from Settings.
  useEffect(() => {
    if (!visible) return;
    const check = () => void reminderPermission().then(setPerm);
    check();
    const sub = AppState.addEventListener('change', (s) => s === 'active' && check());
    return () => sub.remove();
  }, [visible]);

  const remind = async () => {
    if (busy) return;
    if (perm === 'denied') {
      Linking.openSettings().catch(() => {});
      return;
    }
    setBusy(true);
    try {
      const now = await askReminderPermission();
      setPerm(now);
      if (now === 'unsupported') return toast.show(t('request.reminder.phoneOnly'), { tone: 'info' });
      if (now !== 'granted') return;
      if (!(await setAskReminder({ ask, day, part, profileId: me?.id ?? '', t }))) {
        return toast.show(t('request.reminder.failed'), { tone: 'error' });
      }
      // The kid's "Mom's filming it Sunday": nice to have, so a failure here never undoes her reminder.
      await setFilmingDay(ask.id, day).catch(() => {});
      haptic('success');
      onClose();
    } finally {
      setBusy(false);
    }
  };

  const makingNow = () => {
    onClose();
    setTimeout(() => router.push(recordForAsk(ask)), SHEET_GONE_MS);
  };

  const off = perm === 'denied';
  return (
    <BottomSheet visible={visible} onClose={onClose} accessibilityLabel={t('request.reminder.title')}>
      <Txt variant="display" size={30} accessibilityRole="header">
        {t('request.reminder.title')}
      </Txt>

      <View style={styles.group}>
        <Txt variant="heading" size={17} weight={600} color={colors.muted}>
          {t('request.reminder.day')}
        </Txt>
        <View style={styles.days} accessibilityRole="radiogroup" accessibilityLabel={t('request.reminder.day')}>
          {DAYS.map((d) => {
            const on = d === day;
            return (
              <PressableScale
                key={d}
                onPress={() => setDay(d)}
                haptic
                accessibilityRole="radio"
                accessibilityState={{ selected: on }}
                accessibilityLabel={dayName(d, t)}
                style={[styles.day, on ? styles.dayOn : styles.dayOff]}>
                <Txt variant="label" size={16} weight={on ? 700 : 600} color={on ? colors.card : colors.ink} numberOfLines={1} adjustsFontSizeToFit>
                  {dayShort(d, t)}
                </Txt>
              </PressableScale>
            );
          })}
        </View>
      </View>

      <View style={styles.group}>
        <Txt variant="heading" size={17} weight={600} color={colors.muted}>
          {t('request.reminder.time')}
        </Txt>
        <SegmentedChoice
          options={REMINDER_PARTS.map((p) => ({ key: p, title: partName(p, t) }))}
          value={part}
          onChange={setPart}
          height={52}
          accessibilityLabel={t('request.reminder.time')}
        />
      </View>

      <View style={styles.foot}>
        <ActionButton
          label={off ? t('request.reminder.turnOn') : t('request.reminder.remindOn', { days: dayPlural(day, t) })}
          accessibilityHint={off ? t('request.reminder.turnOnHint') : undefined}
          onPress={() => void remind()}
          state={busy ? 'loading' : 'idle'}
          size="xl"
          labelSize={20}
        />
        <Txt variant="lead" size={17} color={colors.muted} align="center">
          {everyLine(day, part, t)}
        </Txt>
        <PressableScale onPress={makingNow} accessibilityLabel={t('request.reminder.makingNow')} style={styles.now}>
          <View style={styles.dot} />
          <Txt variant="label" size={17} weight={700} color={colors.yolkDeep}>
            {t('request.reminder.makingNow')}
          </Txt>
        </PressableScale>
      </View>
    </BottomSheet>
  );
}

const styles = StyleSheet.create({
  group: { gap: 10 },
  days: { flexDirection: 'row', gap: 6 },
  day: { flex: 1, height: 56, borderRadius: radii.tile, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 2 },
  dayOn: { backgroundColor: colors.ink, boxShadow: shadows.chip },
  dayOff: { backgroundColor: colors.page, borderWidth: 1, borderColor: alpha.hairline },
  foot: { gap: 6, marginTop: 12 },
  now: { height: 52, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 10 },
  dot: { width: 10, height: 10, borderRadius: 5, backgroundColor: colors.danger },
});
