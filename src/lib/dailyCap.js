// Per-visitor daily soft cap, same approach as Market Entry Dossier.
// NOTE: this is a client-side UX deterrent only, not real security — anyone
// can clear localStorage or use a private window to bypass it. It spreads
// the free tier's 20 requests/day (whole project) across visitors; it is not
// cost control. Storage is injectable so the logic is unit-testable.

export const CAP_KEY = "ca_generation_timestamps";
export const CAP_MAX = 2;
export const CAP_WINDOW_MS = 24 * 60 * 60 * 1000;

function safeStorage(storage) {
  if (storage) return storage;
  try {
    return window.localStorage;
  } catch {
    return null; // private mode or blocked storage: cap simply doesn't apply
  }
}

export function recentGenerations(now = Date.now(), storage) {
  const s = safeStorage(storage);
  if (!s) return [];
  let raw;
  try {
    raw = JSON.parse(s.getItem(CAP_KEY) || "[]");
  } catch {
    raw = [];
  }
  const cutoff = now - CAP_WINDOW_MS;
  return Array.isArray(raw) ? raw.filter((t) => typeof t === "number" && t > cutoff && t <= now) : [];
}

export function remainingGenerations(now = Date.now(), storage) {
  return Math.max(0, CAP_MAX - recentGenerations(now, storage).length);
}

export function recordGeneration(now = Date.now(), storage) {
  const s = safeStorage(storage);
  if (!s) return;
  const recent = recentGenerations(now, storage);
  recent.push(now);
  try {
    s.setItem(CAP_KEY, JSON.stringify(recent));
  } catch {
    // storage full or blocked: nothing to do
  }
}
