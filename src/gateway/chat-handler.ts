import { type AuditAttribution, validAuditAttribution } from '../audit/attribution.ts';
import { serializeAuditCsv } from '../audit/csv.ts';
import { parseAuditHistoryQuery, projectAuditHistoryPage } from '../audit/history-http.ts';
import type { AuditHistoryPage, AuditHistoryQuery } from '../audit/postgres-audit-history.ts';
import type { Statement } from '../policy/evaluate.ts';
import { evaluate } from '../policy/evaluate.ts';
import type { PolicyVersion } from '../policy/evaluate-attachments.ts';
import type { OpenRouterChatAttempt } from '../providers/openrouter-chat.ts';
import {
  authorizeCandidates,
  type RouteCandidate,
  type RouteKind,
} from '../routing/authorize-candidates.ts';
import {
  type DelegatedRouteAuditEvent,
  invokeDelegatedRoute,
} from '../routing/invoke-delegated-route.ts';
import {
  invokeManagedRoute,
  type ManagedRouteAuditEvent,
} from '../routing/invoke-jev-managed-route.ts';
import type { JevFetcher } from '../routing/jev-managed-routing.ts';
import { serializeUsageCsv } from '../usage/csv.ts';
import {
  encodeUsageCursor,
  matchesUsageHistoryFilters,
  parseStoredUsageRecord,
  parseUsageHistoryQuery,
  type UsageHistoryPage,
  type UsageHistoryQuery,
  validUsageHistoryOrder,
} from '../usage/history.ts';
import type { UsageRecord } from '../usage/record-usage.ts';

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
  readonly credentialId: string;
  readonly policyVersions: readonly PolicyVersion[];
}

export interface ManagedChatRoute {
  readonly kind?: 'managed';
  readonly version: string;
  readonly candidates: readonly RouteCandidate[];
  readonly jev?: {
    readonly credentialRef: string;
    readonly minimumConfidence: number;
    readonly sendPrompt: boolean;
  };
}

export interface DelegatedChatRoute {
  readonly kind: 'delegated';
  readonly version: string;
  readonly credentialRef: string;
  readonly candidates: readonly RouteCandidate[];
}

export interface PublishedModel {
  readonly alias: string;
  readonly created: number;
  readonly enabled: boolean;
  readonly routes: readonly {
    readonly kind: RouteKind;
    readonly candidates: readonly RouteCandidate[];
  }[];
}

export type GatewayAuditEvent =
  | { readonly kind: 'auth-denied'; readonly requestId: string }
  | { readonly kind: 'auth-unavailable'; readonly requestId: string }
  | (AuditAttribution & {
      readonly kind: 'route-unavailable';
      readonly requestId: string;
      readonly modelAlias: string;
    })
  | (AuditAttribution & {
      readonly kind: 'model-list-unavailable';
      readonly requestId: string;
    })
  | (AuditAttribution & {
      readonly kind: 'models-listed';
      readonly requestId: string;
      readonly count: number;
    })
  | (AuditAttribution & {
      readonly kind: 'usage-read';
      readonly requestId: string;
      readonly targetPrincipalId: string;
      readonly count: number;
      readonly mode: 'self' | 'all';
    })
  | (AuditAttribution & {
      readonly kind: 'usage-read-denied' | 'usage-read-unavailable';
      readonly requestId: string;
      readonly targetPrincipalId: string;
      readonly mode: 'self' | 'all';
    })
  | (AuditAttribution & {
      readonly kind: 'audit-history-read';
      readonly requestId: string;
      readonly targetPrincipalId: string;
      readonly count: number;
    })
  | (AuditAttribution & {
      readonly kind: 'audit-history-read-denied' | 'audit-history-read-unavailable';
      readonly requestId: string;
      readonly targetPrincipalId: string;
    })
  | (AuditAttribution & {
      readonly kind: 'request-denied';
      readonly requestId: string;
      readonly reason: 'invalid-request' | 'unknown-model' | 'configuration';
      readonly modelAlias?: string;
    });

export interface ChatHandlerPorts<T> {
  readonly newRequestId: () => string;
  readonly authenticate: (proxyToken: string) => Promise<AuthenticatedPrincipal | undefined>;
  readonly resolveRoute: (
    modelAlias: string,
  ) => Promise<ManagedChatRoute | DelegatedChatRoute | undefined>;
  readonly listPublishedModels?: () => Promise<readonly PublishedModel[]>;
  readonly listUsage?: (query: UsageHistoryQuery) => Promise<UsageHistoryPage>;
  readonly listAudit?: (query: AuditHistoryQuery) => Promise<AuditHistoryPage>;
  readonly checkLimit: (principalId: string, requestId: string) => Promise<boolean>;
  readonly resolveSecret: (credentialRef: string) => Promise<string | undefined>;
  readonly writeAudit: (
    event: GatewayAuditEvent | ManagedRouteAuditEvent | DelegatedRouteAuditEvent,
  ) => Promise<void>;
  /** The backing adapter must append idempotently or durably queue by attempt ID. */
  readonly writeUsage: (record: UsageRecord) => Promise<void>;
  readonly now?: () => number;
  readonly invokeDirect: (candidate: RouteCandidate, request: ChatRequest) => Promise<T>;
  readonly resolveVerifiedProviderSlug?: (
    providerId: string,
    upstreamModelId: string,
  ) => Promise<string | undefined>;
  readonly invokeOpenRouter?: (
    credentialRef: string,
    attempt: OpenRouterChatAttempt,
    request: ChatRequest,
  ) => Promise<T>;
  readonly fetchJev?: JevFetcher;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function validCatalog(value: unknown): value is readonly PublishedModel[] {
  if (!Array.isArray(value)) return false;
  const aliases = new Set<string>();
  for (const item of value) {
    if (
      !isRecord(item) ||
      typeof item.alias !== 'string' ||
      item.alias.length === 0 ||
      aliases.has(item.alias) ||
      typeof item.created !== 'number' ||
      !Number.isSafeInteger(item.created) ||
      item.created < 0 ||
      typeof item.enabled !== 'boolean' ||
      !Array.isArray(item.routes) ||
      (item.enabled && item.routes.length === 0)
    )
      return false;
    aliases.add(item.alias);
    for (const route of item.routes) {
      if (
        !isRecord(route) ||
        (route.kind !== 'managed' && route.kind !== 'delegated') ||
        !Array.isArray(route.candidates)
      )
        return false;
      for (const candidate of route.candidates) {
        if (
          !isRecord(candidate) ||
          candidate.kind !== route.kind ||
          typeof candidate.id !== 'string' ||
          !candidate.id ||
          typeof candidate.providerId !== 'string' ||
          !candidate.providerId ||
          typeof candidate.upstreamModelId !== 'string' ||
          !candidate.upstreamModelId
        )
          return false;
      }
    }
  }
  return true;
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
  const decoder = new TextDecoder('utf-8', { fatal: true });
  let size = 0;
  let body = '';
  try {
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
    return JSON.parse(body) as unknown;
  } catch {
    await reader.cancel().catch(() => undefined);
    return undefined;
  } finally {
    reader.releaseLock();
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
    const url = new URL(request.url);
    const chatRequest = request.method === 'POST' && url.pathname === '/v1/chat/completions';
    const modelListRequest = request.method === 'GET' && url.pathname === '/v1/models';
    const usageListRequest = request.method === 'GET' && url.pathname === '/v1/usage';
    const auditListRequest = request.method === 'GET' && url.pathname === '/v1/audit';
    if (!chatRequest && !modelListRequest && !usageListRequest && !auditListRequest) {
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

    const candidateAttribution: AuditAttribution = {
      principalId: principal.id,
      credentialId: principal.credentialId,
      policyVersions: principal.policyVersions,
    };
    if (!validAuditAttribution(candidateAttribution)) {
      try {
        await ports.writeAudit({ kind: 'auth-unavailable', requestId });
      } catch {
        return errorResponse(503, 'audit_unavailable', requestId);
      }
      return errorResponse(503, 'authentication_unavailable', requestId);
    }
    const attribution: AuditAttribution = {
      ...candidateAttribution,
      policyVersions: candidateAttribution.policyVersions.map(({ id, version }) => ({
        id,
        version,
      })),
    };

    if (auditListRequest) {
      let parsed: ReturnType<typeof parseAuditHistoryQuery>;
      try {
        parsed = parseAuditHistoryQuery(url);
      } catch {
        try {
          await ports.writeAudit({
            ...attribution,
            kind: 'request-denied',
            requestId,
            reason: 'invalid-request',
          });
        } catch {
          return errorResponse(503, 'audit_unavailable', requestId);
        }
        return errorResponse(400, 'invalid_request', requestId);
      }
      const targetPrincipalId = parsed.requestedPrincipalId ?? principal.id;
      const decision = evaluate({
        principalActive: principal.active,
        action: 'audit:Read',
        resource: `principal:${targetPrincipalId}`,
        statements: principal.statements,
      });
      if (decision.effect !== 'Allow') {
        try {
          await ports.writeAudit({
            ...attribution,
            kind: 'audit-history-read-denied',
            requestId,
            targetPrincipalId,
          });
        } catch {
          return errorResponse(503, 'audit_unavailable', requestId);
        }
        return errorResponse(403, 'forbidden', requestId);
      }
      let page: AuditHistoryPage;
      let auditCsv: string | null = null;
      try {
        if (!ports.listAudit) throw new Error('audit reader unavailable');
        page = projectAuditHistoryPage(
          await ports.listAudit({
            principalId: targetPrincipalId,
            limit: parsed.limit,
            cursor: parsed.cursor,
            ...(parsed.modelAlias === undefined ? {} : { modelAlias: parsed.modelAlias }),
            ...(parsed.fromMs === undefined ? {} : { fromMs: parsed.fromMs }),
            ...(parsed.toMs === undefined ? {} : { toMs: parsed.toMs }),
          }),
          targetPrincipalId,
          parsed.limit,
          parsed.cursor,
          parsed,
        );
        if (parsed.format === 'csv') auditCsv = serializeAuditCsv(page, targetPrincipalId, parsed);
      } catch {
        try {
          await ports.writeAudit({
            ...attribution,
            kind: 'audit-history-read-unavailable',
            requestId,
            targetPrincipalId,
          });
        } catch {
          return errorResponse(503, 'audit_unavailable', requestId);
        }
        return errorResponse(503, 'audit_history_unavailable', requestId);
      }
      try {
        await ports.writeAudit({
          ...attribution,
          kind: 'audit-history-read',
          requestId,
          targetPrincipalId,
          count: page.events.length,
        });
      } catch {
        return errorResponse(503, 'audit_unavailable', requestId);
      }
      if (auditCsv !== null) {
        return new Response(auditCsv, {
          status: 200,
          headers: {
            'content-type': 'text/csv; charset=utf-8',
            'content-disposition': 'attachment; filename="opengranter-audit.csv"',
            'cache-control': 'no-store',
            'x-request-id': requestId,
            'x-has-more': String(page.nextCursor !== null),
            ...(page.nextCursor === null ? {} : { 'x-next-cursor': page.nextCursor }),
          },
        });
      }
      return Response.json(
        {
          object: 'list',
          data: page.events,
          has_more: page.nextCursor !== null,
          next_cursor: page.nextCursor,
        },
        { status: 200, headers: { 'x-request-id': requestId } },
      );
    }

    if (usageListRequest) {
      let parsed: ReturnType<typeof parseUsageHistoryQuery>;
      try {
        parsed = parseUsageHistoryQuery(url);
      } catch {
        try {
          await ports.writeAudit({
            ...attribution,
            kind: 'request-denied',
            requestId,
            reason: 'invalid-request',
          });
        } catch {
          return errorResponse(503, 'audit_unavailable', requestId);
        }
        return errorResponse(400, 'invalid_request', requestId);
      }
      const mode = parsed.requestedPrincipalId === null ? 'self' : 'all';
      const targetPrincipalId = parsed.requestedPrincipalId ?? principal.id;
      const decision = evaluate({
        principalActive: principal.active,
        action: mode === 'self' ? 'usage:ReadSelf' : 'usage:ReadAll',
        resource: `principal:${targetPrincipalId}`,
        statements: principal.statements,
      });
      if (decision.effect !== 'Allow') {
        try {
          await ports.writeAudit({
            ...attribution,
            kind: 'usage-read-denied',
            requestId,
            targetPrincipalId,
            mode,
          });
        } catch {
          return errorResponse(503, 'audit_unavailable', requestId);
        }
        return errorResponse(403, 'forbidden', requestId);
      }
      let data: UsageRecord[];
      let hasMore: boolean;
      let nextCursor: string | null;
      let csv: string | null = null;
      try {
        if (!ports.listUsage) throw new Error('usage reader unavailable');
        const page = await ports.listUsage({
          principalId: targetPrincipalId,
          limit: parsed.limit,
          cursor: parsed.cursor,
          ...(parsed.modelAlias === undefined ? {} : { modelAlias: parsed.modelAlias }),
          ...(parsed.fromMs === undefined ? {} : { fromMs: parsed.fromMs }),
          ...(parsed.toMs === undefined ? {} : { toMs: parsed.toMs }),
        });
        if (
          !page ||
          !Array.isArray(page.records) ||
          page.records.length > parsed.limit ||
          typeof page.hasMore !== 'boolean' ||
          (page.hasMore && page.records.length === 0)
        ) {
          throw new Error('invalid usage page');
        }
        data = page.records.map(parseStoredUsageRecord);
        if (
          data.some(
            (record) =>
              record.principalId !== targetPrincipalId ||
              !matchesUsageHistoryFilters(record, parsed),
          )
        ) {
          throw new Error('cross-principal usage row');
        }
        if (!validUsageHistoryOrder(data, parsed.cursor)) throw new Error('invalid usage order');
        const last = data.at(-1);
        if (page.hasMore && (!last || last.attemptId.length > 512)) {
          throw new Error('invalid usage cursor');
        }
        nextCursor =
          page.hasMore && last
            ? encodeUsageCursor({ occurredAt: last.occurredAt, attemptId: last.attemptId })
            : null;
        hasMore = page.hasMore;
        if (parsed.format === 'csv') csv = serializeUsageCsv(data);
      } catch {
        try {
          await ports.writeAudit({
            ...attribution,
            kind: 'usage-read-unavailable',
            requestId,
            targetPrincipalId,
            mode,
          });
        } catch {
          return errorResponse(503, 'audit_unavailable', requestId);
        }
        return errorResponse(503, 'usage_unavailable', requestId);
      }
      try {
        await ports.writeAudit({
          ...attribution,
          kind: 'usage-read',
          requestId,
          targetPrincipalId,
          mode,
          count: data.length,
        });
      } catch {
        return errorResponse(503, 'audit_unavailable', requestId);
      }
      if (csv !== null) {
        return new Response(csv, {
          status: 200,
          headers: {
            'content-type': 'text/csv; charset=utf-8',
            'content-disposition': 'attachment; filename="opengranter-usage.csv"',
            'cache-control': 'no-store',
            'x-request-id': requestId,
            'x-has-more': String(hasMore),
            ...(nextCursor === null ? {} : { 'x-next-cursor': nextCursor }),
          },
        });
      }
      return Response.json(
        { object: 'list', data, has_more: hasMore, next_cursor: nextCursor },
        { status: 200, headers: { 'x-request-id': requestId } },
      );
    }

    if (modelListRequest) {
      if (url.search) {
        try {
          await ports.writeAudit({
            ...attribution,
            kind: 'request-denied',
            requestId,
            reason: 'invalid-request',
          });
        } catch {
          return errorResponse(503, 'audit_unavailable', requestId);
        }
        return errorResponse(400, 'invalid_request', requestId);
      }
      let catalog: readonly PublishedModel[] | undefined;
      try {
        catalog = await ports.listPublishedModels?.();
      } catch {
        catalog = undefined;
      }
      if (!validCatalog(catalog)) {
        try {
          await ports.writeAudit({ ...attribution, kind: 'model-list-unavailable', requestId });
        } catch {
          return errorResponse(503, 'audit_unavailable', requestId);
        }
        return errorResponse(503, 'catalog_unavailable', requestId);
      }
      const data = catalog
        .filter(
          (model) =>
            model.enabled &&
            model.routes.some(
              (route) =>
                authorizeCandidates({
                  principalActive: principal.active,
                  modelAlias: model.alias,
                  routeKind: route.kind,
                  candidates: route.candidates,
                  statements: principal.statements,
                }).candidates.length > 0,
            ),
        )
        .map((model) => ({
          id: model.alias,
          object: 'model',
          created: model.created,
          owned_by: 'opengranter',
        }));
      try {
        await ports.writeAudit({
          ...attribution,
          kind: 'models-listed',
          requestId,
          count: data.length,
        });
      } catch {
        return errorResponse(503, 'audit_unavailable', requestId);
      }
      return Response.json(
        { object: 'list', data },
        { status: 200, headers: { 'x-request-id': requestId } },
      );
    }

    const chat = validateChat(await readJsonBody(request).catch(() => undefined));
    if (!chat) {
      try {
        await ports.writeAudit({
          ...attribution,
          kind: 'request-denied',
          requestId,
          reason: 'invalid-request',
        });
      } catch {
        return errorResponse(503, 'audit_unavailable', requestId);
      }
      return errorResponse(400, 'invalid_request', requestId);
    }
    if (typeof ports.writeUsage !== 'function') {
      try {
        await ports.writeAudit({
          ...attribution,
          kind: 'request-denied',
          requestId,
          reason: 'configuration',
          modelAlias: chat.model,
        });
      } catch {
        return errorResponse(503, 'audit_unavailable', requestId);
      }
      return errorResponse(503, 'usage_unavailable', requestId);
    }

    let route: ManagedChatRoute | DelegatedChatRoute | undefined;
    try {
      route = await ports.resolveRoute(chat.model);
    } catch {
      try {
        await ports.writeAudit({
          ...attribution,
          kind: 'route-unavailable',
          requestId,
          modelAlias: chat.model,
        });
      } catch {
        return errorResponse(503, 'audit_unavailable', requestId);
      }
      return errorResponse(503, 'route_unavailable', requestId);
    }
    if (!route) {
      try {
        await ports.writeAudit({
          ...attribution,
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

    if (route.kind === 'delegated') {
      try {
        const result = await invokeDelegatedRoute({
          ...attribution,
          requestId,
          routeVersion: route.version,
          credentialRef: route.credentialRef,
          principalActive: principal.active,
          modelAlias: chat.model,
          candidates: route.candidates,
          statements: principal.statements,
          request: chat,
          ports: {
            checkLimit: () => ports.checkLimit(principal.id, requestId),
            writeAudit: ports.writeAudit,
            writeUsage: ports.writeUsage,
            ...(ports.now ? { now: ports.now } : {}),
            ...(ports.resolveVerifiedProviderSlug
              ? { resolveVerifiedProviderSlug: ports.resolveVerifiedProviderSlug }
              : {}),
            ...(ports.invokeOpenRouter ? { invokeOpenRouter: ports.invokeOpenRouter } : {}),
          },
        });
        if (result.status === 'invoked') {
          return Response.json(result.response, {
            status: 200,
            headers: { 'x-request-id': requestId },
          });
        }
        if (result.status === 'denied') {
          if (result.reason === 'no-candidates') return errorResponse(403, 'forbidden', requestId);
          if (result.reason === 'limit') return errorResponse(429, 'limit_exceeded', requestId);
          return errorResponse(503, 'route_unavailable', requestId);
        }
        if (result.reason === 'credential-unavailable') {
          return errorResponse(503, 'credential_unavailable', requestId);
        }
        if (result.reason === 'configuration-unavailable') {
          return errorResponse(503, 'route_unavailable', requestId);
        }
        if (result.reason === 'upstream-failed')
          return errorResponse(502, 'upstream_failed', requestId);
        if (result.reason === 'usage-unavailable')
          return errorResponse(503, 'usage_unavailable', requestId);
        return errorResponse(503, 'audit_unavailable', requestId);
      } catch {
        try {
          await ports.writeAudit({
            ...attribution,
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
    }

    try {
      if (
        'jev' in route &&
        (!isRecord(route.jev) ||
          typeof route.jev.credentialRef !== 'string' ||
          !/^[A-Za-z0-9][A-Za-z0-9._+:/@-]*$/u.test(route.jev.credentialRef) ||
          route.jev.credentialRef.length > 256 ||
          typeof route.jev.minimumConfidence !== 'number' ||
          !Number.isFinite(route.jev.minimumConfidence) ||
          route.jev.minimumConfidence < 0 ||
          route.jev.minimumConfidence > 1 ||
          typeof route.jev.sendPrompt !== 'boolean')
      ) {
        throw new Error('invalid managed route');
      }
      const result = await invokeManagedRoute({
        ...attribution,
        requestId,
        routeVersion: route.version,
        principalActive: principal.active,
        modelAlias: chat.model,
        candidates: route.candidates,
        statements: principal.statements,
        ...(route.jev ? { jev: route.jev } : {}),
        ...(route.jev?.sendPrompt
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
          writeUsage: ports.writeUsage,
          ...(ports.now ? { now: ports.now } : {}),
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
      if (result.reason === 'usage-unavailable')
        return errorResponse(503, 'usage_unavailable', requestId);
      return errorResponse(503, 'audit_unavailable', requestId);
    } catch {
      try {
        await ports.writeAudit({
          ...attribution,
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
