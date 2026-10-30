// "Ask what they're craving" (docs/design/phase5-cold-parents, screen 2): her own words to her kids, a preview of
// the link they'll open, and the app row (components/share/ExternalRow: Copy link, Messages, WhatsApp, More).
//
//   ┌──────────── grabber ──────── (x) ┐
//   │  Ask what they're craving         │
//   │  ┌ green bubble ───────────────┐  │  her message, in her language, editable
//   │  │ What do you miss from home?…│  │
//   │  │            ✎ Tap to change it│  │
//   │  └─────────────────────────────┘  │
//   │  [egg] Pick a dish, Shreya will…  │  the link's preview: the egg, never a stock photo
//   │        homecookd.app              │
//   │  (⛓) (✉) (✆) (…)                 │
//   └───────────────────────────────────┘
//
// One link per opening, carrying her words (lib/cravings createCravingLink), made on the first tap and reused;
// it's made again only if she changes her words after that. What goes out is her words, then the link.
// The first app she taps (once the link is made) counts as sent: markCravingSent, so Home shows "Sent!", and
// `onSent` (Home's push-permission ask). The sheet stays open, so she can send it to someone else too.
//
//   <CravingSheet visible={open} onClose={() => setOpen(false)} onSent={askForPushes} />
import { useRef, useState } from 'react';
import { StyleSheet, TextInput, View } from 'react-native';
import Svg, { Path } from 'react-native-svg';

import { ExternalRow } from '@/components/share/ExternalRow';
import { BottomSheet, EggMark, PressableScale, Txt } from '@/components/ui';
import { createCravingLink } from '@/lib/cravings';
import { useSession } from '@/lib/session';
import { useWords } from '@/lib/words/useWords';
import { alpha, colors, fonts, radii } from '@/theme/tokens';

import { markCravingSent } from './useCravingSent';

/** The link's host as the kid's phone shows it under the preview (a domain, not a word to translate). */
const LINK_HOST = 'homecookd.app';

export type CravingSheetProps = {
  visible: boolean;
  onClose: () => void;
  /** She tapped an app and the link was made (once per opening). */
  onSent?: () => void;
};

export function CravingSheet(props: CravingSheetProps) {
  // A fresh sheet (her default words, a new link) on every opening.
  const [opened, setOpened] = useState({ visible: props.visible, n: 0 });
  if (props.visible !== opened.visible) setOpened({ visible: props.visible, n: opened.n + (props.visible ? 1 : 0) });
  return <Sheet key={opened.n} {...props} />;
}

function Sheet({ visible, onClose, onSent }: CravingSheetProps) {
  const { me } = useSession();
  const { t, rtl } = useWords();
  const fallback = t('craving.sheet.message');
  const [message, setMessage] = useState(fallback);
  const words = message.trim() || fallback;
  const input = useRef<TextInput>(null);

  const sent = useRef(false);
  const link = useRef<{ words: string; url: Promise<string> } | null>(null);
  const getUrl = () => {
    if (!link.current || link.current.words !== words) {
      const url = createCravingLink(words).then((r) => r.url);
      const made = { words, url };
      link.current = made;
      url.catch(() => {
        if (link.current === made) link.current = null;
      });
    }
    return link.current.url.then((url) => {
      if (!sent.current) {
        sent.current = true;
        if (me?.id) void markCravingSent(me.id);
        onSent?.();
      }
      return url;
    });
  };

  const name = me?.name?.trim();
  return (
    <BottomSheet visible={visible} onClose={onClose} accessibilityLabel={t('craving.ask')} contentStyle={styles.content}>
      <Txt variant="display" size={30} accessibilityRole="header" style={styles.title}>
        {t('craving.ask')}
      </Txt>
      <View style={styles.group}>
        <View style={styles.bubble}>
          <TextInput
            ref={input}
            value={message}
            onChangeText={setMessage}
            placeholder={fallback}
            placeholderTextColor={colors.muted}
            multiline
            scrollEnabled={false}
            maxLength={300}
            accessibilityLabel={t('craving.sheet.messageLabel')}
            style={[styles.input, rtl ? styles.rtl : null]}
          />
          <PressableScale onPress={() => input.current?.focus()} accessibilityRole="button" style={styles.change}>
            <PencilIcon />
            <Txt size={17} weight={700} color={colors.ink}>
              {t('craving.sheet.change')}
            </Txt>
          </PressableScale>
        </View>
        <View style={styles.preview}>
          <View style={styles.mark}>
            <EggMark size={36} />
          </View>
          <View style={styles.previewWords}>
            <Txt variant="title" numberOfLines={2}>
              {name ? t('craving.sheet.preview', { name }) : t('craving.sheet.previewNoName')}
            </Txt>
            <Txt variant="body">{LINK_HOST}</Txt>
          </View>
        </View>
      </View>
      <ExternalRow getUrl={getUrl} text={(url) => `${words}\n${url}`} title={t('craving.sheet.shareTitle')} omit={['instagram']} />
    </BottomSheet>
  );
}

function PencilIcon() {
  return (
    <Svg width={16} height={16} viewBox="0 0 24 24" fill="none" stroke={colors.ink} strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
      <Path d="M4 20h4L19 9l-4-4L4 16v4z" />
    </Svg>
  );
}

const styles = StyleSheet.create({
  content: { gap: 18 },
  title: { paddingRight: 48, paddingTop: 4 },
  group: { gap: 8 },
  // Her words as a chat bubble of hers (the green tint, the tail corner low on the left).
  bubble: {
    backgroundColor: colors.yolkTint,
    borderTopLeftRadius: 22,
    borderTopRightRadius: 22,
    borderBottomRightRadius: 22,
    borderBottomLeftRadius: 6,
    paddingTop: 16,
    paddingHorizontal: 18,
    paddingBottom: 12,
    gap: 8,
  },
  input: { fontFamily: fonts.sans, fontSize: 20, lineHeight: 27, color: colors.ink, padding: 0, margin: 0, minHeight: 81, textAlignVertical: 'top' },
  rtl: { writingDirection: 'rtl', textAlign: 'right' },
  change: { alignSelf: 'flex-end', flexDirection: 'row', alignItems: 'center', gap: 6, paddingVertical: 2 },
  preview: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    borderWidth: 1,
    borderColor: alpha.hairline,
    borderRadius: radii.thumb,
    paddingVertical: 10,
    paddingHorizontal: 12,
    backgroundColor: colors.page,
  },
  mark: { width: 48, height: 48, borderRadius: 12, backgroundColor: colors.card, alignItems: 'center', justifyContent: 'center' },
  previewWords: { flex: 1, gap: 2 },
});
