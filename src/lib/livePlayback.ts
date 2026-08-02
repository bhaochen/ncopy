import { convertFileSrc } from '@tauri-apps/api/core';

/**
 * Resolves a live-segment file path to a `<video>`-playable URL.
 *
 * The asset protocol (`convertFileSrc`) serves bytes correctly, but on Linux
 * WebKitGTK hands media off to GStreamer, which has no `asset://` scheme
 * handler (webkit bug 146351, tauri#3725) — the video never starts even when
 * the underlying fetch works. Pulling the file through the asset protocol
 * from the renderer (the WebKit network layer, CORS-enabled in Tauri v2) and
 * wrapping it in a blob URL sidesteps GStreamer entirely and plays on every
 * platform. If the fetch fails, falls back to the raw asset URL.
 */
export async function toPlayableVideoSrc(path: string): Promise<string> {
  try {
    const response = await fetch(convertFileSrc(path));
    const blob = await response.blob();
    return URL.createObjectURL(blob);
  } catch (error) {
    console.error(
      '[live] could not load segment over the asset protocol',
      error,
    );
    return convertFileSrc(path);
  }
}

/**
 * Releases a blob URL produced by `toPlayableVideoSrc`. Non-blob URLs (the
 * asset-protocol fallback) are left alone — only `blob:` URLs are revocable.
 */
export function revokeVideoSrc(src: string): void {
  if (src.startsWith('blob:')) {
    URL.revokeObjectURL(src);
  }
}
