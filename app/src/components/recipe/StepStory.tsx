// A cook-mode step's story (kid QA round 2): "Story from Dad ›", a lavender row with the story's
// title, only on a step that has one. It opens a sheet with the story whole: its title, "Hear Dad tell
// it · 0:32" playing right there when there is a recording (HearRow), and the cook's words (lavender,
// Fraunces italic). Several stories on one step share the row and the sheet.
// Round 2 cut the rest of the old "More from Dad" drawer to declutter the step: the quote bubble,
// "Look for" (now the last substep, "Ready when …"), "In this step" (now StepIngredients), the
// "What made it special" callouts and the family's saved answers.
import { useState } from 'react';
import { ScrollView, StyleSheet, View, useWindowDimensions } from 'react-native';

import { HearRow } from '@/components/media';
import { BookIcon, BottomSheet, ChevronRightIcon, PressableScale, ScrollHold, Txt, useScrollHold } from '@/components/ui';
import { useHeard } from '@/lib/listening';
import type { Recipe, Step, Story } from '@/lib/types';
import { colors, radii } from '@/theme/tokens';

/** The stories told during this step. */
export function stepStories(recipe: Recipe, step: Step): Story[] {
  return recipe.stories.filter((s) => s.step === step.order || step.story_ids.includes(s.id));
}

export function StepStory({ recipe, step }: { recipe: Recipe; step: Step }) {
  const [open, setOpen] = useState(false);
  const stories = stepStories(recipe, step);
  if (!stories.length) return null;
  const name = recipe.cook.name;
  const title = stories.length > 1 ? `${stories.length} stories from ${name}` : `Story from ${name}`;
  const titles = stories.map((s) => s.title.trim()).filter(Boolean);

  return (
    <>
      <PressableScale
        scaleTo={0.98}
        onPress={() => setOpen(true)}
        accessibilityRole="button"
        accessibilityLabel={titles.length ? `${title}: ${titles.join(', ')}` : title}
        accessibilityHint="Opens the story"
        style={styles.row}>
        <BookIcon size={22} color={colors.lavenderInk} />
        <View style={styles.rowWords}>
          <Txt variant="label" size={16} weight={700} color={colors.lavenderInk} numberOfLines={1}>
            {title}
          </Txt>
          {titles.length ? (
            <Txt variant="meta" size={15} color={colors.lavenderInk} numberOfLines={1}>
              {titles.join(' · ')}
            </Txt>
          ) : null}
        </View>
        <ChevronRightIcon size={20} color={colors.lavenderInk} />
      </PressableScale>
      <BottomSheet visible={open} onClose={() => setOpen(false)} title={title}>
        {/* Mounted only while open: closing the sheet stops her voice. */}
        {open ? <Stories recipe={recipe} stories={stories} /> : null}
      </BottomSheet>
    </>
  );
}

function Stories({ recipe, stories }: { recipe: Recipe; stories: Story[] }) {
  const { height } = useWindowDimensions();
  const heard = useHeard(recipe);
  // Dragging the Hear bar holds the words still (ui/ScrollHold).
  const hold = useScrollHold();
  const name = recipe.cook.name;
  const url = recipe.media.audio_url;
  return (
    <ScrollHold value={hold.set}>
      <ScrollView style={{ maxHeight: height * 0.62 }} scrollEnabled={!hold.held} contentContainerStyle={styles.list} alwaysBounceVertical={false}>
        {stories.map((s) => (
          <View key={s.id} style={styles.story}>
            {s.title.trim() ? (
              <Txt variant="section" size={20} accessibilityRole="header">
                {s.title}
              </Txt>
            ) : null}
            {url && s.end_s > s.start_s ? (
              <HearRow clip={{ url, start_s: s.start_s, end_s: s.end_s, heard }} cookName={name} label={`Hear ${name} tell it`} />
            ) : null}
            <View style={styles.words}>
              <Txt variant="quote" size={16} leading={1.45} color={colors.lavenderInk} selectable>
                {`“${s.text.trim()}”`}
              </Txt>
            </View>
          </View>
        ))}
      </ScrollView>
    </ScrollHold>
  );
}

const styles = StyleSheet.create({
  row: {
    minHeight: 64,
    paddingVertical: 10,
    paddingLeft: 16,
    paddingRight: 12,
    borderRadius: 20,
    backgroundColor: colors.lavender,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
  },
  rowWords: { flex: 1, gap: 2 },
  list: { gap: 24, paddingBottom: 8 },
  story: { gap: 14 },
  words: { padding: 16, borderRadius: radii.tile, backgroundColor: colors.lavender },
});
