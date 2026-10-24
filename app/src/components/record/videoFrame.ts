// A still frame from a local video, for the Send thumbnails and the "on its way" card.
// Uses expo-video's thumbnail generator (works in Expo Go); the result is a native image that
// expo-image renders directly. Cached per file for the session. Web gets null (no uploads there).
import { createVideoPlayer, type VideoPlayer, type VideoThumbnail } from 'expo-video';
import { useEffect, useState } from 'react';
import { Platform } from 'react-native';

const cache = new Map<string, VideoThumbnail | null>();
const inflight = new Map<string, Promise<VideoThumbnail | null>>();

function waitUntilReady(player: VideoPlayer, ms: number): Promise<void> {
  return new Promise((resolve) => {
    if (player.status === 'readyToPlay') return resolve();
    const t = setTimeout(() => {
      sub.remove();
      resolve();
    }, ms);
    const sub = player.addListener('statusChange', ({ status }) => {
      if (status === 'readyToPlay' || status === 'error') {
        clearTimeout(t);
        sub.remove();
        resolve();
      }
    });
  });
}

async function generate(uri: string, atSeconds: number): Promise<VideoThumbnail | null> {
  let player: VideoPlayer | null = null;
  try {
    player = createVideoPlayer(uri);
    player.muted = true;
    const at = Math.max(0, atSeconds);
    try {
      const [t] = await player.generateThumbnailsAsync([at], { maxWidth: 400, maxHeight: 400 });
      if (t) return t;
    } catch {
      // The asset may not be loaded yet: wait for it and try once more.
    }
    await waitUntilReady(player, 5000);
    const [t] = await player.generateThumbnailsAsync([at], { maxWidth: 400, maxHeight: 400 });
    return t ?? null;
  } catch {
    return null; // file gone (e.g. after a relaunch) or unreadable: callers show a warm tile
  } finally {
    try {
      player?.release();
    } catch {
      // already released
    }
  }
}

/** A frame ~1 s in (or the middle of a shorter clip). null while loading or when unavailable. */
export function useVideoFrame(uri: string | null | undefined, durationMs?: number | null): VideoThumbnail | null {
  const usable = !!uri && Platform.OS !== 'web';
  const [got, setGot] = useState<{ uri: string; thumb: VideoThumbnail | null } | null>(null);
  useEffect(() => {
    if (!usable || !uri || cache.has(uri)) return;
    let alive = true;
    const at = durationMs && durationMs < 2000 ? durationMs / 2000 : 1;
    let job = inflight.get(uri);
    if (!job) {
      job = generate(uri, at).then((t) => {
        cache.set(uri, t);
        inflight.delete(uri);
        return t;
      });
      inflight.set(uri, job);
    }
    void job.then((t) => {
      if (alive) setGot({ uri, thumb: t });
    });
    return () => {
      alive = false;
    };
  }, [usable, uri, durationMs]);
  if (!usable || !uri) return null;
  if (cache.has(uri)) return cache.get(uri) ?? null;
  return got?.uri === uri ? got.thumb : null;
}
