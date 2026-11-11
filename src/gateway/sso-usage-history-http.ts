import { type ClientErrorCode, createClientErrorResponse } from './client-errors.ts';
import type { createPostgresSsoUsageHistory } from './postgres-sso-usage-history.ts';

export interface SsoUsageHistoryHttpPorts {
  readonly newRequestId: () => string;
  /** Trusted server composition with fresh authentication and mandatory durable audit. */
  readonly history: ReturnType<typeof createPostgresSsoUsageHistory>;
}
function privateResponse(response: Response): Response {
  response.headers.set('cache-control', 'no-store');
  response.headers.set('x-content-type-options', 'nosniff');
  return response;
}
function failure(status: number, code: ClientErrorCode, requestId?: string): Response {
  const response = privateResponse(createClientErrorResponse(status, code, requestId));
  if (status === 401) response.headers.set('www-authenticate', 'Bearer');
  return response;
}
/** Unactivated Fetch adapter; no cookie/session issuance, listener or runtime mount. */
export function createSsoUsageHistoryHandler(ports: SsoUsageHistoryHttpPorts) {
  const { history, newRequestId } = ports;
  return async (request: Request): Promise<Response> => {
    let requestId: string | undefined;
    try {
      requestId = newRequestId();
      const url = new URL(request.url);
      if (url.pathname !== '/management/v1/usage') return failure(404, 'not_found', requestId);
      // Node omits GET bodies during Fetch adaptation; validate original framing too.
      const length = request.headers.get('content-length');
      if (
        request.method !== 'GET' ||
        request.body !== null ||
        request.signal.aborted ||
        request.headers.has('transfer-encoding') ||
        (length !== null && length !== '0')
      )
        return failure(400, 'invalid_request', requestId);
      const token = /^Bearer ([^\s,]+)$/iu.exec(request.headers.get('authorization') ?? '')?.[1];
      const result = await history.read(token ?? '', requestId, url.search);
      if (request.signal.aborted) return failure(400, 'invalid_request', requestId);
      switch (result.state) {
        case 'unauthenticated':
          return failure(401, 'unauthorized', requestId);
        case 'invalid_query':
          return failure(400, 'invalid_request', requestId);
        case 'forbidden':
          return failure(403, 'forbidden', requestId);
        case 'unavailable':
          return failure(503, 'usage_unavailable', requestId);
        case 'audit_unavailable':
          return failure(503, 'audit_unavailable', requestId);
        case 'ready': {
          if (!token) return failure(503, 'internal_error', requestId);
          if (result.format === 'csv')
            return privateResponse(
              new Response(result.csv, {
                headers: {
                  'content-type': 'text/csv; charset=utf-8',
                  'content-disposition': 'attachment; filename="usage.csv"',
                  'x-request-id': requestId,
                  'x-has-more': String(result.hasMore),
                  ...(result.nextCursor === null ? {} : { 'x-next-cursor': result.nextCursor }),
                },
              }),
            );
          return privateResponse(
            Response.json(
              {
                object: 'list',
                data: result.data,
                has_more: result.hasMore,
                next_cursor: result.nextCursor,
              },
              { headers: { 'x-request-id': requestId } },
            ),
          );
        }
        default:
          return failure(503, 'internal_error', requestId);
      }
    } catch {
      return failure(503, 'internal_error', requestId);
    }
  };
}
