import type { GatewayAuditEvent } from '../gateway/chat-handler.ts';
import type { DelegatedRouteAuditEvent } from '../routing/invoke-delegated-route.ts';
import type { ManagedRouteAuditEvent } from '../routing/invoke-jev-managed-route.ts';

export type GatewayAuditInput =
  | GatewayAuditEvent
  | ManagedRouteAuditEvent
  | DelegatedRouteAuditEvent;

export interface GatewayAuditSqlClient {
  readonly query: (
    sql: string,
    params: readonly unknown[],
  ) => Promise<{ readonly rows: readonly unknown[] }>;
}

export class InvalidGatewayAuditEvent extends Error {
  constructor() {
    super('Invalid gateway audit event');
    this.name = 'InvalidGatewayAuditEvent';
  }
}

export class GatewayAuditUnavailable extends Error {
  constructor() {
    super('Gateway audit store unavailable');
    this.name = 'GatewayAuditUnavailable';
  }
}

type RecordValue = Record<string, unknown>;

function record(value: unknown): RecordValue {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new InvalidGatewayAuditEvent();
  }
  return value as RecordValue;
}

function identifier(value: unknown): string {
  if (
    typeof value !== 'string' ||
    value.length < 1 ||
    value.length > 256 ||
    !/^[A-Za-z0-9][A-Za-z0-9._+:/@-]*$/u.test(value)
  ) {
    throw new InvalidGatewayAuditEvent();
  }
  return value;
}

function credentialIdentifier(value: unknown): string {
  if (typeof value === 'string' && /^[A-Za-z0-9_-]{22}$/u.test(value)) return value;
  return identifier(value);
}

function count(value: unknown): number {
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < 0) {
    throw new InvalidGatewayAuditEvent();
  }
  return value;
}

function boolean(value: unknown): boolean {
  if (typeof value !== 'boolean') throw new InvalidGatewayAuditEvent();
  return value;
}

function oneOf<T extends string>(value: unknown, choices: readonly T[]): T {
  if (typeof value !== 'string' || !choices.includes(value as T)) {
    throw new InvalidGatewayAuditEvent();
  }
  return value as T;
}

function identifiers(value: unknown): string[] {
  if (!Array.isArray(value) || value.length > 1024) throw new InvalidGatewayAuditEvent();
  return value.map(identifier);
}

function optionalIdentifier(value: unknown): string | undefined {
  return value === undefined ? undefined : identifier(value);
}

function optionalBoolean(value: unknown): boolean | undefined {
  return value === undefined ? undefined : boolean(value);
}

function policyVersions(value: unknown): { id: string; version: string }[] {
  if (!Array.isArray(value) || value.length > 1024) throw new InvalidGatewayAuditEvent();
  return value.map((entry: unknown) => {
    const policy = record(entry);
    return { id: identifier(policy.id), version: identifier(policy.version) };
  });
}

function decision(value: unknown): RecordValue {
  const input = record(value);
  const source = oneOf(input.source, ['jev', 'fallback', 'order'] as const);
  if (source === 'order') return { source };
  const model = optionalIdentifier(input.model);
  const confidence = input.confidence;
  if (
    confidence !== undefined &&
    (typeof confidence !== 'number' ||
      !Number.isFinite(confidence) ||
      confidence < 0 ||
      confidence > 1)
  ) {
    throw new InvalidGatewayAuditEvent();
  }
  if (source === 'jev' && (model === undefined || confidence === undefined)) {
    throw new InvalidGatewayAuditEvent();
  }
  const reason =
    source === 'fallback'
      ? oneOf(input.reason, [
          'unavailable',
          'invalid-response',
          'invalid-choice',
          'low-confidence',
        ] as const)
      : undefined;
  const usage = input.usage === undefined ? undefined : record(input.usage);
  return {
    source,
    ...(reason === undefined ? {} : { reason }),
    ...(model === undefined ? {} : { model }),
    ...(confidence === undefined ? {} : { confidence }),
    ...(usage === undefined
      ? {}
      : {
          usage: { inputTokens: count(usage.inputTokens), outputTokens: count(usage.outputTokens) },
        }),
  };
}

function details(event: RecordValue): RecordValue {
  switch (event.kind) {
    case 'auth-denied':
    case 'auth-unavailable':
    case 'model-list-unavailable':
      return {};
    case 'route-unavailable':
      return { modelAlias: identifier(event.modelAlias) };
    case 'models-listed':
      return { count: count(event.count) };
    case 'usage-read':
      return {
        targetPrincipalId: identifier(event.targetPrincipalId),
        count: count(event.count),
        mode: oneOf(event.mode, ['self', 'all'] as const),
      };
    case 'usage-read-denied':
    case 'usage-read-unavailable':
      return {
        targetPrincipalId: identifier(event.targetPrincipalId),
        mode: oneOf(event.mode, ['self', 'all'] as const),
      };
    case 'audit-history-read':
      return { targetPrincipalId: identifier(event.targetPrincipalId), count: count(event.count) };
    case 'audit-history-read-denied':
    case 'audit-history-read-unavailable':
      return { targetPrincipalId: identifier(event.targetPrincipalId) };
    case 'request-denied': {
      const modelAlias = optionalIdentifier(event.modelAlias);
      return {
        reason: oneOf(event.reason, ['invalid-request', 'unknown-model', 'configuration'] as const),
        ...(modelAlias === undefined ? {} : { modelAlias }),
      };
    }
    case 'denied':
      return {
        routeVersion: identifier(event.routeVersion),
        modelAlias: identifier(event.modelAlias),
        reason: oneOf(event.reason, ['no-candidates', 'limit', 'secret-unavailable'] as const),
      };
    case 'selection-started':
      return {
        routeVersion: identifier(event.routeVersion),
        modelAlias: identifier(event.modelAlias),
        eligibleCandidateIds: identifiers(event.eligibleCandidateIds),
      };
    case 'decision':
      return {
        routeVersion: identifier(event.routeVersion),
        modelAlias: identifier(event.modelAlias),
        candidateId: identifier(event.candidateId),
        decision: decision(event.decision),
      };
    case 'attempt': {
      const failureCategory =
        event.failureCategory === undefined
          ? undefined
          : oneOf(event.failureCategory, [
              'rate-limit',
              'server-error',
              'timeout',
              'other',
            ] as const);
      const possiblyBilled = optionalBoolean(event.possiblyBilled);
      return {
        routeVersion: identifier(event.routeVersion),
        modelAlias: identifier(event.modelAlias),
        candidateId: identifier(event.candidateId),
        outcome: oneOf(event.outcome, ['succeeded', 'failed'] as const),
        ...(failureCategory === undefined ? {} : { failureCategory }),
        ...(possiblyBilled === undefined ? {} : { possiblyBilled }),
      };
    }
    case 'delegated-denied':
      return {
        routeVersion: identifier(event.routeVersion),
        modelAlias: identifier(event.modelAlias),
        reason: oneOf(event.reason, [
          'no-candidates',
          'mapping-unavailable',
          'limit',
          'configuration',
        ] as const),
      };
    case 'delegated-selection':
      return {
        routeVersion: identifier(event.routeVersion),
        modelAlias: identifier(event.modelAlias),
        upstreamModelId: identifier(event.upstreamModelId),
        candidateIds: identifiers(event.candidateIds),
        authorizedProviderSlugs: identifiers(event.authorizedProviderSlugs),
      };
    case 'delegated-attempt': {
      const failureCategory =
        event.failureCategory === undefined
          ? undefined
          : oneOf(event.failureCategory, [
              'configuration',
              'credential',
              'rate-limit',
              'server-error',
              'timeout',
              'upstream',
            ] as const);
      const possiblyBilled = optionalBoolean(event.possiblyBilled);
      return {
        routeVersion: identifier(event.routeVersion),
        modelAlias: identifier(event.modelAlias),
        upstreamModelId: identifier(event.upstreamModelId),
        candidateIds: identifiers(event.candidateIds),
        authorizedProviderSlugs: identifiers(event.authorizedProviderSlugs),
        outcome: oneOf(event.outcome, ['succeeded', 'failed'] as const),
        ...(failureCategory === undefined ? {} : { failureCategory }),
        ...(possiblyBilled === undefined ? {} : { possiblyBilled }),
      };
    }
    case 'usage-handoff-failed': {
      const candidate = Array.isArray(event.candidateIds)
        ? { candidateIds: identifiers(event.candidateIds) }
        : { candidateId: identifier(event.candidateId) };
      return {
        routeVersion: identifier(event.routeVersion),
        modelAlias: identifier(event.modelAlias),
        attemptId: identifier(event.attemptId),
        ...candidate,
        outcome: oneOf(event.outcome, ['succeeded', 'failed'] as const),
        possiblyBilled: boolean(event.possiblyBilled),
      };
    }
    default:
      throw new InvalidGatewayAuditEvent();
  }
}

/** Project one known metadata event; never serialize the caller's object wholesale. */
export function projectGatewayAuditEvent(value: unknown, now: number) {
  const event = record(value);
  if (!Number.isSafeInteger(now) || now < 0) throw new InvalidGatewayAuditEvent();
  const kind = identifier(event.kind);
  const requestId = identifier(event.requestId);
  const projectedDetails = details(event);
  const anonymous = kind === 'auth-denied' || kind === 'auth-unavailable';
  const principalId = anonymous ? null : identifier(event.principalId);
  const credentialId = anonymous ? null : credentialIdentifier(event.credentialId);
  const versions = anonymous ? null : policyVersions(event.policyVersions);
  return {
    occurredAt: now,
    kind,
    requestId,
    principalId,
    credentialId,
    policyVersions: versions,
    details: projectedDetails,
  };
}

/** PostgreSQL append port for existing gateway and routing metadata events. */
export function createPostgresGatewayAuditStore(
  client: GatewayAuditSqlClient,
  now: () => number,
): { readonly append: (event: GatewayAuditInput) => Promise<void> } {
  return {
    async append(event) {
      let occurredAt: number;
      try {
        occurredAt = now();
      } catch {
        throw new GatewayAuditUnavailable();
      }
      const projected = projectGatewayAuditEvent(event, occurredAt);
      try {
        const result = await client.query(
          `INSERT INTO gateway_audit_events
             (occurred_at_ms, kind, request_id, principal_id, credential_id, policy_versions, details)
           VALUES ($1, $2, $3, $4, $5, $6::jsonb, $7::jsonb)
           RETURNING event_id`,
          [
            projected.occurredAt,
            projected.kind,
            projected.requestId,
            projected.principalId,
            projected.credentialId,
            projected.policyVersions === null ? null : JSON.stringify(projected.policyVersions),
            JSON.stringify(projected.details),
          ],
        );
        if (result.rows.length !== 1) throw new GatewayAuditUnavailable();
      } catch {
        throw new GatewayAuditUnavailable();
      }
    },
  };
}
