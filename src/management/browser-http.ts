import { createNodeRequestServer } from '../gateway/node-request-server.ts';

export interface ManagementBrowserHttpOptions {
  /** Trusted, bundled PUBLIC JavaScript build artifact; never credentials or user HTML.
   * Own its versioning/build separately. This server neither bundles nor authenticates it.
   */
  readonly javascript: string;
  /** Existing application boundary, with its own fresh authentication and IAM.
   * Receives non-static requests unchanged; no SSO-to-proxy authority is inferred.
   */
  readonly application: (request: Request) => Promise<Response>;
}

const document =
  '<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>OpenGranter management</title></head><body><main id="app" aria-live="polite"><h1>OpenGranter management</h1><p>Loading application. Sign-in and permission checks are required before private data can be shown.</p></main><noscript>JavaScript is required for this management application.</noscript><script type="module" src="/management/app.js"></script></body></html>';
const policy =
  "default-src 'none'; script-src 'self'; connect-src 'self'; style-src 'self'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'; object-src 'none'";

/** Optional static HTTP entry only. The shell is public and contains no identity/data.
 * There is deliberately no SPA fallback, filesystem resolution, cookie or token bridge.
 */
export function createManagementBrowserHandler(options: ManagementBrowserHttpOptions) {
  const { javascript, application } = options;
  return async (request: Request): Promise<Response> => {
    const url = new URL(request.url);
    const script = url.pathname === '/management/app.js';
    if (!script && url.pathname !== '/management' && url.pathname !== '/management/')
      return application(request);

    const headers = new Headers({
      'cache-control': 'no-store',
      'content-security-policy': policy,
      'x-content-type-options': 'nosniff',
      'x-frame-options': 'DENY',
      'referrer-policy': 'no-referrer',
      'permissions-policy': 'camera=(), microphone=(), geolocation=()',
      'content-type': 'text/plain; charset=utf-8',
    });
    function respond(body: string, status: number) {
      return new Response(request.method === 'HEAD' ? null : body, { status, headers });
    }
    if (request.method !== 'GET' && request.method !== 'HEAD') {
      headers.set('allow', 'GET, HEAD');
      return respond('Method not allowed', 405);
    }
    // Node drops GET/HEAD bodies before Fetch adaptation: inspect framing as well.
    const length = request.headers.get('content-length');
    if (
      url.search ||
      request.body !== null ||
      request.headers.has('transfer-encoding') ||
      (length !== null && length !== '0')
    )
      return respond('Invalid request', 400);
    headers.set(
      'content-type',
      script ? 'text/javascript; charset=utf-8' : 'text/html; charset=utf-8',
    );
    return respond(script ? javascript : document, 200);
  };
}

/** Caller owns bind address/TLS/ingress/lifetime; this never starts a listener itself. */
export function createManagementBrowserServer(options: ManagementBrowserHttpOptions) {
  return createNodeRequestServer(createManagementBrowserHandler(options));
}
