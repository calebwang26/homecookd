// Small persistence helpers. Never throw (except secretRead): storage can be missing (private windows, previews).
//   secret*: the device key and family code. expo-secure-store on native, localStorage on web.
//   kv*:     everything else (cached family, profile lines, composer.mode.<id>). AsyncStorage on native, localStorage on web.
import AsyncStorage from '@react-native-async-storage/async-storage';
import * as SecureStore from 'expo-secure-store';
import { Platform } from 'react-native';
import { nativeClearLegacy, nativeGet, PREFIX, webGetItem, webSetItem } from './legacyKeys';

const web = Platform.OS === 'web';

const webGet = (key: string) => webGetItem(PREFIX + key);
const webSet = (key: string, value: string | null) => webSetItem(PREFIX + key, value);

// SecureStore keys may only contain alphanumerics, ".", "-" and "_".
export async function secretGet(key: string): Promise<string | null> {
  if (web) return webGet(key);
  return nativeGet(PREFIX + key, (k) => SecureStore.getItemAsync(k), (k, v) => SecureStore.setItemAsync(k, v),
    (k) => SecureStore.deleteItemAsync(k));
}

/**
 * Like secretGet, but a keychain that can't answer right now (a locked phone, a launch in the
 * background) throws instead of looking empty, so it is never mistaken for "nothing saved".
 */
export async function secretRead(key: string): Promise<string | null> {
  if (web) return webGet(key);
  const v = await SecureStore.getItemAsync(PREFIX + key);
  return v ?? secretGet(key); // nothing under the new name: the old "edible.*" one, moved over
}

export async function secretSet(key: string, value: string | null): Promise<void> {
  if (web) return webSet(key, value);
  try {
    if (value == null) await SecureStore.deleteItemAsync(PREFIX + key);
    else await SecureStore.setItemAsync(PREFIX + key, value);
  } catch {
    // ignore
  }
  await nativeClearLegacy(PREFIX + key, (k) => SecureStore.deleteItemAsync(k));
}

export async function kvGet(key: string): Promise<string | null> {
  if (web) return webGet(key);
  return nativeGet(PREFIX + key, (k) => AsyncStorage.getItem(k), (k, v) => AsyncStorage.setItem(k, v),
    (k) => AsyncStorage.removeItem(k));
}

export async function kvSet(key: string, value: string | null): Promise<void> {
  if (web) return webSet(key, value);
  try {
    if (value == null) await AsyncStorage.removeItem(PREFIX + key);
    else await AsyncStorage.setItem(PREFIX + key, value);
  } catch {
    // ignore
  }
  await nativeClearLegacy(PREFIX + key, (k) => AsyncStorage.removeItem(k));
}

export async function kvGetJson<T>(key: string): Promise<T | null> {
  const raw = await kvGet(key);
  if (!raw) return null;
  try {
    return JSON.parse(raw) as T;
  } catch {
    return null;
  }
}

export function kvSetJson(key: string, value: unknown): Promise<void> {
  return kvSet(key, value == null ? null : JSON.stringify(value));
}

/** The chat composer's last mode for a person on this phone: 'voice' (default) or 'type'. */
export const composerModeKey = (profileId: string) => `composer.mode.${profileId}`;
