import type { StemId } from './ambiencePresets';

/**
 * Loader for the bundled ambience stems (public/ambience/*.wav).
 *
 * These are same-origin static assets, so there is no external ambience API to
 * rate-limit, no key to leak and no CORS to negotiate. The only failure mode is "the
 * file didn't load", which the engine degrades past silently.
 *
 * Changed from the previous version, which resolved exactly one bed per
 * EnvironmentProfile: a scene now mixes several stems, so this resolves N at once.
 */

export const stemAssetUrl = (stem: StemId): string => `/ambience/${stem}.wav`;

/**
 * Decoded buffers are cached per (AudioContext, url).
 *
 * Keying by url alone — as the previous version did — is a latent bug: an AudioBuffer
 * belongs to the context that decoded it, and the player closes its context on
 * unmount. A cached buffer from a closed context is not guaranteed to work in a new
 * one. A WeakMap keyed by the context sidesteps that and lets entries be collected
 * along with it.
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

export function loadStem(ctx: BaseAudioContext, stem: StemId): Promise<AudioBuffer | null> {
  const url = stemAssetUrl(stem);
  const cache = cacheFor(ctx);
  let pending = cache.get(url);
  if (!pending) {
    pending = fetch(url)
      .then((res) => {
        if (!res.ok) throw new Error(`Ambience stem fetch failed: ${res.status} ${url}`);
        return res.arrayBuffer();
      })
      .then((arrayBuffer) => ctx.decodeAudioData(arrayBuffer))
      .catch((err) => {
        console.warn(`[Ambience] Stem "${stem}" failed to load; continuing without it.`, err);
        // Drop the rejected entry so a later playback can retry (e.g. once the network
        // is back) instead of caching the failure for the life of the page.
        cache.delete(url);
        return null;
      });
    cache.set(url, pending);
  }
  return pending;
}

/** Load several stems at once. Individual failures resolve to `null`, never reject. */
export function loadStems(ctx: BaseAudioContext, stems: StemId[]): Promise<Array<AudioBuffer | null>> {
  return Promise.all(stems.map((stem) => loadStem(ctx, stem)));
}
