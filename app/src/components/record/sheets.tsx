// Small sheets for Record + Send (motion spec 4 BottomSheet):
//  PhoneOnlySheet  web: recording and sending videos happen in the app on a phone
//  AddVideosSheet  Send's "Add more" tile: record another part, or pick from the camera roll
import { StyleSheet, View } from 'react-native';

import { ActionButton, BottomSheet, PotMark, RecordDotIcon, Txt, VideoIcon } from '@/components/ui';
import { colors } from '@/theme/tokens';

export function PhoneOnlySheet({ visible, onClose }: { visible: boolean; onClose: () => void }) {
  return (
    <BottomSheet
      visible={visible}
      onClose={onClose}
      accessibilityLabel="Open homecookd on your phone"
      footer={<ActionButton label="Got it" size="lg" flat onPress={onClose} />}>
      <View style={styles.center}>
        <View style={styles.disc}>
          <PotMark size={44} />
        </View>
        <Txt variant="display" size={26} leading={1.15} align="center">
          Open homecookd on your phone
        </Txt>
      </View>
    </BottomSheet>
  );
}

export function AddVideosSheet({
  visible,
  onClose,
  onRecord,
  onLibrary,
}: {
  visible: boolean;
  onClose: () => void;
  onRecord: () => void;
  onLibrary: () => void;
}) {
  return (
    <BottomSheet visible={visible} onClose={onClose} title="Add to this recipe" accessibilityLabel="Add videos">
      <View style={styles.actions}>
        <ActionButton
          label="Record another part"
          size="lg"
          flat
          icon={
            <View style={styles.dot}>
              <RecordDotIcon size={14} color={colors.danger} />
            </View>
          }
          onPress={onRecord}
        />
        <ActionButton
          label="Use videos I already took"
          size="lg"
          variant="outline"
          fg={colors.greenDeep}
          labelWeight={700}
          icon={<VideoIcon size={20} color={colors.greenDeep} />}
          onPress={onLibrary}
        />
      </View>
    </BottomSheet>
  );
}

const styles = StyleSheet.create({
  center: { alignItems: 'center', gap: 12, paddingTop: 8 },
  disc: {
    width: 88,
    height: 88,
    borderRadius: 44,
    backgroundColor: colors.peach,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 4,
  },
  actions: { gap: 12, marginTop: 4 },
  dot: {
    width: 30,
    height: 30,
    borderRadius: 15,
    backgroundColor: colors.card,
    alignItems: 'center',
    justifyContent: 'center',
  },
});
