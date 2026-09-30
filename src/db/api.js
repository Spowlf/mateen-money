// Talking to the backend. Throws OfflineError when it can't be reached (nothing was saved),
// and ApiError with the server's own message when it refused.

import { OfflineError, ApiError } from '../errors.js';

const TIMEOUT_MS = 15000;

/** connection() returns { apiBase, token }; fetch is injectable for tests. */
export function createApi({ fetch = (...a) => globalThis.fetch(...a), connection }) {
  async function request(method, path, body) {
    const { apiBase, token } = connection() ?? {};
    if (!apiBase || !token) throw new ApiError(0, 'Connect to your backend in Settings.');
    const headers = { Authorization: `Bearer ${token}` };
    if (body !== undefined) headers['Content-Type'] = 'application/json';
    let res;
    try {
      res = await fetch(`${apiBase.replace(/\/+$/, '')}${path}`, {
        method,
        headers,
        body: body === undefined ? undefined : JSON.stringify(body),
        signal: AbortSignal.timeout(TIMEOUT_MS),
      });
    } catch {
      throw new OfflineError();
    }
    const type = res.headers.get('Content-Type') ?? '';
    const data = type.includes('json') ? await res.json().catch(() => null) : await res.text().catch(() => '');
    if (!res.ok) {
      const message = (typeof data === 'string' ? data : data?.error) || `Nothing changed: the backend answered ${res.status}.`;
      throw new ApiError(res.status, message);
    }
    return data;
  }

  return {
    get: (path) => request('GET', path),
    put: (path, body) => request('PUT', path, body),
    post: (path, body) => request('POST', path, body),
    del: (path) => request('DELETE', path),
  };
}
