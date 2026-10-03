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
import { createDelegatedHttpStreamResponse } from '../streaming/delegated-http-stream.ts';
import type { DelegatedTextStreamInput } from '../streaming/invoke-delegated-text-stream.ts';
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
import { type ChatMessage, snapshotChatMessages } from './chat-messages.ts';
import {
  type ReasoningEffort,
  type ResponseFormat,
  resolveOutputTokenLimit,
  type StreamOptions,
  snapshotLogitBias,
  snapshotResponseFormat,
  snapshotStopSequences,
  snapshotStreamOptions,
  type Verbosity,
  validMinP,
  validPenalty,
  validReasoningEffort,
  validRepetitionPenalty,
  validSeed,
  validSingleChoice,
  validTemperature,
  validTopA,
  validTopK,
  validTopP,
  validVerbosity,
} from './chat-parameters.ts';
import {
  type FunctionTool,
  snapshotFunctionTools,
  snapshotParallelToolCalls,
  snapshotToolChoice,
  type ToolChoice,
} from './chat-tools.ts';
import {
  type ClientErrorCode,
  type ClientErrorFormat,
  clientErrorFormat,
  createClientErrorResponse,
} from './client-errors.ts';
import { normalizeClientTextMessages } from './client-text-messages.ts';
import {
  type OpenRouterModelMetadata,
  snapshotOpenRouterMetadata,
} from './model-discovery-metadata.ts';
import { parseModelListQuery } from './model-list-query.ts';

const MAX_BODY_BYTES = 1024 * 1024;

export type { ChatMessage } from './chat-messages.ts';

export interface ChatRequest {
  readonly stream_options?: StreamOptions;
  readonly model: string;
  readonly messages: readonly ChatMessage[];
  readonly max_tokens?: number;
  readonly max_completion_tokens?: number;
  readonly temperature?: number;
  readonly n?: 1;
  readonly seed?: number;
  readonly verbosity?: Verbosity;
  readonly reasoning_effort?: ReasoningEffort;
  readonly frequency_penalty?: number;
  readonly presence_penalty?: number;
  readonly response_format?: ResponseFormat;
  readonly top_p?: number;
  readonly repetition_penalty?: number;
  readonly top_a?: number;
  readonly min_p?: number;
  readonly top_k?: number;
  readonly logit_bias?: Readonly<Record<string, number>>;
  readonly tools?: readonly FunctionTool[];
  readonly tool_choice?: ToolChoice;
  readonly parallel_tool_calls?: boolean;
  readonly stop?: string | readonly string[] | null;
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
  readonly openRouterMetadata?: OpenRouterModelMetadata;
  readonly alias: string;
  readonly created: number;
  readonly enabled: boolean;
  readonly routes: readonly {
    readonly kind: RouteKind;
    readonly candidates: readonly RouteCandidate[];
  }[];
}

export type GatewayAuditEvent =
  | (AuditAttribution & {
      readonly kind: 'stream-interrupted';
      readonly requestId: string;
      readonly routeVersion: string;
      readonly modelAlias: string;
      readonly outcome: 'cancelled' | 'failed';
      readonly upstreamCompleted: boolean;
    })
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
  readonly invokeOpenRouterTextStream?: DelegatedTextStreamInput['ports']['invokeOpenRouterTextStream'];
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

function snapshotPrincipal(value: unknown): AuthenticatedPrincipal | undefined {
  if (value === undefined || value === null) return undefined;
  if (!isRecord(value) || typeof value.active !== 'boolean') {
    throw new Error('Invalid authenticated principal');
  }
  if (!value.active) return undefined;
  if (
    !validAuditAttribution({
      principalId: value.id,
      credentialId: value.credentialId,
      policyVersions: value.policyVersions,
    }) ||
    typeof value.id !== 'string' ||
    typeof value.credentialId !== 'string' ||
    !Array.isArray(value.statements) ||
    !Array.isArray(value.policyVersions)
  ) {
    throw new Error('Invalid authenticated principal');
  }
  const statements: Statement[] = [];
  for (const statement of value.statements) {
    if (
      !isRecord(statement) ||
      (statement.effect !== 'Allow' && statement.effect !== 'Deny') ||
      !Array.isArray(statement.actions) ||
      !Array.isArray(statement.resources)
    ) {
      throw new Error('Invalid authenticated policy');
    }
    const actions: string[] = [];
    const resources: string[] = [];
    for (const action of statement.actions) {
      if (typeof action !== 'string') throw new Error('Invalid authenticated policy');
      actions.push(action);
    }
    for (const resource of statement.resources) {
      if (typeof resource !== 'string') throw new Error('Invalid authenticated policy');
      resources.push(resource);
    }
    statements.push(
      Object.freeze({
        effect: statement.effect,
        actions: Object.freeze(actions),
        resources: Object.freeze(resources),
      }),
    );
  }
  const policyVersions: PolicyVersion[] = [];
  for (const policy of value.policyVersions) {
    if (
      !isRecord(policy) ||
      typeof policy.id !== 'string' ||
      !policy.id ||
      typeof policy.version !== 'string' ||
      !policy.version
    ) {
      throw new Error('Invalid authenticated policy version');
    }
    policyVersions.push(Object.freeze({ id: policy.id, version: policy.version }));
  }
  return Object.freeze({
    id: value.id,
    active: true,
    credentialId: value.credentialId,
    statements: Object.freeze(statements),
    policyVersions: Object.freeze(policyVersions),
  });
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function projectClientCompletion(value: unknown, format: ClientErrorFormat): unknown {
  if (format !== 'openrouter' || !isRecord(value) || value.object !== 'chat.completion')
    return value;
  const usage = value.usage;
  const incompleteUsage =
    Object.hasOwn(value, 'usage') &&
    (!isRecord(usage) ||
      ['prompt_tokens', 'completion_tokens', 'total_tokens'].some(
        (key) =>
          typeof usage[key] !== 'number' || !Number.isSafeInteger(usage[key]) || usage[key] < 0,
      ));
  if (value.system_fingerprint !== undefined && !incompleteUsage) return value;
  const projected = { ...value };
  if (projected.system_fingerprint === undefined) projected.system_fingerprint = null;
  if (incompleteUsage) delete projected.usage;
  return projected;
}

function validCatalog(
  value: unknown,
  metadata: Map<object, OpenRouterModelMetadata>,
): value is readonly PublishedModel[] {
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
    const discovery = item.openRouterMetadata;
    if (discovery !== undefined) {
      try {
        metadata.set(item, snapshotOpenRouterMetadata(discovery));
      } catch {
        return false;
      }
    }
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

interface ValidatedChatRequest extends ChatRequest {
  readonly stream?: true;
}

function validateChat(value: unknown, streaming = false): ValidatedChatRequest | undefined {
  if (!isRecord(value)) return undefined;
  if (
    Object.keys(value).some(
      (key) =>
        ![
          'model',
          'messages',
          'stream',
          'stream_options',
          'max_tokens',
          'max_completion_tokens',
          'stop',
          'temperature',
          'top_p',
          'repetition_penalty',
          'top_a',
          'min_p',
          'top_k',
          'logit_bias',
          'tools',
          'tool_choice',
          'parallel_tool_calls',
          'n',
          'seed',
          'verbosity',
          'reasoning_effort',
          'frequency_penalty',
          'presence_penalty',
          'response_format',
        ].includes(key),
    )
  ) {
    return undefined;
  }
  if (value.stream !== undefined && value.stream !== false && !(streaming && value.stream === true))
    return undefined;
  if (
    value.stream === true &&
    (value.tools !== undefined ||
      value.tool_choice !== undefined ||
      value.parallel_tool_calls !== undefined)
  )
    return undefined;
  const verbosity = value.verbosity ?? undefined;
  if (!validVerbosity(verbosity)) return undefined;
  const reasoningEffort = value.reasoning_effort ?? undefined;
  if (!validReasoningEffort(reasoningEffort)) return undefined;
  const seed = value.seed ?? undefined;
  if (!validSeed(seed)) return undefined;
  const temperature = value.temperature ?? undefined;
  if (!validTemperature(temperature)) return undefined;
  if (!validSingleChoice(value.n)) return undefined;
  const frequencyPenalty = value.frequency_penalty ?? undefined;
  const presencePenalty = value.presence_penalty ?? undefined;
  if (!validPenalty(frequencyPenalty) || !validPenalty(presencePenalty)) return undefined;
  const topK = value.top_k ?? undefined;
  if (!validTopK(topK)) return undefined;
  let logitBias: ReturnType<typeof snapshotLogitBias>;
  let streamOptions: ReturnType<typeof snapshotStreamOptions>;
  let tools: ReturnType<typeof snapshotFunctionTools>;
  let toolChoice: ReturnType<typeof snapshotToolChoice>;
  let parallelToolCalls: ReturnType<typeof snapshotParallelToolCalls>;
  try {
    streamOptions = snapshotStreamOptions(value.stream_options);
    if (streamOptions !== undefined && value.stream !== true) return undefined;
    logitBias = snapshotLogitBias(value.logit_bias);
    tools = snapshotFunctionTools(value.tools);
    toolChoice = snapshotToolChoice(value.tool_choice);
    parallelToolCalls = snapshotParallelToolCalls(value.parallel_tool_calls);
  } catch {
    return undefined;
  }
  const minP = value.min_p ?? undefined;
  if (!validMinP(minP)) return undefined;
  const topA = value.top_a ?? undefined;
  if (!validTopA(topA)) return undefined;
  const repetitionPenalty = value.repetition_penalty ?? undefined;
  if (!validRepetitionPenalty(repetitionPenalty)) return undefined;
  const topP = value.top_p ?? undefined;
  if (!validTopP(topP)) return undefined;
  let maxTokens: number | undefined;
  let responseFormat: ResponseFormat | undefined;
  try {
    responseFormat = snapshotResponseFormat(value.response_format);
    maxTokens = resolveOutputTokenLimit(value.max_tokens, value.max_completion_tokens);
  } catch {
    return undefined;
  }
  let stop: ReturnType<typeof snapshotStopSequences>;
  try {
    stop = snapshotStopSequences(value.stop);
  } catch {
    return undefined;
  }
  if (typeof value.model !== 'string' || !value.model) return undefined;
  let messages: readonly ChatMessage[];
  try {
    messages = snapshotChatMessages(normalizeClientTextMessages(value.messages));
  } catch {
    return undefined;
  }
  if (
    value.stream === true &&
    messages.some((message) => message.role === 'tool' || 'tool_calls' in message)
  )
    return undefined;
  return {
    model: value.model,
    messages,
    ...(value.stream === true ? { stream: true } : {}),
    ...(streamOptions === undefined ? {} : { stream_options: streamOptions }),
    ...(seed === undefined ? {} : { seed }),
    ...(verbosity === undefined ? {} : { verbosity }),
    ...(reasoningEffort === undefined ? {} : { reasoning_effort: reasoningEffort }),
    ...(frequencyPenalty === undefined ? {} : { frequency_penalty: frequencyPenalty }),
    ...(presencePenalty === undefined ? {} : { presence_penalty: presencePenalty }),
    ...(responseFormat === undefined ? {} : { response_format: responseFormat }),
    ...(maxTokens === undefined ? {} : { max_tokens: maxTokens }),
    ...(temperature === undefined ? {} : { temperature }),
    ...(topP === undefined ? {} : { top_p: topP }),
    ...(repetitionPenalty === undefined ? {} : { repetition_penalty: repetitionPenalty }),
    ...(topA === undefined ? {} : { top_a: topA }),
    ...(minP === undefined ? {} : { min_p: minP }),
    ...(topK === undefined ? {} : { top_k: topK }),
    ...(logitBias === undefined ? {} : { logit_bias: logitBias }),
    ...(tools === undefined ? {} : { tools }),
    ...(toolChoice === undefined ? {} : { tool_choice: toolChoice }),
    ...(parallelToolCalls === undefined ? {} : { parallel_tool_calls: parallelToolCalls }),
    ...(value.n === undefined ? {} : { n: value.n }),
    ...(stop === undefined ? {} : { stop }),
  };
}

async function readJsonBody(request: Request): Promise<unknown> {
  const mediaType = request.headers.get('content-type')?.split(';', 1)[0]?.trim().toLowerCase();
  if (mediaType !== 'application/json') {
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

/** A controlled chat HTTP boundary with optional delegated text streaming. */
export function createChatHandler<T>(
  ports: ChatHandlerPorts<T>,
): (request: Request) => Promise<Response> {
  return async (request) => {
    const requestId = ports.newRequestId();
    const url = new URL(request.url);
    const format = clientErrorFormat(url.pathname);
    const errorResponse = (status: number, code: ClientErrorCode, id: string) =>
      createClientErrorResponse(status, code, id, format);
    const chatRequest =
      request.method === 'POST' &&
      (url.pathname === '/v1/chat/completions' || url.pathname === '/api/v1/chat/completions');
    const modelListRequest =
      request.method === 'GET' &&
      (url.pathname === '/v1/models' || url.pathname === '/api/v1/models');
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
        const authenticated = await ports.authenticate(token);
        principal = snapshotPrincipal(authenticated);
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
      const query = parseModelListQuery(url, format === 'openrouter');
      if (!query) {
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
      const metadata = new Map<object, OpenRouterModelMetadata>();
      if (!validCatalog(catalog, metadata)) {
        try {
          await ports.writeAudit({ ...attribution, kind: 'model-list-unavailable', requestId });
        } catch {
          return errorResponse(503, 'audit_unavailable', requestId);
        }
        return errorResponse(503, 'catalog_unavailable', requestId);
      }
      const visible = catalog.filter(
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
      );
      const selected =
        query.limit === undefined
          ? visible
          : visible.slice(query.offset, query.offset + query.limit);
      const data = selected.map((model) => ({
        ...(format === 'openrouter' ? metadata.get(model) : {}),
        id: model.alias,
        object: 'model',
        created: model.created,
        owned_by: 'opengranter',
      }));
      const nextOffset = query.offset + data.length;
      const next =
        query.limit !== undefined && nextOffset < visible.length
          ? `/api/v1/models?offset=${nextOffset}&limit=${query.limit}`
          : null;
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
        {
          object: 'list',
          data,
          ...(format === 'openrouter' ? { total_count: visible.length, links: { next } } : {}),
        },
        { status: 200, headers: { 'x-request-id': requestId } },
      );
    }

    const chat = validateChat(
      await readJsonBody(request).catch(() => undefined),
      typeof ports.invokeOpenRouterTextStream === 'function',
    );
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
      if (chat.stream) {
        return createDelegatedHttpStreamResponse({
          ...attribution,
          requestId,
          routeVersion: route.version,
          credentialRef: route.credentialRef,
          principalActive: principal.active,
          modelAlias: chat.model,
          candidates: route.candidates,
          statements: principal.statements,
          request: chat,
          signal: request.signal,
          format,
          ports: {
            checkLimit: () => ports.checkLimit(principal.id, requestId),
            writeAudit: ports.writeAudit,
            writeUsage: ports.writeUsage,
            ...(ports.now ? { now: ports.now } : {}),
            ...(ports.resolveVerifiedProviderSlug
              ? { resolveVerifiedProviderSlug: ports.resolveVerifiedProviderSlug }
              : {}),
            ...(ports.invokeOpenRouterTextStream
              ? { invokeOpenRouterTextStream: ports.invokeOpenRouterTextStream }
              : {}),
          },
        });
      }
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
          return Response.json(projectClientCompletion(result.response, format), {
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

    if (chat.stream) {
      try {
        await ports.writeAudit({
          ...attribution,
          kind: 'request-denied',
          requestId,
          reason: 'invalid-request',
          modelAlias: chat.model,
        });
      } catch {
        return errorResponse(503, 'audit_unavailable', requestId);
      }
      return errorResponse(400, 'invalid_request', requestId);
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
        return Response.json(projectClientCompletion(result.response, format), {
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
