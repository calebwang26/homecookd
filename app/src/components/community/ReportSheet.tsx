// "Report or block" (App Review 1.2) for another family's recipe or dinner: a quiet link at the foot of
// its page opens one sheet. Pick why and report it: it leaves your family's map at once, and the team
// looks within a day. Or block the family: neither of you sees the other in Community. Either way the
// sheet thanks you, then the page goes back. The team's email is the fallback.
//
//   <ReportOrBlock target={{ kind: 'recipe', id, familyName }} onOpenChange={hold} />
//
// `onOpenChange(true)` comes before anything is sent, so the page can keep showing what it has: once a
// report or block lands, its live query answers null under the sheet.
import { useState } from 'react';
import { Linking, StyleSheet, View } from 'react-native';

import { ActionButton, BottomSheet, CheckIcon, haptic, PressableScale, Txt, useToast } from '@/components/ui';
import { block, report, type Reportable, type ReportReason } from '@/lib/live/community';
import { alpha, colors, radii } from '@/theme/tokens';

import { goBack } from './DetailPage';
import { errorText } from './labels';
import { BLOCK_LINE, BLOCKED, blockLabel, REPORT_LINK, REPORT_REASONS, REPORTED, reportTitle, TEAM_EMAIL } from './report';

export type ReportTarget = { kind: Reportable; id: string; familyName: string };

export function ReportOrBlock({ target, onOpenChange }: { target: ReportTarget; onOpenChange?: (open: boolean) => void }) {
  const [open, setOpen] = useState(false);
  const show = (on: boolean) => {
    setOpen(on);
    onOpenChange?.(on);
  };
  return (
    <>
      <PressableScale onPress={() => show(true)} hitSlop={12} accessibilityRole="button" accessibilityLabel={REPORT_LINK} style={styles.link}>
        <Txt variant="caption" align="center" style={styles.underline}>
          {REPORT_LINK}
        </Txt>
      </PressableScale>
      <ReportSheet target={target} visible={open} onClose={() => show(false)} onDone={() => goBack()} />
    </>
  );
}

export function ReportSheet({ target, visible, onClose, onDone }: { target: ReportTarget; visible: boolean; onClose: () => void; onDone: () => void }) {
  const toast = useToast();
  const [reason, setReason] = useState<ReportReason | null>(null);
  const [done, setDone] = useState<{ title: string; subtitle: string } | null>(null);
  const send = (act: () => Promise<void>, after: { title: string; subtitle: string }) => async () => {
    try {
      await act();
    } catch (e) {
      toast.show(errorText(e, `Couldn’t send that. Write to ${TEAM_EMAIL}.`), { tone: 'error' });
      throw e;
    }
    setDone(after);
  };

  return (
    <BottomSheet visible={visible} onClose={onClose} title={reportTitle(target.kind)} success={done} onSuccessDone={onDone}>
      <View style={styles.reasons} accessibilityRole="radiogroup" accessibilityLabel="Why are you reporting it?">
        {REPORT_REASONS.map((r) => {
          const on = r.key === reason;
          return (
            <PressableScale
              key={r.key}
              onPress={() => {
                if (!on) haptic('selection');
                setReason(r.key);
              }}
              scaleTo={0.98}
              accessibilityRole="radio"
              accessibilityState={{ selected: on }}
              accessibilityLabel={r.label}
              style={[styles.reason, on && styles.reasonOn]}>
              <Txt variant="label" size={17} weight={600} style={styles.flex}>
                {r.label}
              </Txt>
              {on ? (
                <View style={styles.check}>
                  <CheckIcon size={14} color={colors.card} strokeWidth={3} />
                </View>
              ) : null}
            </PressableScale>
          );
        })}
      </View>
      <ActionButton
        label="Report"
        disabled={!reason}
        accessibilityHint="It leaves your family’s map now. The team looks within a day."
        onPress={reason ? send(() => report(target.kind, target.id, reason), REPORTED) : undefined}
      />

      <View style={styles.rule} />

      <View style={styles.block}>
        <ActionButton label={blockLabel(target.familyName)} variant="outline" size="md" onPress={send(() => block(target.kind, target.id), BLOCKED)} />
        <Txt variant="meta" align="center">
          {BLOCK_LINE}
        </Txt>
      </View>

      <PressableScale
        onPress={() => void Linking.openURL(`mailto:${TEAM_EMAIL}`)}
        hitSlop={8}
        accessibilityRole="link"
        accessibilityLabel={`Or write to ${TEAM_EMAIL}`}
        style={styles.email}>
        <Txt variant="caption" align="center">
          Or write to{' '}
          <Txt variant="caption" weight={600} color={colors.yolkDeep}>
            {TEAM_EMAIL}
          </Txt>
        </Txt>
      </PressableScale>
    </BottomSheet>
  );
}

const styles = StyleSheet.create({
  link: { alignSelf: 'center', paddingVertical: 6, paddingHorizontal: 10 },
  underline: { textDecorationLine: 'underline' },
  flex: { flex: 1 },
  reasons: { gap: 6 },
  reason: {
    minHeight: 56,
    paddingHorizontal: 18,
    borderRadius: radii.tile,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    borderWidth: 1,
    borderColor: alpha.hairline,
  },
  reasonOn: { backgroundColor: colors.greenTint, borderColor: 'transparent' },
  check: { width: 26, height: 26, borderRadius: 13, backgroundColor: colors.green, alignItems: 'center', justifyContent: 'center' },
  rule: { height: 1, backgroundColor: alpha.hairline, marginVertical: 4 },
  block: { gap: 8 },
  email: { alignSelf: 'center', paddingTop: 4, paddingBottom: 4 },
});
