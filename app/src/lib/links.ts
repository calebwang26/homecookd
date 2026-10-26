// homecookd.app pages the app links to (Apple wants the privacy policy reachable inside the app).
// They open in the in-app browser (Safari's sheet on iOS), so Back is one tap away.
import * as WebBrowser from 'expo-web-browser';
import { Linking } from 'react-native';

export const PRIVACY_URL = 'https://homecookd.app/privacy';
export const TERMS_URL = 'https://homecookd.app/terms';

export async function openPage(url: string): Promise<void> {
  try {
    await WebBrowser.openBrowserAsync(url);
  } catch {
    await Linking.openURL(url).catch(() => {});
  }
}
