// "Grandma's done" (frame 3 of Caleb's walkthrough), the recording screen's last view: after homie's
// last questions and goodbye, homie waves (its lid lifts, happy steam) over "झालं! Shreya ला पाठवतोय" /
// "Done! Sending it to Shreya", and after ~4 s she is back on her home, with no button to tap.
// Glasses: the glasses' computer uploads the video. A phone recording sends itself from here
// (sendDraft, with the pre-record sheet's dish and kids): no Send screen to tap through. If that send
// fails, Send opens with everything filled in, so she can try again there. If the app closes before
// the job is made and every video is up, the next launch sends it again in the background, as her
// (sendKept keeps a note; useResendUnsent).
import { router } from 'expo-router';
import { useEffect, useRef } from 'react';
import { AccessibilityInfo, StyleSheet, View } from 'react-native';
import Animated, { FadeIn, FadeInDown, useReducedMotion } from 'react-native-reanimated';

import { Txt, useToast } from '@/components/ui';
import { errorMessage } from '@/lib/api';
import { useSession } from '@/lib/session';
import { colors, motion } from '@/theme/tokens';

import { clearDraft, getDraft, useDraft } from './draft';
import { WavingHomie } from './GlowHomie';
import { COLUMN } from './RecordWash';
import { sendKept } from './sendKept';
import { doneTo } from './who';
import { doneLine, recordWords } from './words';

export const DONE_HOLD_MS = 4000;
const DONE_HOMIE_SIZE = 200;
const wait = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

function goHome() {
  if (router.canGoBack()) router.dismissTo('/parent/home');
  else router.replace('/parent/home');
}

export function DoneView({ source, lang, kidName, preview = false }: { source: 'phone' | 'glasses'; lang: string; kidName: string | null; preview?: boolean }) {
  const reduce = useReducedMotion();
  const { me, family, profiles, learners } = useSession();
  const draft = useDraft();
  const toast = useToast();

  const to = doneTo(me?.id, profiles, learners, draft);
  const line = doneLine(recordWords(lang), { kid: to.everyone ? null : (to.label ?? kidName), everyone: to.everyone, nobody: to.nobody });

  // The mount effect below runs once; it reads who it's for from here.
  const latest = useRef({ me, to, toast, familyId: family?.id ?? null });
  useEffect(() => {
    latest.current = { me, to, toast, familyId: family?.id ?? null };
  });

  useEffect(() => {
    if (preview) return;
    let alive = true;
    const send = async (): Promise<boolean> => {
      const { me: who, to, toast: t, familyId } = latest.current;
      const d = getDraft();
      const clips = d.clips.filter((c) => c.selected);
      if (source !== 'phone' || !clips.length) {
        // The glasses' computer sends this one: the pre-record answers are used up.
        if (!d.clips.length) clearDraft();
        return true;
      }
      if (!who) return false;
      try {
        await sendKept({
          me: who,
          draft: d,
          clips,
          kids: to.picked,
          recipients: to.recipients,
          toLabel: to.label,
          dish: (d.dish ?? '').trim(),
          familyId,
          forKids: d.forKids,
          everyone: d.everyone,
          requestFrom: d.requestFrom,
        });
        clearDraft();
        return true;
      } catch (e) {
        t.show(errorMessage(e, 'It didn’t send. Try again.'), { tone: 'error', durationMs: 4000 });
        return false;
      }
    };
    void Promise.all([wait(DONE_HOLD_MS), send()]).then(([, ok]) => {
      if (!alive) return;
      if (ok) goHome();
      else router.replace('/send');
    });
    return () => {
      alive = false;
    };
  }, [preview, source]);

  useEffect(() => {
    AccessibilityInfo.announceForAccessibility(line.en ? `${line.text}. ${line.en}` : line.text);
  }, [line.text, line.en]);

  return (
    <View style={styles.column}>
      <Animated.View entering={reduce ? FadeIn.duration(motion.reducedFadeMs) : FadeIn.duration(320)} style={styles.hero}>
        <WavingHomie size={DONE_HOMIE_SIZE} />
      </Animated.View>
      <Animated.View
        entering={reduce ? FadeIn.duration(motion.reducedFadeMs) : FadeInDown.duration(380).delay(240)}
        style={styles.label}
        accessible
        accessibilityRole="header"
        accessibilityLabel={line.en ? `${line.text}. ${line.en}` : line.text}>
        <Txt variant="label" size={32} weight={700} leading={1.3} color={colors.ink} align="center">
          {line.text}
        </Txt>
        {line.en ? (
          <Txt variant="meta" size={15} color={colors.muted} align="center">
            {line.en}
          </Txt>
        ) : null}
      </Animated.View>
    </View>
  );
}

const styles = StyleSheet.create({
  column: { flex: 1, paddingHorizontal: COLUMN.side, alignItems: 'center', justifyContent: 'center' },
  hero: { width: DONE_HOMIE_SIZE, height: DONE_HOMIE_SIZE },
  label: { marginTop: COLUMN.toLabel, alignItems: 'center', gap: 6 },
});
