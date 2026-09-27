import type { AuditAttribution } from '../audit/attribution.ts';
import type { ChatRequest } from '../gateway/chat-handler.ts';
import {
  type OpenRouterChatAttempt,
  OpenRouterChatFailure,
  validOpenRouterSlug,
} from '../providers/openrouter-chat.ts';
import { captureAttemptUsage, type UsageHandoff } from '../usage/capture-attempt.ts';
import {
  authorizeCandidates,
  type CandidateAuthorizationInput,
  type RouteCandidate,
} from './authorize-candidates.ts';

interface DelegatedAuditBase extends AuditAttribution {
  readonly requestId: string;
  readonly routeVersion: string;
  readonly modelAlias: string;
}

export type DelegatedRouteAuditEvent =
  | (DelegatedAuditBase & {
      readonly kind: 'delegated-denied';
      readonly reason: 'no-candidates' | 'mapping-unavailable' | 'limit' | 'configuration';
    })
  | (DelegatedAuditBase & {
      readonly kind: 'delegated-selection';
      readonly upstreamModelId: string;
      readonly candidateIds: readonly string[];
      readonly authorizedProviderSlugs: readonly string[];
    })
  | (DelegatedAuditBase & {
      readonly kind: 'delegated-attempt';
      readonly upstreamModelId: string;
      readonly candidateIds: readonly string[];
      readonly authorizedProviderSlugs: readonly string[];
      readonly outcome: 'succeeded' | 'failed';
      readonly failureCategory?: OpenRouterChatFailure['category'];
      readonly possiblyBilled?: boolean;
    })
  | (DelegatedAuditBase & {
      readonly kind: 'usage-handoff-failed';
      readonly attemptId: string;
      readonly candidateIds: readonly string[];
      readonly outcome: 'succeeded' | 'failed';
      readonly possiblyBilled: boolean;
    });

export interface DelegatedRoutePorts<T> extends UsageHandoff {
  readonly resolveVerifiedProviderSlug?: (
    providerId: string,
    upstreamModelId: string,
  ) => Promise<string | undefined>;
  readonly checkLimit: () => Promise<boolean>;
  readonly writeAudit: (event: DelegatedRouteAuditEvent) => Promise<void>;
  readonly invokeOpenRouter?: (
    credentialRef: string,
    attempt: OpenRouterChatAttempt,
    request: ChatRequest,
  ) => Promise<T>;
}

export interface DelegatedRouteInput<T>
  extends Omit<CandidateAuthorizationInput, 'routeKind'>,
    AuditAttribution {
  readonly requestId: string;
  readonly routeVersion: string;
  readonly credentialRef: string;
  readonly request: ChatRequest;
  readonly ports: DelegatedRoutePorts<T>;
}

export type DelegatedRouteResult<T> =
  | {
      readonly status: 'denied';
      readonly reason: 'no-candidates' | 'mapping-unavailable' | 'limit' | 'configuration';
    }
  | {
      readonly status: 'failed';
      readonly reason:
        | 'audit-unavailable'
        | 'upstream-failed'
        | 'credential-unavailable'
        | 'configuration-unavailable'
        | 'usage-unavailable';
      readonly possiblyBilled?: boolean;
    }
  | { readonly status: 'invoked'; readonly response: T };

/** Invoke one already approved delegated model with provider bounds established before the call. */
export async function invokeDelegatedRoute<T>(
  input: DelegatedRouteInput<T>,
): Promise<DelegatedRouteResult<T>> {
  const base: DelegatedAuditBase = {
    principalId: input.principalId,
    credentialId: input.credentialId,
    policyVersions: input.policyVersions,
    requestId: input.requestId,
    routeVersion: input.routeVersion,
    modelAlias: input.modelAlias,
  };
  async function deny(reason: 'no-candidates' | 'mapping-unavailable' | 'limit' | 'configuration') {
    try {
      await input.ports.writeAudit({ ...base, kind: 'delegated-denied', reason });
    } catch {
      return { status: 'failed', reason: 'audit-unavailable' } as const;
    }
    return { status: 'denied', reason } as const;
  }

  const eligible = authorizeCandidates({
    principalActive: input.principalActive,
    modelAlias: input.modelAlias,
    routeKind: 'delegated',
    candidates: input.candidates,
    statements: input.statements,
  }).candidates;
  if (eligible.length === 0) return deny('no-candidates');
  if (!input.credentialRef) return deny('configuration');
  const invokeOpenRouter = input.ports.invokeOpenRouter;
  if (!invokeOpenRouter) return deny('configuration');
  const resolveVerifiedProviderSlug = input.ports.resolveVerifiedProviderSlug;
  if (!resolveVerifiedProviderSlug) return deny('mapping-unavailable');

  const upstreamModelId = eligible[0]?.upstreamModelId;
  if (!upstreamModelId || !validOpenRouterSlug(upstreamModelId)) return deny('configuration');
  const selected: readonly RouteCandidate[] = eligible.filter(
    (candidate) => candidate.upstreamModelId === upstreamModelId,
  );
  const providerSlugs: string[] = [];
  for (const candidate of selected) {
    let slug: string | undefined;
    try {
      slug = await resolveVerifiedProviderSlug(candidate.providerId, upstreamModelId);
    } catch {
      return deny('mapping-unavailable');
    }
    if (!validOpenRouterSlug(slug) || providerSlugs.includes(slug)) {
      return deny('mapping-unavailable');
    }
    providerSlugs.push(slug);
  }

  try {
    if (!(await input.ports.checkLimit())) return deny('limit');
  } catch {
    return deny('limit');
  }

  const candidateIds = selected.map((candidate) => candidate.id);
  async function usageUnavailable(outcome: 'succeeded' | 'failed', possiblyBilled: boolean) {
    try {
      await input.ports.writeAudit({
        ...base,
        kind: 'usage-handoff-failed',
        attemptId: `${input.requestId}/delegated/1`,
        candidateIds,
        outcome,
        possiblyBilled,
      });
    } catch {
      // The response still fails closed; the ledger adapter owns durable recovery.
    }
    return { status: 'failed', reason: 'usage-unavailable', possiblyBilled: true } as const;
  }
  try {
    await input.ports.writeAudit({
      ...base,
      kind: 'delegated-selection',
      upstreamModelId,
      candidateIds,
      authorizedProviderSlugs: [...providerSlugs],
    });
  } catch {
    return { status: 'failed', reason: 'audit-unavailable' };
  }

  let response: T;
  const startedAt = input.ports.now?.() ?? Date.now();
  try {
    response = await invokeOpenRouter(
      input.credentialRef,
      { upstreamModelId, authorizedProviderSlugs: providerSlugs },
      input.request,
    );
  } catch (error) {
    const failure = error instanceof OpenRouterChatFailure ? error : undefined;
    const possiblyBilled = failure?.possiblyBilled ?? true;
    if (!failure || failure.responseStarted || possiblyBilled) {
      try {
        await captureAttemptUsage(
          {
            ...base,
            attemptNumber: 1,
            routeKind: 'delegated',
            upstreamModelId,
            selectedCandidateId: selected.length === 1 ? (selected[0]?.id ?? null) : null,
            startedAt,
            outcome: 'failed',
            possiblyBilled,
            possibleDuplicate: false,
          },
          input.ports,
        );
      } catch {
        return usageUnavailable('failed', possiblyBilled);
      }
    }
    try {
      await input.ports.writeAudit({
        ...base,
        kind: 'delegated-attempt',
        upstreamModelId,
        candidateIds,
        authorizedProviderSlugs: [...providerSlugs],
        outcome: 'failed',
        ...(failure ? { failureCategory: failure.category } : {}),
        possiblyBilled,
      });
    } catch {
      return { status: 'failed', reason: 'audit-unavailable', possiblyBilled: true };
    }
    if (failure?.category === 'credential') {
      return { status: 'failed', reason: 'credential-unavailable' };
    }
    if (failure?.category === 'configuration') {
      return { status: 'failed', reason: 'configuration-unavailable' };
    }
    return { status: 'failed', reason: 'upstream-failed', possiblyBilled };
  }

  try {
    await captureAttemptUsage(
      {
        ...base,
        attemptNumber: 1,
        routeKind: 'delegated',
        upstreamModelId,
        selectedCandidateId: selected.length === 1 ? (selected[0]?.id ?? null) : null,
        startedAt,
        outcome: 'succeeded',
        possiblyBilled: true,
        possibleDuplicate: false,
        response,
      },
      input.ports,
    );
  } catch {
    return usageUnavailable('succeeded', true);
  }
  try {
    await input.ports.writeAudit({
      ...base,
      kind: 'delegated-attempt',
      upstreamModelId,
      candidateIds,
      authorizedProviderSlugs: [...providerSlugs],
      outcome: 'succeeded',
    });
  } catch {
    return { status: 'failed', reason: 'audit-unavailable', possiblyBilled: true };
  }
  return { status: 'invoked', response };
}
