import type { CatalogRequest } from './catalog-client.ts';

export interface SsoManagementRequestOptions {
  /** Already-approved API-specific SSO access token; NOT a proxy token or ID token. */
  readonly accessToken: string;
  /** Trusted session expiry, not decoded or inferred by this adapter. */
  readonly expiresAt: number;
  /** Trusted same-origin browser fetch port; must honor Fetch abort/mode semantics. */
  readonly request: CatalogRequest;
  readonly now?: () => number;
}

function failure() {
  return new Error('Management transport unavailable');
}
function controls(value: string): boolean {
  return [...value].some((char) => char.charCodeAt(0) < 32 || char.charCodeAt(0) === 127);
}
function permitted(path: string, method: string): boolean {
  if (typeof path !== 'string' || /[\s\\#]/u.test(path) || controls(path)) return false;
  const url = new URL(path, 'https://management.invalid');
  const raw = path.split('?')[0];
  if (url.origin !== 'https://management.invalid' || url.pathname !== raw) return false;
  if (method === 'POST')
    return (
      !url.search &&
      !path.includes('?') &&
      (raw === '/management/v1/proxy-tokens' || raw === '/management/v1/proxy-tokens/revoke')
    );
  if (method !== 'GET') return false;
  if (
    [
      '/management/v1/principal',
      '/management/v1/me',
      '/management/v1/models',
      '/management/v1/usage',
      '/management/v1/audit',
    ].includes(raw ?? '')
  )
    return true;
  const match = /^\/management\/v1\/models\/([^/]+)$/u.exec(raw ?? '');
  if (!match?.[1]) return false;
  const id = decodeURIComponent(match[1]);
  return id.length > 0 && !controls(id) && !id.includes(String.fromCharCode(92));
}
function discard(response: Response) {
  try {
    void response.body?.cancel().catch(() => undefined);
  } catch {
    /* Best effort. */
  }
}

/** Opt-in credential forwarding only, never login/session/IAM authority.
 * Host must dispose on logout, known expiry or identity change. No storage,
 * refresh, global fetch, cookies, redirects, retries or entry activation.
 * Cancellation cannot roll back an accepted mutation or revoke an issued token.
 */
export function createSsoManagementRequest(options: SsoManagementRequestOptions) {
  let token = options.accessToken;
  const { expiresAt, request: fetchRequest, now = Date.now } = options;
  const lifetime = new AbortController();
  function dispose() {
    token = '';
    lifetime.abort();
  }
  function active() {
    let time: number;
    try {
      time = now();
    } catch {
      dispose();
      return false;
    }
    if (lifetime.signal.aborted || !Number.isFinite(time) || time < 0 || time >= expiresAt) {
      dispose();
      return false;
    }
    return true;
  }
  if (
    typeof token !== 'string' ||
    !/^[A-Za-z0-9._~+/-]+=*$/u.test(token) ||
    token.length > 16384 ||
    !Number.isSafeInteger(expiresAt) ||
    expiresAt < 0 ||
    !active()
  ) {
    dispose();
    throw failure();
  }
  const request: CatalogRequest = async (path, init) => {
    try {
      const method = init.method ?? 'GET';
      if (
        !active() ||
        init.signal?.aborted ||
        !permitted(path, method) ||
        (method === 'GET' && init.body != null)
      )
        throw failure();
      const headers = new Headers(init.headers);
      for (const name of headers.keys()) {
        if (name !== 'accept' && name !== 'content-type') throw failure();
      }
      headers.set('authorization', `Bearer ${token}`);
      const signal = init.signal
        ? AbortSignal.any([lifetime.signal, init.signal])
        : lifetime.signal;
      const response = await fetchRequest(path, {
        method,
        headers,
        signal,
        ...(method === 'POST' && init.body != null ? { body: init.body } : {}),
        mode: 'same-origin',
        credentials: 'omit',
        cache: 'no-store',
        redirect: 'error',
      });
      if (!active() || signal.aborted) {
        discard(response);
        throw failure();
      }
      // Do not turn a fresh server Deny/failure into a synthetic browser success.
      return response;
    } catch {
      throw failure();
    }
  };
  return Object.freeze({ request, dispose });
}
