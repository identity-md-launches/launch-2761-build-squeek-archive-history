// Network access: the Squeekchain API and raw eth_call with endpoint failover.

export const API_BASE = 'https://api.squeekchain.com/v1';
export const ENDPOINTS = Object.freeze({
  economy: `${API_BASE}/economy/state`,
  events: `${API_BASE}/events`,
  status: `${API_BASE}/status`,
});
/** CORS-enabled Sepolia endpoints, tried in order. rpc.sepolia.org sends no CORS header. */
export const RPC_URLS = Object.freeze(['https://ethereum-sepolia-rpc.publicnode.com', 'https://sepolia.drpc.org']);
export const EVENTS_PAGE_SIZE = 100;

/**
 * GET JSON with a timeout. Throws with the HTTP status on failure.
 * @param {string} url
 * @param {number} [timeoutMs]
 */
export async function getJson(url, timeoutMs = 20000) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const res = await fetch(url, { signal: ctrl.signal, headers: { accept: 'application/json' } });
    if (!res.ok) throw new Error(`HTTP ${res.status} from ${new URL(url).pathname}`);
    return await res.json();
  } catch (err) {
    if (err instanceof Error && err.name === 'AbortError') throw new Error(`Timed out after ${timeoutMs / 1000} s`);
    throw err;
  } finally {
    clearTimeout(timer);
  }
}

/** The contract answered with a revert: a final answer, so no failover. */
export class RevertError extends Error {}

/**
 * eth_call against each RPC in order until one answers.
 * @param {string} to
 * @param {string} data
 * @returns {Promise<{result: string, endpoint: string, ms: number}>}
 */
export async function ethCall(to, data) {
  /** @type {string[]} */
  const errors = [];
  for (const endpoint of RPC_URLS) {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), 20000);
    const started = performance.now();
    try {
      const res = await fetch(endpoint, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'eth_call', params: [{ to, data }, 'latest'] }),
        signal: ctrl.signal,
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const body = await res.json();
      const ms = performance.now() - started;
      if (body.error) {
        const text = String(body.error.message || 'RPC error');
        if (/revert/i.test(text)) throw new RevertError(text);
        throw new Error(text);
      }
      if (typeof body.result !== 'string') throw new Error('No result');
      return { result: body.result, endpoint, ms };
    } catch (err) {
      if (err instanceof RevertError) throw err;
      errors.push(`${new URL(endpoint).host}: ${err instanceof Error ? (err.name === 'AbortError' ? 'timed out' : err.message) : String(err)}`);
    } finally {
      clearTimeout(timer);
    }
  }
  throw new Error(errors.join('; '));
}

/**
 * URL for one page of the feed. The cursor is opaque base64 and must be encoded.
 * @param {string | null} cursor
 */
export function eventsUrl(cursor) {
  return `${ENDPOINTS.events}?limit=${EVENTS_PAGE_SIZE}${cursor ? `&cursor=${encodeURIComponent(cursor)}` : ''}`;
}
