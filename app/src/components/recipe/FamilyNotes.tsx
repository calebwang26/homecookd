// Answers the family saved into a recipe (GET /recipes/:id/notes):
//  FromTheFamily      the "From the family" block (it was inside a step's old "More from <cook>" drawer)
// TODO(caleb): unused since round 2 (Oct 22) cut that drawer, so saved answers show nowhere while chat
// still offers "Save to recipe" (they are still saved on the server). Default kept: nothing shown,
// nothing deleted. Either cut "Save to recipe" from chat and delete this file and useRecipeNotes, or
// bring the answers back as one quiet row on the step they belong to.
// Each question shows once: who asked + their words (the yolk tint, Fraunces italic), then every answer
// saved for it, each with who answered (avatar + name) and their words, or a "Hear Dad · 0:12"
// button for a voice answer. The answer's author, the asker and the dish's cook see a small "Remove"
// under an answer (one saved by mistake): it asks once, then takes it out of the recipe.
import { useEffect, useRef, useState } from 'react';
import { ActivityIndicator, StyleSheet, View } from 'react-native';

import { Avatar, PauseIcon, PlayIcon, PressableScale, Txt } from '@/components/ui';
import { errorMessage, type RecipeNote } from '@/lib/api';
import { mmss } from '@/lib/format';
import { removeNote } from '@/lib/messaging';
import { getCachedEntry, getCachedRecipe } from '@/lib/recipes';
import { useSession } from '@/lib/session';
import { useVoicePlayback } from '@/lib/voice';
import { colors, radii } from '@/theme/tokens';

/** Answers to the same question together, in first-answer order (each question shows once). */
export function groupByQuestion(notes: RecipeNote[]): RecipeNote[][] {
  const groups = new Map<string, RecipeNote[]>();
  for (const n of notes) {
    const key = n.question_message_id ? `q:${n.question_message_id}` : `n:${n.id}`;
    const g = groups.get(key);
    if (g) g.push(n);
    else groups.set(key, [n]);
  }
  return [...groups.values()];
}

/** One question (when there was one) and every answer saved for it. */
export function NoteQA({ notes, onExpired }: { notes: RecipeNote[]; onExpired?: () => void }) {
  const first = notes[0];
  if (!first) return null;
  const q = (first.question ?? '').trim();
  return (
    <View style={styles.qa}>
      {!q && first.asker && first.question_message_id ? (
        <Txt variant="label" size={13} weight={700} color={colors.ink}>
          {first.asker.name} asked by voice
        </Txt>
      ) : null}
      {q ? (
        <View style={styles.question}>
          <Txt variant="label" size={13} weight={700} color={colors.ink}>
            {first.asker ? `${first.asker.name} asked` : 'Asked'}
          </Txt>
          <Txt variant="quote" size={16} leading={1.4} color={colors.ink}>
            “{q}”
          </Txt>
        </View>
      ) : null}
      {notes.map((n) => (
        <NoteAnswer key={n.id} note={n} onExpired={onExpired} />
      ))}
    </View>
  );
}

const norm = (s: string | null | undefined) => (s ?? '').trim().toLowerCase();

/** One saved answer, with "Remove" for its author, the asker and the dish's cook. */
function NoteAnswer({ note, onExpired }: { note: RecipeNote; onExpired?: () => void }) {
  const { me } = useSession();
  const words = (note.answer_text ?? '').trim();
  const cook = getCachedRecipe(note.recipe_id)?.cook?.name ?? getCachedEntry(note.recipe_id)?.cook_name ?? '';
  const canRemove = !!me && (note.author.id === me.id || note.asker?.id === me.id || (!!norm(cook) && norm(cook) === norm(me.name)));
  return (
    <View style={styles.answerWrap}>
      <View style={styles.answerRow}>
        <Avatar profile={note.author} size={28} />
        <View style={styles.answer}>
          <Txt variant="label" size={13} weight={700} color={colors.ink}>
            {note.author.name}
          </Txt>
          {note.answer_audio_url ? <HearNote note={note} onExpired={onExpired} /> : null}
          {words ? (
            <Txt variant="bodyInk" size={15} leading={1.4} selectable>
              {words}
            </Txt>
          ) : null}
        </View>
      </View>
      {canRemove ? <RemoveNote note={note} /> : null}
    </View>
  );
}

/** "Remove" -> "Take it out of the recipe?" Remove / Keep. The note leaves once the notes refresh. */
function RemoveNote({ note }: { note: RecipeNote }) {
  const [step, setStep] = useState<'idle' | 'ask' | 'busy'>('idle');
  const [error, setError] = useState<string | null>(null);
  const remove = async () => {
    setStep('busy');
    setError(null);
    try {
      await removeNote(note);
    } catch (e) {
      setError(errorMessage(e, 'Couldn’t remove it. Try again.'));
      setStep('ask');
    }
  };
  if (step === 'idle') {
    return (
      <PressableScale
        onPress={() => setStep('ask')}
        accessibilityRole="button"
        accessibilityLabel={`Remove ${note.author.name}’s answer`}
        accessibilityHint="Asks before taking it out of the recipe"
        hitSlop={10}
        style={styles.removeLink}>
        <Txt variant="label" size={13} weight={700} color={colors.muted}>
          Remove
        </Txt>
      </PressableScale>
    );
  }
  return (
    <View style={styles.removeAsk} accessibilityLiveRegion="polite">
      <Txt variant="label" size={14} weight={600} color={colors.ink} style={styles.flex}>
        {error ?? 'Take it out of the recipe?'}
      </Txt>
      <PressableScale onPress={remove} disabled={step === 'busy'} accessibilityRole="button" accessibilityLabel="Remove it" hitSlop={8} style={styles.removeBtn}>
        {step === 'busy' ? <ActivityIndicator size="small" color={colors.danger} /> : null}
        <Txt variant="label" size={14} weight={700} color={colors.danger}>
          Remove
        </Txt>
      </PressableScale>
      <PressableScale onPress={() => setStep('idle')} disabled={step === 'busy'} accessibilityRole="button" accessibilityLabel="Keep it" hitSlop={8} style={styles.removeBtn}>
        <Txt variant="label" size={14} weight={700} color={colors.ink}>
          Keep
        </Txt>
      </PressableScale>
    </View>
  );
}

/** "Hear Dad · 0:12": plays a voice answer (a dead signed URL asks for fresh notes once). */
function HearNote({ note, onExpired }: { note: RecipeNote; onExpired?: () => void }) {
  const v = useVoicePlayback({
    id: `note:${note.id}`,
    audio_url: note.answer_audio_url,
    duration_s: note.answer_duration_s,
    clip_start_s: null,
    clip_end_s: null,
  });
  const asked = useRef(false);
  useEffect(() => {
    if (v.phase !== 'error' || asked.current) return;
    asked.current = true;
    onExpired?.();
  }, [v.phase, onExpired]);
  const playing = v.phase === 'playing' || v.phase === 'loading';
  const active = playing || v.phase === 'paused';
  const time = active && v.elapsed > 0 ? mmss(v.elapsed) : mmss(v.total);
  const label = `Hear ${note.author.name}${v.total ? ` · ${time}` : ''}`;
  return (
    <PressableScale
      onPress={v.toggle}
      disabled={!v.available}
      haptic
      accessibilityLabel={playing ? `Pause ${note.author.name}` : `Hear ${note.author.name} answer`}
      hitSlop={{ top: 6, bottom: 6, left: 4, right: 4 }}
      style={[styles.hear, !v.available ? { opacity: 0.5 } : null]}>
      <View style={styles.hearDisc}>{playing ? <PauseIcon size={12} color={colors.card} /> : <PlayIcon size={12} color={colors.card} />}</View>
      <Txt variant="label" size={14} weight={700} color={colors.ink} style={styles.tnum}>
        {label}
      </Txt>
    </PressableScale>
  );
}

/** Inside a step's "More from <cook>" drawer. Renders nothing without notes for this step. */
export function FromTheFamily({ notes, onExpired }: { notes: RecipeNote[]; onExpired?: () => void }) {
  if (!notes.length) return null;
  return (
    <View style={styles.block}>
      <Txt variant="eyebrow">From the family</Txt>
      {groupByQuestion(notes).map((g) => (
        <NoteQA key={g[0].id} notes={g} onExpired={onExpired} />
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  block: { gap: 12 },
  qa: { gap: 10 },
  question: { gap: 4, paddingVertical: 12, paddingHorizontal: 14, borderRadius: radii.tile, backgroundColor: colors.yolkTint },
  answerWrap: { gap: 4 },
  answerRow: { flexDirection: 'row', gap: 10, alignItems: 'flex-start' },
  // Under the answer bubble (past the 28 avatar and its 10 gap).
  removeLink: { alignSelf: 'flex-end', minHeight: 32, justifyContent: 'center', paddingHorizontal: 4 },
  removeAsk: {
    marginLeft: 38,
    minHeight: 48,
    paddingLeft: 14,
    paddingRight: 6,
    borderRadius: radii.tile,
    backgroundColor: colors.well,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
  },
  removeBtn: { minHeight: 44, paddingHorizontal: 10, flexDirection: 'row', alignItems: 'center', gap: 6 },
  answer: {
    flex: 1,
    gap: 6,
    paddingVertical: 10,
    paddingHorizontal: 14,
    backgroundColor: colors.greenTint,
    borderTopLeftRadius: 4,
    borderTopRightRadius: 18,
    borderBottomRightRadius: 18,
    borderBottomLeftRadius: 18,
  },
  hear: { flexDirection: 'row', alignItems: 'center', gap: 8, height: 36, alignSelf: 'flex-start' },
  hearDisc: { width: 28, height: 28, borderRadius: 14, backgroundColor: colors.ink, alignItems: 'center', justifyContent: 'center' },
  tnum: { fontVariant: ['tabular-nums'] },
  flex: { flex: 1 },
});
