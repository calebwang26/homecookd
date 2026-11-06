// Dev aid: the AI consent sheet on its own, for screenshots (web: /dev/consent). With EXPO_PUBLIC_BACKEND=aws it lists
// what 1.1 names; without, what the Convex build names.
import { View } from 'react-native';

import { AiConsentSheet } from '@/components/consent/AiConsentSheet';
import { colors } from '@/theme/tokens';

export default function ConsentPreview() {
  return (
    <View style={{ flex: 1, backgroundColor: colors.page }}>
      <AiConsentSheet visible onYes={() => {}} onNotNow={() => {}} />
    </View>
  );
}
