/**
 * Shared stats fetching for the panels.
 *
 * Two defects this exists to prevent, both found by reviewing OmegaPanel and
 * SingularityPanel against the live API (docs/review/omega-singularity-panel-review.md):
 *
 * 1. The API wraps its payload in `stats`. Panels were storing the envelope and
 *    reading fields off its root, so `uptime` rendered as `NaNs` and every
 *    detail section was silently skipped. `version` happened to exist at both
 *    levels, which made the panels look connected while nothing else worked.
 *
 * 2. `.catch(() => {})` made a dead API indistinguishable from a working one.
 *    A swallowed error is the UI version of trusting that `write()` returning
 *    success means the bytes are on disk.
 *
 * So: unwrap explicitly, check `res.ok` explicitly, and return the failure
 * instead of hiding it. Callers must render the error, never discard it.
 */

/** Unwrap `{ ok, version, stats: {...} }`, tolerating an already-unwrapped body. */
export function unwrapStats(body) {
  if (body && typeof body === 'object' && body.stats && typeof body.stats === 'object') {
    return body.stats;
  }
  return body;
}

/**
 * @returns {Promise<{ok: true, stats: object} | {ok: false, error: string}>}
 * Never throws, and never resolves to a value that hides a failure.
 */
export async function fetchStats(path) {
  let response;
  try {
    response = await fetch(path);
  } catch (error) {
    return { ok: false, error: `network error: ${error.message}` };
  }
  if (!response.ok) {
    return { ok: false, error: `HTTP ${response.status} ${response.statusText || ''}`.trim() };
  }
  let body;
  try {
    body = await response.json();
  } catch (error) {
    return { ok: false, error: `invalid JSON from ${path}: ${error.message}` };
  }
  const stats = unwrapStats(body);
  if (!stats || typeof stats !== 'object') {
    return { ok: false, error: `unexpected response shape from ${path}` };
  }
  return { ok: true, stats };
}
