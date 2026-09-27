import type { Statement } from '../policy/evaluate.ts';
import type { RouteCandidate } from '../routing/authorize-candidates.ts';
import {
  invokeJevManagedRoute,
  type ManagedRouteAuditEvent,
} from '../routing/invoke-jev-managed-route.ts';
import type { JevFetcher } from '../routing/jev-managed-routing.ts';

const MAX_BODY_BYTES = 1024 * 1024;

export interface ChatMessage {
  readonly role: 'system' | 'user' | 'assistant';
  readonly content: string;
}

export interface ChatRequest {
  readonly model: string;
  readonly messages: readonly ChatMessage[];
}

export interface AuthenticatedPrincipal {
  readonly id: string;
  readonly active: boolean;
  readonly statements: readonly Statement[];
}

export interface ManagedChatRoute {
  readonly version: string;
  readonly candidates: readonly RouteCandidate[];
  readonly jev: {
    readonly credentialRef: string;
    readonly minimumConfidence: number;
    readonly sendPrompt: boolean;
  };
}

export type GatewayAuditEvent =
  | { readonly kind: 'auth-denied'; readonly requestId: string }
  | { readonly kind: 'auth-unavailable'; readonly requestId: string }
  | { readonly kind: 'route-unavailable'; readonly requestId: string; readonly modelAlias: string }
  | {
      readonly kind: 'request-denied';
      readonly requestId: string;
      readonly reason: 'invalid-request' | 'unknown-model' | 'configuration';
      readonly modelAlias?: string;
    };

export interface ChatHandlerPorts<T> {
  readonly newRequestId: () => string;
  readonly authenticate: (proxyToken: string) => Promise<AuthenticatedPrincipal | undefined>;
  readonly resolveRoute: (modelAlias: string) => Promise<ManagedChatRoute | undefined>;
  readonly checkLimit: (principalId: string, requestId: string) => Promise<boolean>;
  readonly resolveSecret: (credentialRef: string) => Promise<string | undefined>;
  readonly writeAudit: (event: GatewayAuditEvent | ManagedRouteAuditEvent) => Promise<void>;
  readonly invokeDirect: (candidate: RouteCandidate, request: ChatRequest) => Promise<T>;
  readonly fetchJev?: JevFetcher;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function validateChat(value: unknown): ChatRequest | undefined {
  if (!isRecord(value)) return undefined;
  if (Object.keys(value).some((key) => !['model', 'messages', 'stream'].includes(key))) {
    return undefined;
  }
  if (value.stream !== undefined && value.stream !== false) return undefined;
  if (typeof value.model !== 'string' || !value.model || !Array.isArray(value.messages)) {
    return undefined;
  }
  if (value.messages.length === 0) return undefined;
  const messages: ChatMessage[] = [];
  let nonSystemSeen = false;
  for (const item of value.messages) {
    if (!isRecord(item) || Object.keys(item).some((key) => !['role', 'content'].includes(key))) {
      return undefined;
    }
    if (item.role !== 'system' && item.role !== 'user' && item.role !== 'assistant') {
      return undefined;
    }
    if (item.role === 'system' && nonSystemSeen) return undefined;
    if (item.role !== 'system') nonSystemSeen = true;
    if (typeof item.content !== 'string') return undefined;
    messages.push({ role: item.role, content: item.content });
  }
  return { model: value.model, messages };
}

async function readJsonBody(request: Request): Promise<unknown> {
  if (!request.headers.get('content-type')?.toLowerCase().startsWith('application/json')) {
    return undefined;
  }
  const reader = request.body?.getReader();
  if (!reader) return undefined;
  const decoder = new TextDecoder();
  let size = 0;
  let body = '';
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.byteLength;
    if (size > MAX_BODY_BYTES) {
      await reader.cancel();
      return undefined;
    }
    body += decoder.decode(value, { stream: true });
  }
  body += decoder.decode();
  try {
    return JSON.parse(body) as unknown;
  } catch {
    return undefined;
  }
}

function errorResponse(status: number, code: string, requestId: string): Response {
  return Response.json(
    { error: { code }, request_id: requestId },
    { status, headers: { 'x-request-id': requestId } },
  );
}

/** A text-only, non-streaming HTTP request boundary with injected trusted infrastructure. */
export function createChatHandler<T>(
  ports: ChatHandlerPorts<T>,
): (request: Request) => Promise<Response> {
  return async (request) => {
    const requestId = ports.newRequestId();
    if (request.method !== 'POST' || new URL(request.url).pathname !== '/v1/chat/completions') {
      return errorResponse(404, 'not_found', requestId);
    }

    const authorization = request.headers.get('authorization');
    const token = /^Bearer ([^\s]+)$/iu.exec(authorization ?? '')?.[1];
    let principal: AuthenticatedPrincipal | undefined;
    if (token) {
      try {
        principal = await ports.authenticate(token);
      } catch {
        try {
          await ports.writeAudit({ kind: 'auth-unavailable', requestId });
        } catch {
          return errorResponse(503, 'audit_unavailable', requestId);
        }
        return errorResponse(503, 'authentication_unavailable', requestId);
      }
    }
    if (!principal?.active) {
      try {
        await ports.writeAudit({ kind: 'auth-denied', requestId });
      } catch {
        return errorResponse(503, 'audit_unavailable', requestId);
      }
      return errorResponse(401, 'unauthorized', requestId);
    }

    const chat = validateChat(await readJsonBody(request).catch(() => undefined));
    if (!chat) {
      try {
        await ports.writeAudit({ kind: 'request-denied', requestId, reason: 'invalid-request' });
      } catch {
        return errorResponse(503, 'audit_unavailable', requestId);
      }
      return errorResponse(400, 'invalid_request', requestId);
    }

    let route: ManagedChatRoute | undefined;
    try {
      route = await ports.resolveRoute(chat.model);
    } catch {
      try {
        await ports.writeAudit({ kind: 'route-unavailable', requestId, modelAlias: chat.model });
      } catch {
        return errorResponse(503, 'audit_unavailable', requestId);
      }
      return errorResponse(503, 'route_unavailable', requestId);
    }
    if (!route) {
      try {
        await ports.writeAudit({
          kind: 'request-denied',
          requestId,
          reason: 'unknown-model',
          modelAlias: chat.model,
        });
      } catch {
        return errorResponse(503, 'audit_unavailable', requestId);
      }
      return errorResponse(404, 'unknown_model', requestId);
    }

    try {
      const result = await invokeJevManagedRoute({
        requestId,
        routeVersion: route.version,
        principalActive: principal.active,
        modelAlias: chat.model,
        candidates: route.candidates,
        statements: principal.statements,
        jev: route.jev,
        ...(route.jev.sendPrompt
          ? {
              promptText: chat.messages
                .map((message) => `${message.role}: ${message.content}`)
                .join('\n'),
            }
          : {}),
        ports: {
          checkLimit: () => ports.checkLimit(principal.id, requestId),
          resolveSecret: ports.resolveSecret,
          writeAudit: ports.writeAudit,
          invokeDirect: (candidate) => ports.invokeDirect(candidate, chat),
          ...(ports.fetchJev ? { fetchJev: ports.fetchJev } : {}),
        },
      });
      if (result.status === 'invoked') {
        return Response.json(result.response, {
          status: 200,
          headers: { 'x-request-id': requestId },
        });
      }
      if (result.status === 'denied') {
        if (result.reason === 'limit') return errorResponse(429, 'limit_exceeded', requestId);
        if (result.reason === 'secret-unavailable') {
          return errorResponse(503, 'credential_unavailable', requestId);
        }
        return errorResponse(403, 'forbidden', requestId);
      }
      if (result.reason === 'provider-failed')
        return errorResponse(502, 'upstream_failed', requestId);
      return errorResponse(503, 'audit_unavailable', requestId);
    } catch {
      try {
        await ports.writeAudit({
          kind: 'request-denied',
          requestId,
          reason: 'configuration',
          modelAlias: chat.model,
        });
      } catch {
        return errorResponse(503, 'audit_unavailable', requestId);
      }
      return errorResponse(503, 'route_unavailable', requestId);
    }
  };
}
