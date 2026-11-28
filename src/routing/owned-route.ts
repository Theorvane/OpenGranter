import type { AuditAttribution } from '../audit/attribution.ts';
import { evaluate, type Statement } from '../policy/evaluate.ts';
import {
  type OpenRouterChatAttempt,
  OpenRouterChatFailure,
  validOpenRouterSlug,
} from '../providers/openrouter-chat.ts';
import type { UsageRecord } from '../usage/record-usage.ts';
import { authorizeCandidates, type RouteCandidate } from './authorize-candidates.ts';
import {
  DirectProviderFailure,
  invokeManagedRoute,
  type JevManagedRouteResult,
  type ManagedRouteAuditEvent,
} from './invoke-jev-managed-route.ts';
import {
  administratorOrder,
  administratorPriorityStrategy,
  type RoutingStrategy,
} from './owned-strategy.ts';

export interface OwnedCandidate {
  readonly id: string;
  readonly registrationId: string;
  readonly providerId: string;
  readonly upstreamModelId: string;
  readonly priority: number;
  /** Trusted request-specific capability, fresh health, and quota evidence; never caller fields. */
  readonly capabilityEligible: boolean;
  readonly healthy: boolean;
  readonly quotaEligible: boolean;
  /** Verified final-provider slug for this exact OpenRouter model/provider pair. */
  readonly providerSlug?: string;
}

export type OwnedProviderRegistration =
  | { readonly id: string; readonly providerId: string; readonly kind: 'direct' }
  | {
      readonly id: string;
      readonly providerId: string;
      readonly kind: 'openrouter';
      readonly credentialRef: string;
    };

export interface OwnedReservation {
  /** Reconcile all attempt usage before release; retain funds for uncertain/possibly billed attempts. */
  complete(outcome: { readonly status: string; readonly possiblyBilled: boolean }): Promise<void>;
}

export type OwnedAuditEvent =
  | ManagedRouteAuditEvent
  | (AuditAttribution & {
      readonly requestId: string;
      readonly routeVersion: string;
      readonly modelAlias: string;
      readonly kind: 'owned-selection-started' | 'owned-selection' | 'owned-denied';
      readonly candidateIds?: readonly string[];
      readonly candidateId?: string;
      readonly selection?: 'strategy' | 'deterministic-fallback';
      readonly strategy?: 'administrator-priority' | 'jev-research' | 'custom';
      readonly reason?: 'no-candidates' | 'configuration' | 'reservation';
    });

export interface OwnedRouteInput<T> extends AuditAttribution {
  readonly requestId: string;
  readonly routeVersion: string;
  readonly modelAlias: string;
  readonly principalActive: boolean;
  readonly statements: readonly Statement[];
  readonly candidates: readonly OwnedCandidate[];
  readonly registrations: readonly OwnedProviderRegistration[];
  readonly strategy?: RoutingStrategy;
  readonly ports: {
    /** Atomic all-attempt budget admission, not a boolean check. Undefined denies admission. */
    readonly reserve: (request: {
      readonly requestId: string;
      readonly principalId: string;
      readonly candidates: readonly OwnedCandidate[];
      readonly maximumAttempts: number;
    }) => Promise<OwnedReservation | undefined>;
    readonly writeUsage: (record: UsageRecord) => Promise<void>;
    readonly writeAudit: (event: OwnedAuditEvent) => Promise<void>;
    readonly invokeDirect: (candidate: RouteCandidate) => Promise<T>;
    readonly invokeOpenRouter: (
      credentialRef: string,
      attempt: OpenRouterChatAttempt,
    ) => Promise<T>;
    readonly now?: () => number;
  };
}

export type OwnedRouteResult<T> =
  | JevManagedRouteResult<T>
  | { readonly status: 'denied'; readonly reason: 'configuration' | 'reservation' }
  | {
      readonly status: 'failed';
      readonly reason: 'reservation-reconciliation';
      readonly possiblyBilled: boolean;
    };

/** Opt-in core only: existing persisted route kinds and gateway wiring are unchanged. */
export async function invokeOwnedRoute<T>(input: OwnedRouteInput<T>): Promise<OwnedRouteResult<T>> {
  const base = {
    principalId: input.principalId,
    credentialId: input.credentialId,
    policyVersions: input.policyVersions.map((version) => ({ ...version })),
    requestId: input.requestId,
    routeVersion: input.routeVersion,
    modelAlias: input.modelAlias,
  };
  const ports = { ...input.ports };
  const principalActive = input.principalActive;
  const statements = input.statements.map((statement) => ({
    ...statement,
    actions: [...statement.actions],
    resources: [...statement.resources],
  }));
  const strategy = input.strategy ?? administratorPriorityStrategy;
  const strategyKind =
    strategy.id === 'administrator-priority' || strategy.id === 'jev-research'
      ? strategy.id
      : 'custom';
  async function deny(reason: 'no-candidates' | 'configuration' | 'reservation') {
    try {
      await ports.writeAudit({ ...base, kind: 'owned-denied', reason });
    } catch {
      return { status: 'failed', reason: 'audit-unavailable' } as const;
    }
    return { status: 'denied', reason } as const;
  }
  if (
    typeof ports.reserve !== 'function' ||
    typeof ports.writeUsage !== 'function' ||
    typeof ports.invokeDirect !== 'function' ||
    typeof ports.invokeOpenRouter !== 'function'
  )
    return deny('configuration');
  const registrations = new Map(
    input.registrations.map((registration) => [
      registration.id,
      Object.freeze({ ...registration }),
    ]),
  );
  const candidates = input.candidates.map((candidate) => Object.freeze({ ...candidate }));
  if (
    registrations.size !== input.registrations.length ||
    new Set(candidates.map((candidate) => candidate.id)).size !== candidates.length ||
    candidates.some(
      (candidate) =>
        !candidate.id ||
        !Number.isSafeInteger(candidate.priority) ||
        !registrations.has(candidate.registrationId),
    )
  )
    return deny('configuration');

  const allowed = authorizeCandidates({
    principalActive,
    modelAlias: base.modelAlias,
    statements,
    routeKind: 'managed',
    candidates: candidates.map((candidate) => ({ ...candidate, kind: 'managed' })),
  }).candidates;
  const ids = new Set(allowed.map((candidate) => candidate.id));
  const eligible = Object.freeze(
    administratorOrder(
      candidates.filter((candidate) => {
        const registration = registrations.get(candidate.registrationId);
        if (
          !registration ||
          !ids.has(candidate.id) ||
          candidate.capabilityEligible !== true ||
          candidate.healthy !== true ||
          candidate.quotaEligible !== true
        )
          return false;
        if (
          evaluate({
            principalActive,
            action: 'llm:UseProvider',
            resource: `provider:${registration.providerId}`,
            statements,
          }).effect !== 'Allow'
        )
          return false;
        if (registration.kind === 'direct') return registration.providerId === candidate.providerId;
        return (
          registration.kind === 'openrouter' &&
          !!registration.credentialRef &&
          validOpenRouterSlug(candidate.upstreamModelId) &&
          validOpenRouterSlug(candidate.providerSlug)
        );
      }),
    ),
  );
  if (eligible.length === 0) return deny('no-candidates');
  let reservation: OwnedReservation | undefined;
  try {
    reservation = await ports.reserve({
      requestId: base.requestId,
      principalId: base.principalId,
      candidates: eligible,
      maximumAttempts: eligible.length,
    });
  } catch {
    return deny('reservation');
  }
  if (!reservation) return deny('reservation');
  let attempted = false;
  let result: OwnedRouteResult<T>;
  try {
    await ports.writeAudit({
      ...base,
      kind: 'owned-selection-started',
      candidateIds: eligible.map((candidate) => candidate.id),
    });
    // Project only strategy metadata: no credential references, routing slug, or request bodies.
    const metadata = Object.freeze(
      eligible.map(({ id, priority, providerId, upstreamModelId }) =>
        Object.freeze({ id, priority, providerId, upstreamModelId }),
      ),
    );
    let chosen: string | undefined;
    try {
      chosen = (await strategy.select(metadata))?.candidateId;
    } catch {
      /* deterministic fallback */
    }
    const selected = eligible.find((candidate) => candidate.id === chosen) ?? eligible[0];
    if (!selected) throw new Error('Empty admitted candidate set');
    await ports.writeAudit({
      ...base,
      kind: 'owned-selection',
      candidateId: selected.id,
      selection: chosen === selected.id ? 'strategy' : 'deterministic-fallback',
      strategy: strategyKind,
    });
    const ordered = [selected, ...eligible.filter((candidate) => candidate.id !== selected.id)];
    result = await invokeManagedRoute({
      ...base,
      principalActive,
      statements,
      captureUnbilledFailures: true,
      candidates: ordered.map((candidate) => ({
        id: candidate.id,
        kind: 'managed',
        upstreamModelId: candidate.upstreamModelId,
        providerId: candidate.providerId,
      })),
      ports: {
        checkLimit: async () => true, // Already admitted by the mandatory atomic reservation above.
        resolveSecret: async () => undefined,
        writeAudit: ports.writeAudit,
        writeUsage: ports.writeUsage,
        ...(ports.now ? { now: ports.now } : {}),
        invokeDirect: async (candidate) => {
          const owned = eligible.find((entry) => entry.id === candidate.id);
          const registration = owned && registrations.get(owned.registrationId);
          if (!owned || !registration) throw new DirectProviderFailure('other', false, false);
          attempted = true;
          try {
            if (registration.kind === 'direct') return await ports.invokeDirect(candidate);
            if (!owned.providerSlug) throw new DirectProviderFailure('other', false, false);
            return await ports.invokeOpenRouter(registration.credentialRef, {
              upstreamModelId: owned.upstreamModelId,
              authorizedProviderSlugs: [owned.providerSlug],
            });
          } catch (error) {
            if (error instanceof DirectProviderFailure) throw error;
            if (error instanceof OpenRouterChatFailure)
              throw new DirectProviderFailure(
                error.category === 'rate-limit' ||
                  error.category === 'server-error' ||
                  error.category === 'timeout'
                  ? error.category
                  : 'other',
                error.responseStarted,
                error.possiblyBilled,
                error.retryAfterSeconds,
                error.upstreamStatus,
              );
            // Unknown adapter errors cannot establish safe replay or absence of billing.
            throw new DirectProviderFailure('other', true, true);
          }
        },
      },
    });
  } catch {
    result = {
      status: 'failed',
      reason: 'audit-unavailable',
      ...(attempted ? { possiblyBilled: true } : {}),
    };
  }
  try {
    await reservation.complete({ status: result.status, possiblyBilled: attempted });
  } catch {
    return { status: 'failed', reason: 'reservation-reconciliation', possiblyBilled: attempted };
  }
  return result;
}
