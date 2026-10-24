// "Add to calendar" on the dinner page: writes the dinner as an .ics file (ics.ts) to the cache with
// expo-file-system, then opens the share sheet with expo-sharing, where the phone offers Calendar. No
// new native module. On the web (dev) it downloads the file instead.
import { File, Paths } from 'expo-file-system';
import * as Sharing from 'expo-sharing';
import { Platform } from 'react-native';

import { type CalendarEvent, icsText } from './ics';

export async function addToCalendar(event: CalendarEvent): Promise<void> {
  const text = icsText(event);
  const name = `dinner-${event.uid.replace(/[^\w-]/g, '')}.ics`;
  if (Platform.OS === 'web') {
    const url = URL.createObjectURL(new Blob([text], { type: 'text/calendar' }));
    const a = document.createElement('a');
    a.href = url;
    a.download = name;
    a.click();
    URL.revokeObjectURL(url);
    return;
  }
  const file = new File(Paths.cache, name);
  file.create({ overwrite: true });
  file.write(text);
  if (!(await Sharing.isAvailableAsync())) throw new Error('Sharing isn’t available here');
  await Sharing.shareAsync(file.uri, { mimeType: 'text/calendar', UTI: 'com.apple.ical.ics', dialogTitle: 'Add to calendar' });
}
