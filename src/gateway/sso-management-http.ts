import type { Server } from 'node:http';
import { SsoManagementUnauthenticated } from '../identity/postgres-sso-human-authentication.ts';
import { type ClientErrorCode, createClientErrorResponse } from './client-errors.ts';
import { createNodeRequestServer } from './node-request-server.ts';
import {
  InvalidTokenManagementInput,
  InvalidTokenManagementLifetime,
  TokenManagementDenied,
} from './token-management.ts';

export interface ManagementAuthenticationAuditEvent {
  readonly kind: 'management-auth-denied' | 'management-auth-unavailable';
  readonly operation: 'issue' | 'revoke';
  readonly requestId: string;
}
export interface SsoManagementHttpPorts {
  readonly newRequestId: () => string;
  readonly authenticate: (accessToken: string) => Promise<string>;
  readonly issue: (input: {
    readonly authenticatedActorId: string;
    readonly requestId: string;
    readonly principalId: string;
    readonly expiresAt: number;
  }) => Promise<{ readonly credentialId: string; readonly token: string }>;
  readonly revoke: (input: {
    readonly authenticatedActorId: string;
    readonly requestId: string;
    readonly credentialId: string;
  }) => Promise<boolean>;
  readonly writeAudit: (event: ManagementAuthenticationAuditEvent) => Promise<void>;
}
function opaque(value: unknown, maximum = 256): value is string {
  if (typeof value !== 'string' || !value.length || value.length > maximum || value.includes('\0'))
    return false;
  for (const character of value) {
    const code = character.charCodeAt(0);
    if (character.length === 1 && code >= 0xd800 && code <= 0xdfff) return false;
  }
  return true;
}
function noStore(response: Response): Response {
  response.headers.set('cache-control', 'no-store');
  return response;
}
function failure(status: number, code: ClientErrorCode, requestId?: string): Response {
  const response = noStore(createClientErrorResponse(status, code, requestId));
  if (status === 401) response.headers.set('www-authenticate', 'Bearer');
  return response;
}
function record(value: unknown, fields: readonly string[]): Record<string, unknown> | undefined {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return undefined;
  if (
    Object.keys(value).length !== fields.length ||
    fields.some((field) => !Object.hasOwn(value, field))
  )
    return undefined;
  return value as Record<string, unknown>;
}
async function readBody(request: Request): Promise<unknown> {
  if (
    request.headers.get('content-type')?.split(';')[0]?.trim().toLowerCase() !== 'application/json'
  )
    return undefined;
  let reader: ReadableStreamDefaultReader<Uint8Array> | undefined;
  try {
    reader = request.body?.getReader();
  } catch {
    return undefined;
  }
  if (!reader) return undefined;
  const cancel = () => {
    void reader.cancel().catch(() => undefined);
  };
  request.signal.addEventListener('abort', cancel, { once: true });
  let complete = false;
  let parsed: unknown;
  try {
    let size = 0;
    let text = '';
    const decoder = new TextDecoder('utf-8', { fatal: true });
    while (!request.signal.aborted) {
      const { done, value } = await reader.read();
      if (done) {
        complete = true;
        break;
      }
      size += value.byteLength;
      if (size > 16384) return undefined;
      text += decoder.decode(value, { stream: true });
    }
    if (request.signal.aborted) return undefined;
    text += decoder.decode();
    parsed = JSON.parse(text) as unknown;
  } catch {
    parsed = undefined;
  } finally {
    request.signal.removeEventListener('abort', cancel);
    if (!complete) await reader.cancel().catch(() => undefined);
    reader.releaseLock();
  }
  return parsed;
}

/** Public human-only management boundary; authentication precedes all body access. */
export function createSsoManagementHandler(
  ports: SsoManagementHttpPorts,
): (request: Request) => Promise<Response> {
  const { newRequestId, authenticate, issue, revoke, writeAudit } = ports;
  return async (request) => {
    let requestId: string | undefined;
    try {
      const url = new URL(request.url);
      const operation =
        url.pathname === '/management/v1/proxy-tokens'
          ? 'issue'
          : url.pathname === '/management/v1/proxy-tokens/revoke'
            ? 'revoke'
            : undefined;
      if (request.method !== 'POST' || !operation) return failure(404, 'not_found');
      const generatedId = newRequestId();
      if (
        typeof generatedId !== 'string' ||
        generatedId.length > 256 ||
        !/^[A-Za-z0-9][A-Za-z0-9._+:/@-]*$/u.test(generatedId)
      )
        return failure(503, 'internal_error');
      requestId = generatedId;
      if (request.signal.aborted) return failure(400, 'invalid_request', requestId);
      const accessToken = /^Bearer ([^\s,]+)$/iu.exec(
        request.headers.get('authorization') ?? '',
      )?.[1];
      let authenticatedActorId: string;
      try {
        if (!accessToken) throw new SsoManagementUnauthenticated();
        authenticatedActorId = await authenticate(accessToken);
        if (!opaque(authenticatedActorId)) throw new Error();
      } catch (error) {
        const denied = error instanceof SsoManagementUnauthenticated;
        try {
          await writeAudit(
            Object.freeze({
              kind: denied ? 'management-auth-denied' : 'management-auth-unavailable',
              operation,
              requestId,
            }),
          );
        } catch {
          return failure(503, 'audit_unavailable', requestId);
        }
        return failure(
          denied ? 401 : 503,
          denied ? 'unauthorized' : 'authentication_unavailable',
          requestId,
        );
      }
      if (request.signal.aborted) return failure(400, 'invalid_request', requestId);
      if (url.search) return failure(400, 'invalid_request', requestId);
      const value = await readBody(request);
      if (request.signal.aborted) return failure(400, 'invalid_request', requestId);
      if (operation === 'issue') {
        const body = record(value, ['principalId', 'expiresAt']);
        if (
          !body ||
          !opaque(body.principalId) ||
          typeof body.expiresAt !== 'number' ||
          !Number.isSafeInteger(body.expiresAt) ||
          body.expiresAt < 0
        )
          return failure(400, 'invalid_request', requestId);
        try {
          const result = await issue({
            authenticatedActorId,
            requestId,
            principalId: body.principalId,
            expiresAt: body.expiresAt,
          });
          const { credentialId, token } = result;
          if (!opaque(credentialId) || !opaque(token, 16384))
            return failure(503, 'internal_error', requestId);
          return noStore(
            Response.json(
              { credentialId, token },
              { status: 201, headers: { 'x-request-id': requestId } },
            ),
          );
        } catch (error) {
          if (error instanceof TokenManagementDenied) return failure(403, 'forbidden', requestId);
          if (
            error instanceof InvalidTokenManagementLifetime ||
            error instanceof InvalidTokenManagementInput
          )
            return failure(400, 'invalid_request', requestId);
          return failure(503, 'internal_error', requestId);
        }
      }
      const body = record(value, ['credentialId']);
      if (!body || !opaque(body.credentialId)) return failure(400, 'invalid_request', requestId);
      try {
        const revoked = await revoke({
          authenticatedActorId,
          requestId,
          credentialId: body.credentialId,
        });
        if (typeof revoked !== 'boolean') return failure(503, 'internal_error', requestId);
        return noStore(Response.json({ revoked }, { headers: { 'x-request-id': requestId } }));
      } catch (error) {
        if (error instanceof TokenManagementDenied) return failure(403, 'forbidden', requestId);
        if (error instanceof InvalidTokenManagementInput)
          return failure(400, 'invalid_request', requestId);
        return failure(503, 'internal_error', requestId);
      }
    } catch {
      return failure(503, 'internal_error', requestId);
    }
  };
}

/** The caller owns listening, deployment routing and database lifetime. */
export function createSsoManagementServer(ports: SsoManagementHttpPorts): Server {
  return createNodeRequestServer(createSsoManagementHandler(ports), () =>
    failure(503, 'internal_error'),
  );
}
