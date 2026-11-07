import type { Server } from 'node:http';
import { SsoManagementUnauthenticated } from '../identity/postgres-sso-human-authentication.ts';
import { type ClientErrorCode, createClientErrorResponse } from './client-errors.ts';
import { createNodeRequestServer } from './node-request-server.ts';

export type CurrentPrincipalAuditEvent = {
  readonly requestId: string;
} & (
  | { readonly outcome: 'ready'; readonly principalId: string }
  | { readonly outcome: 'unauthenticated' | 'unavailable'; readonly principalId: null }
);
export interface SsoCurrentPrincipalHttpPorts {
  readonly newRequestId: () => string;
  /** Trusted fresh registered-key authentication plus exact active-human binding. */
  readonly authenticate: (accessToken: string) => Promise<string>;
  /** REQUIRED durable nonsecret append. Must resolve only after persistence. */
  readonly writeAudit: (event: CurrentPrincipalAuditEvent) => Promise<void>;
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
function principalIdentifier(value: unknown): value is string {
  return (
    typeof value === 'string' &&
    value.length > 0 &&
    value.length <= 256 &&
    !Array.from(value).some((character) => {
      const code = character.charCodeAt(0);
      return (
        code < 32 ||
        (code >= 127 && code <= 159) ||
        (character.length === 1 && code >= 0xd800 && code <= 0xdfff)
      );
    })
  );
}
/** Opt-in identity read only: not a session, policy grant or runtime mount. */
export function createSsoCurrentPrincipalHandler(ports: SsoCurrentPrincipalHttpPorts) {
  const { authenticate, newRequestId, writeAudit } = ports;
  if ([authenticate, newRequestId, writeAudit].some((port) => typeof port !== 'function'))
    throw new TypeError('Invalid current principal HTTP configuration');
  return async (request: Request): Promise<Response> => {
    let requestId: string | undefined;
    try {
      const url = new URL(request.url);
      if (request.method !== 'GET' || url.pathname !== '/management/v1/principal')
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
        url.search ||
        request.body !== null ||
        request.headers.has('transfer-encoding') ||
        (length !== null && length !== '0')
      )
        return failure(400, 'invalid_request', requestId);
      const token = /^Bearer ([^\s,]+)$/iu.exec(request.headers.get('authorization') ?? '')?.[1];
      let event: CurrentPrincipalAuditEvent;
      try {
        const principalId = await authenticate(token ?? '');
        if (!token || !principalIdentifier(principalId)) throw new Error();
        event = Object.freeze({ requestId, outcome: 'ready', principalId });
      } catch (error) {
        event = Object.freeze({
          requestId,
          outcome:
            error instanceof SsoManagementUnauthenticated ? 'unauthenticated' : 'unavailable',
          principalId: null,
        });
      }
      try {
        await writeAudit(event);
      } catch {
        return failure(503, 'audit_unavailable', requestId);
      }
      if (request.signal.aborted) return failure(400, 'invalid_request', requestId);
      if (event.outcome === 'unauthenticated') return failure(401, 'unauthorized', requestId);
      if (event.outcome === 'unavailable')
        return failure(503, 'authentication_unavailable', requestId);
      return noStore(
        Response.json(
          { id: event.principalId, kind: 'human' },
          {
            headers: { 'x-request-id': requestId },
          },
        ),
      );
    } catch {
      return failure(503, 'internal_error', requestId);
    }
  };
}
/** Unbound server: caller owns listening, ingress, durable audit and database lifetime. */
export function createSsoCurrentPrincipalServer(ports: SsoCurrentPrincipalHttpPorts): Server {
  return createNodeRequestServer(createSsoCurrentPrincipalHandler(ports), () =>
    failure(503, 'internal_error'),
  );
}
