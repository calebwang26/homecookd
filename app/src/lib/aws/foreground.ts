// Tells the AWS live polls (live.ts) when the app is in front: they wait in the background and ask at once on
// coming back. Imported once by whatever first watches a topic under AWS_ON.
import { AppState } from 'react-native';

import { setForeground } from './live';

const front = setForeground(() => AppState.currentState === 'active');
AppState.addEventListener('change', (s) => {
  if (s === 'active') front.changed();
});
