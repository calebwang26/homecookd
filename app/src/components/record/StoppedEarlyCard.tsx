// "Your recording stopped early. Send what was filmed?" on the cook's Home (Oct 26): the app died (a
// crash, iOS, the battery) or her recording screen closed while she was still filming, before "I'm
// done". Its saved 5-minute files are on the phone (lib/unsentRecordings 'filming' note); nothing is sent
// without her. Only the cook who filmed it sees it, in that family.
//   Send it   the send the done view does (sendDraft, as her, to the kids she picked before filming),
//             and the recording ends on Convex (live.endRecording) so it isn't left "recording". If the
//             app dies again on the way, the next launch carries on by itself (useResendUnsent).
//   Delete    "Delete this video?" first (it's for good): then the files and the note go, and the recording ends on Convex.
// Big type, few words: her language (useWords). Dev aid (web screenshots): Home's `?preview=stopped`.
import { useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react';
import { StyleSheet, View } from 'react-native';
import Animated from 'react-native-reanimated';

import { ActionButton, listEnter, RecordDotIcon, SendIcon, Txt, useToast } from '@/components/ui';
import { ensureAiConsent } from '@/lib/aiConsent';
import { minutesLabel } from '@/lib/format';
import { endRecording } from '@/lib/live/convex';
import { useSession } from '@/lib/session';
import { filmedLength, stoppedEarly, type Unsent } from '@/lib/unsentLogic';
import {
  backToFilming,
  clipsHere,
  deleteRecording,
  dropUnsent,
  filmingNow,
  loadUnsent,
  startSending,
  subscribeUnsent,
  unsentVersion,
} from '@/lib/unsentRecordings';
import { useWords } from '@/lib/words/useWords';
import { colors, radii, shadows } from '@/theme/tokens';

import { MAX_TITLE, sendDraft } from './sendDraft';
import { keptClips } from './useResendUnsent';
import { doneTo } from './who';

/** The newest recording to ask her about, or null. */
function useStoppedEarly(): Unsent | null {
  const { me, family } = useSession();
  const version = useSyncExternalStore(subscribeUnsent, unsentVersion, unsentVersion);
  return useMemo(() => {
    void version; // a note written, sent or deleted: look again
    return stoppedEarly(loadUnsent(), { cookId: me?.id, familyId: family?.id, filmingNow })[0] ?? null;
  }, [version, me?.id, family?.id]);
}

export function StoppedEarlyCard({ preview = null, enterIndex = 0 }: { preview?: Unsent | null; enterIndex?: number }) {
  const live = useStoppedEarly();
  const note = preview ?? live;
  const here = useMemo(() => (note ? (preview ? note.clips : clipsHere(note)) : []), [note, preview]);
  // A note whose files are all gone has nothing to offer.
  useEffect(() => {
    if (note && !preview && here.length === 0) dropUnsent(note.recordingId);
  }, [note, preview, here.length]);
  if (!note || here.length === 0) return null;
  return <Card key={note.recordingId} note={note} here={here} preview={!!preview} enterIndex={enterIndex} />;
}

function Card({ note, here, preview, enterIndex }: { note: Unsent; here: Unsent['clips']; preview: boolean; enterIndex: number }) {
  const { t } = useWords();
  const toast = useToast();
  const { me, profiles, learners } = useSession();
  const [sure, setSure] = useState(false);
  const [sending, setSending] = useState(false);
  // Taps while the consent sheet is up (one yes answers them all) or a send runs: only the first goes.
  const busy = useRef(false);
  const filmed = t('parent.stopped.filmed', { time: minutesLabel(filmedLength(here) / 1000, t) });
  const dish = note.dish?.trim();

  const send = async () => {
    if (preview || busy.current || !me) return;
    busy.current = true;
    if (!(await ensureAiConsent())) {
      busy.current = false;
      return;
    }
    setSending(true);
    const u = startSending(note.recordingId); // null unless it's still waiting for her: never twice
    if (!u) return;
    void endRecording(u.recordingId, me.id); // not left "recording" on Convex (false when it can't: fine)
    const to = doneTo(me.id, profiles, learners, u);
    try {
      await sendDraft({
        me,
        draft: { glasses: false, language: u.language, recordingId: u.recordingId },
        clips: keptClips(here),
        kids: to.picked,
        recipients: to.recipients,
        toLabel: to.label,
        dish: (u.dish ?? '').trim().slice(0, MAX_TITLE),
        note: u.recordingId,
      });
      toast.show(to.everyone ? t('parent.send.onItsWayEveryone') : to.label ? t('parent.send.onItsWayTo', { name: to.label }) : t('parent.send.onItsWay'));
    } catch (e) {
      console.warn('[stopped] send failed', String(e).slice(0, 160));
      backToFilming(u.recordingId); // no upload was made: the card asks again
      busy.current = false;
      setSending(false);
      toast.show(t('parent.stopped.didntSend'), { tone: 'error' });
    }
  };

  const remove = () => {
    if (preview) return setSure(false);
    deleteRecording(note);
    // Ended on Convex now rather than by the idle cron; nothing here may hold up the delete.
    try {
      if (me && !note.local) void endRecording(note.recordingId, me.id).catch(() => {});
    } catch {
      // the cron ends it
    }
    toast.show(t('parent.stopped.deleted'));
  };

  return (
    <Animated.View entering={listEnter(enterIndex)} style={styles.card}>
      {sure ? (
        <>
          <Txt variant="display" size={28} leading={1.15} accessibilityRole="header">
            {t('parent.stopped.sure')}
          </Txt>
          <Txt variant="body" size={19} color={colors.muted}>
            {t('parent.stopped.gone')}
          </Txt>
          <View style={styles.buttons}>
            <ActionButton label={t('parent.stopped.keep')} size="xl" flat onPress={() => setSure(false)} />
            <ActionButton label={t('parent.stopped.yesDelete')} size="lg" variant="outline" fg={colors.danger} onPress={remove} />
          </View>
        </>
      ) : (
        <>
          <View style={styles.top}>
            <View style={styles.dot}>
              <RecordDotIcon size={18} color={colors.danger} />
            </View>
            <Txt variant="label" size={19} weight={700} color={colors.muted} style={styles.flex}>
              {dish ? `${dish} · ${filmed}` : filmed}
            </Txt>
          </View>
          <Txt variant="display" size={28} leading={1.15} accessibilityRole="header">
            {t('parent.stopped.title')}
          </Txt>
          <Txt variant="body" size={20} weight={600} color={colors.ink}>
            {t('parent.stopped.ask')}
          </Txt>
          <View style={styles.buttons}>
            <ActionButton
              label={t('parent.stopped.send')}
              size="xl"
              flat
              state={sending ? 'loading' : 'idle'}
              loadingLabel={t('parent.stopped.sending')}
              icon={<SendIcon size={22} color={colors.ink} />}
              onPress={() => void send()}
            />
            <ActionButton label={t('parent.stopped.delete')} size="lg" variant="outline" disabled={sending} onPress={() => setSure(true)} />
          </View>
        </>
      )}
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  card: { backgroundColor: colors.card, borderRadius: radii.panel, padding: 22, gap: 14, boxShadow: shadows.card },
  top: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  dot: { width: 40, height: 40, borderRadius: 20, backgroundColor: colors.yolkTint, alignItems: 'center', justifyContent: 'center' },
  flex: { flex: 1 },
  buttons: { gap: 12, marginTop: 6 },
});
