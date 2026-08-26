import type { BedId } from './ambiencePresets';

/**
 * Loader for the bundled ambience beds (public/ambience/*.wav).
 *
 * These are real public-domain field recordings baked into short seamless loops (see
 * services/ambiencePresets.ts and public/ambience/CREDITS.md). They are same-origin
 * static assets, so there is no external ambience API to rate-limit, no key to leak and
 * no CORS to negotiate. The only failure mode is "the file didn't load", which the
 * engine degrades past silently.
 */

export const bedAssetUrl = (bed: BedId): string => `/ambience/${bed}.wav`;

/**
 * Decoded buffers are cached per (AudioContext, url).
 *
 * An AudioBuffer belongs to the context that decoded it, and the player closes its
 * context on unmount, so a cached buffer from a closed context is not guaranteed to work
 * in a new one. A WeakMap keyed by the context sidesteps that and lets entries be
 * collected along with it.
 */
const cacheByContext = new WeakMap<BaseAudioContext, Map<string, Promise<AudioBuffer | null>>>();

function cacheFor(ctx: BaseAudioContext): Map<string, Promise<AudioBuffer | null>> {
  let cache = cacheByContext.get(ctx);
  if (!cache) {
    cache = new Map();
    cacheByContext.set(ctx, cache);
  }
  return cache;
}

export function loadBed(ctx: BaseAudioContext, bed: BedId): Promise<AudioBuffer | null> {
  const url = bedAssetUrl(bed);
  const cache = cacheFor(ctx);
  let pending = cache.get(url);
  if (!pending) {
    pending = fetch(url)
      .then((res) => {
        if (!res.ok) throw new Error(`Ambience bed fetch failed: ${res.status} ${url}`);
        return res.arrayBuffer();
      })
      .then((arrayBuffer) => ctx.decodeAudioData(arrayBuffer))
      .catch((err) => {
        console.warn(`[Ambience] Bed "${bed}" failed to load; continuing without it.`, err);
        // Drop the rejected entry so a later playback can retry (e.g. once the network
        // is back) instead of caching the failure for the life of the page.
        cache.delete(url);
        return null;
      });
    cache.set(url, pending);
  }
  return pending;
}
