// The share sheet's first row (Spotify's contacts row): everyone else in the family as big round
// faces with their names underneath, scrolling sideways. For a recipe the ones who miss it come
// first (kidsFirst, QA B09): whoever cooked or opened this dish at the front, then the other ones
// who miss it, then the cooks. Tap one -> POST /send-recipe -> the row scrolls that face fully into
// view (`reveal`) -> a green arc spins round it -> a green check fades in and the name becomes
// "Sent" (ShareSheet also says "Sent to Leo" above the rows). A failed send says why in a toast
// (ShareSheet) and the person can be tapped again.
import { Avatar } from '@/components/ui';
import type { Profile } from '@/lib/api';

import { RoundTarget, TargetRow, useRowMetrics } from './RoundTarget';

export type SendState = 'idle' | 'sending' | 'sent';

/** Cooks first, then everyone else, each in the family's own order (the invite card's faces). */
export function cooksFirst(people: Profile[]): Profile[] {
  return [...people.filter((p) => p.role === 'cook'), ...people.filter((p) => p.role !== 'cook')];
}

/**
 * Who a recipe most likely goes to first: anyone in `front` (they cooked or opened this dish), then
 * the ones who miss it, then the cooks, each group in the family's own order.
 */
export function kidsFirst(people: Profile[], front: ReadonlySet<string> = new Set()): Profile[] {
  const byRole = [...people.filter((p) => p.role !== 'cook'), ...people.filter((p) => p.role === 'cook')];
  return [...byRole.filter((p) => front.has(p.id)), ...byRole.filter((p) => !front.has(p.id))];
}

export function FamilyRow({
  people,
  states,
  onSend,
  reveal,
}: {
  people: Profile[];
  states: Record<string, SendState>;
  onSend: (p: Profile) => void;
  /** Scroll this face fully into view (a new object per tap). */
  reveal?: { index: number } | null;
}) {
  const { circle } = useRowMetrics();
  return (
    <TargetRow accessibilityLabel="Send to family" reveal={reveal}>
      {people.map((p) => {
        const state = states[p.id] ?? 'idle';
        return (
          <RoundTarget
            key={p.id}
            label={p.name}
            accessibilityLabel={state === 'sent' ? `Sent to ${p.name}` : state === 'sending' ? `Sending to ${p.name}` : `Send to ${p.name}`}
            onPress={() => onSend(p)}
            busy={state === 'sending'}
            done={state === 'sent'}>
            <Avatar profile={p} size={circle} />
          </RoundTarget>
        );
      })}
    </TargetRow>
  );
}
