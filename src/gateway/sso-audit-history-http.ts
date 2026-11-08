import type { Server } from 'node:http';
import { parseAuditHistoryQuery, projectAuditHistoryPage } from '../audit/history-http.ts';
import { type ClientErrorCode, createClientErrorResponse } from './client-errors.ts';
import { createNodeRequestServer } from './node-request-server.ts';
import type { createPostgresSsoAuditHistory } from './postgres-sso-audit-history.ts';

export interface SsoAuditHistoryHttpPorts {
  readonly newRequestId: () => string;
  /** Trusted registered-key SSO + fresh IAM + mandatory awaited durable audit. */
  readonly audit: ReturnType<typeof createPostgresSsoAuditHistory>;
}
function noStore(response: Response): Response {
  response.headers.set('cache-control', 'no-store');
  response.headers.set('x-content-type-options', 'nosniff');
  return response;
}
function failure(status: number, code: ClientErrorCode, requestId?: string): Response {
  const response = noStore(createClientErrorResponse(status, code, requestId));
  if (status === 401) response.headers.set('www-authenticate', 'Bearer');
  return response;
}
/** Explicit Bearer-only metadata read/export factory. No automatic mount or cookies. */
export function createSsoAuditHistoryHandler(
  ports: SsoAuditHistoryHttpPorts,
): (request: Request) => Promise<Response> {
  const { newRequestId } = ports;
  const { read } = ports.audit;
  return async (request) => {
    let requestId: string | undefined;
    try {
      const url = new URL(request.url);
      if (request.method !== 'GET' || url.pathname !== '/management/v1/audit')
        return failure(404, 'not_found');
      const generatedId = newRequestId();
      if (
        typeof generatedId !== 'string' ||
        generatedId.length > 256 ||
        !/^[A-Za-z0-9][A-Za-z0-9._+:/@-]*$/u.test(generatedId)
      )
        return failure(503, 'internal_error');
      requestId = generatedId;
      const length = request.headers.get('content-length');
      if (
        request.signal.aborted ||
        url.search.length > 8192 ||
        request.body !== null ||
        request.headers.has('transfer-encoding') ||
        (length !== null && length !== '0')
      )
        return failure(400, 'invalid_request', requestId);
      const token = /^Bearer ([^\s,]+)$/iu.exec(request.headers.get('authorization') ?? '')?.[1];
      const result = await read(token ?? '', requestId, url.search);
      if (request.signal.aborted) return failure(400, 'invalid_request', requestId);
      switch (result.state) {
        case 'unauthenticated':
          return failure(401, 'unauthorized', requestId);
        case 'forbidden':
          return failure(403, 'forbidden', requestId);
        case 'invalid_query':
          return failure(400, 'invalid_request', requestId);
        case 'unavailable':
          return failure(503, 'audit_unavailable', requestId);
        case 'audit_unavailable':
          return failure(503, 'audit_unavailable', requestId);
        case 'ready': {
          if (!token) return failure(503, 'internal_error', requestId);
          const query = parseAuditHistoryQuery(url);
          if (result.format !== query.format) return failure(503, 'internal_error', requestId);
          const headers = new Headers({ 'x-request-id': requestId });
          let nextCursor: string | null;
          let response: Response;
          if (result.format === 'json') {
            const target = query.requestedPrincipalId ?? result.page.events[0]?.principalId ?? '';
            const page = projectAuditHistoryPage(
              result.page,
              target,
              query.limit,
              query.cursor,
              query,
            );
            nextCursor = page.nextCursor;
            response = Response.json(
              { object: 'list', data: page.events, next_cursor: nextCursor },
              { headers },
            );
          } else {
            if (typeof result.csv !== 'string') return failure(503, 'internal_error', requestId);
            nextCursor = result.nextCursor;
            headers.set('content-type', 'text/csv; charset=utf-8');
            headers.set('content-disposition', 'attachment; filename="audit.csv"');
            response = new Response(result.csv, { headers });
          }
          if (nextCursor !== null) {
            // Validate only; retain the exact decimal server cursor, never increment it.
            parseAuditHistoryQuery(
              new URL(`https://management.invalid/?cursor=${encodeURIComponent(nextCursor)}`),
            );
            response.headers.set('x-audit-next-cursor', nextCursor);
          }
          response.headers.set('x-audit-has-more', String(nextCursor !== null));
          return noStore(response);
        }
        default:
          return failure(503, 'internal_error', requestId);
      }
    } catch {
      return failure(503, 'internal_error', requestId);
    }
  };
}
/** Unbound server; deployment owns TLS, approved durable audit and lifecycle. */
export function createSsoAuditHistoryServer(ports: SsoAuditHistoryHttpPorts): Server {
  return createNodeRequestServer(createSsoAuditHistoryHandler(ports), () =>
    failure(503, 'internal_error'),
  );
}
