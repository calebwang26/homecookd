// The cook-mode consent, changeable later (RETENTION-HANDOFF 3.1, guardrail 6): one quiet row for the
// foot of "Who's in the kitchen?" (`/?pick=1`, next to "Switch family"):
//   Show cooks when I cook · On
// A tap flips it (saved at once; a failure flips it back with a toast). It reads the acting person's
// answer (GET /profile/share-cooking) and stays hidden until they have answered once: the first
// cook-mode visit on another cook's dish asks (ConsentSheet), so nobody meets a setting for something
// they never saw. Off also ends a live session right away (the server does that).
// Needs nothing from the screen but who is acting (`profileId`, to reload when the face changes).
// TODO(caleb): not mounted yet. The handoff puts this "in the kid's own profile sheet", and the app
// has none (no new settings screen for one row). Ready to mount where Caleb picks, e.g. first in the
// `/?pick=1` foot of app/index.tsx (RETENTION-WIRING.md PR 2 A4): `<ShareCookingRow profileId={me?.id} />`.
// Until then the consent sheet's answer can't be changed in the app (guardrail 6: asked once).
import { useEffect, useState } from 'react';
import { StyleSheet, type StyleProp, type ViewStyle } from 'react-native';

import { haptic, PressableScale, Txt, useToast } from '@/components/ui';
import { cookingApi } from '@/lib/cookingApi';
import { colors } from '@/theme/tokens';

export type ShareCookingRowProps = {
  /** Who is acting on this phone (session `me.id`); null hides the row. */
  profileId: string | null | undefined;
  style?: StyleProp<ViewStyle>;
};

type Answer = { id: string; share: boolean | null };

export function ShareCookingRow({ profileId, style }: ShareCookingRowProps) {
  const toast = useToast();
  const [answer, setAnswer] = useState<Answer | null>(null);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!profileId) return;
    let alive = true;
    cookingApi.share().then(
      (r) => {
        if (alive) setAnswer({ id: profileId, share: typeof r?.share_cooking === 'boolean' ? r.share_cooking : null });
      },
      () => {
        // Offline or an older server: no row (nothing to change yet).
      },
    );
    return () => {
      alive = false;
    };
  }, [profileId]);

  const share = profileId && answer?.id === profileId ? answer.share : null;
  if (!profileId || share === null) return null;

  const flip = async () => {
    if (saving) return;
    const next = !share;
    setSaving(true);
    setAnswer({ id: profileId, share: next });
    try {
      await cookingApi.setShare(next);
      haptic('selection');
    } catch {
      setAnswer({ id: profileId, share });
      toast.show('Couldn’t save that. Try again.', { tone: 'error' });
    } finally {
      setSaving(false);
    }
  };

  return (
    <PressableScale
      onPress={flip}
      disabled={saving}
      accessibilityRole="switch"
      accessibilityLabel="Show cooks when I cook their dishes"
      accessibilityState={{ checked: share, busy: saving }}
      style={[styles.row, style]}>
      <Txt variant="label" weight={600} color={colors.muted}>
        Show cooks when I cook ·{' '}
        <Txt variant="label" weight={700} color={share ? colors.green : colors.muted}>
          {share ? 'On' : 'Off'}
        </Txt>
      </Txt>
    </PressableScale>
  );
}

const styles = StyleSheet.create({
  // The foot's link size (qa-people index.tsx footLink): a 48 pt tap target.
  row: { minHeight: 48, paddingHorizontal: 16, alignItems: 'center', justifyContent: 'center' },
});
