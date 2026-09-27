import type { AuditAttribution } from '../audit/attribution.ts';
import {
  authorizeCandidates,
  type CandidateAuthorizationInput,
  type RouteCandidate,
} from './authorize-candidates.ts';
import {
  type JevConfig,
  type JevDecision,
  type JevFetcher,
  selectManagedWithJev,
} from './jev-managed-routing.ts';

interface AuditBase extends AuditAttribution {
  readonly requestId: string;
  readonly routeVersion: string;
  readonly modelAlias: string;
}

export type DirectProviderFailureCategory = 'rate-limit' | 'server-error' | 'timeout' | 'other';

/** An adapter must classify a failure and report whether an upstream response began. */
export class DirectProviderFailure extends Error {
  readonly category: DirectProviderFailureCategory;
  readonly responseStarted: boolean;
  readonly possiblyBilled: boolean;

  constructor(
    category: DirectProviderFailureCategory,
    responseStarted: boolean,
    possiblyBilled: boolean,
  ) {
    super('Direct provider attempt failed');
    this.name = 'DirectProviderFailure';
    this.category = category;
    this.responseStarted = responseStarted;
    this.possiblyBilled = possiblyBilled;
  }
}

export type ManagedRouteAuditEvent =
  | (AuditBase & {
      readonly kind: 'denied';
      readonly reason: 'no-candidates' | 'limit' | 'secret-unavailable';
    })
  | (AuditBase & {
      readonly kind: 'selection-started';
      readonly eligibleCandidateIds: readonly string[];
    })
  | (AuditBase & {
      readonly kind: 'decision';
      readonly candidateId: string;
      readonly decision: JevDecision;
    })
  | (AuditBase & {
      readonly kind: 'attempt';
      readonly candidateId: string;
      readonly outcome: 'succeeded' | 'failed';
      readonly failureCategory?: DirectProviderFailureCategory;
      readonly possiblyBilled?: boolean;
    });

export interface JevManagedRoutePorts<T> {
  readonly checkLimit: () => Promise<boolean>;
  readonly resolveSecret: (credentialRef: string) => Promise<string | undefined>;
  readonly writeAudit: (event: ManagedRouteAuditEvent) => Promise<void>;
  readonly invokeDirect: (candidate: RouteCandidate) => Promise<T>;
  readonly fetchJev?: JevFetcher;
}

export interface JevManagedRouteInput<T>
  extends Omit<CandidateAuthorizationInput, 'routeKind'>,
    AuditAttribution {
  /** Supplied by the trusted route store, after capability and health filtering. */
  readonly routeVersion: string;
  readonly requestId: string;
  readonly jev: Omit<JevConfig, 'apiKey'> & { readonly credentialRef: string };
  readonly promptText?: string;
  readonly ports: JevManagedRoutePorts<T>;
}

export type JevManagedRouteResult<T> =
  | { readonly status: 'denied'; readonly reason: 'no-candidates' | 'limit' | 'secret-unavailable' }
  | {
      readonly status: 'failed';
      readonly reason: 'audit-unavailable' | 'provider-failed';
      readonly possiblyBilled?: boolean;
    }
  | {
      readonly status: 'failed';
      readonly reason: 'outcome-audit-unavailable';
      readonly possiblyBilled: true;
    }
  | {
      readonly status: 'invoked';
      readonly candidate: RouteCandidate;
      readonly decision: JevDecision;
      readonly response: T;
      readonly possiblyBilled?: boolean;
    };

/** Coordinate an already authenticated managed request with narrow infrastructure ports. */
export async function invokeJevManagedRoute<T>(
  input: JevManagedRouteInput<T>,
): Promise<JevManagedRouteResult<T>> {
  const base: AuditBase = {
    principalId: input.principalId,
    credentialId: input.credentialId,
    policyVersions: input.policyVersions,
    requestId: input.requestId,
    routeVersion: input.routeVersion,
    modelAlias: input.modelAlias,
  };
  const eligible = authorizeCandidates({ ...input, routeKind: 'managed' }).candidates;

  async function deny(reason: 'no-candidates' | 'limit' | 'secret-unavailable') {
    try {
      await input.ports.writeAudit({ ...base, kind: 'denied', reason });
    } catch {
      return { status: 'failed', reason: 'audit-unavailable' } as const;
    }
    return { status: 'denied', reason } as const;
  }

  if (eligible.length === 0) return deny('no-candidates');

  try {
    if (!(await input.ports.checkLimit())) return deny('limit');
  } catch {
    return deny('limit');
  }

  let apiKey: string | undefined;
  try {
    apiKey = await input.ports.resolveSecret(input.jev.credentialRef);
  } catch {
    return deny('secret-unavailable');
  }
  if (!apiKey) return deny('secret-unavailable');

  try {
    await input.ports.writeAudit({
      ...base,
      kind: 'selection-started',
      eligibleCandidateIds: eligible.map((candidate) => candidate.id),
    });
  } catch {
    return { status: 'failed', reason: 'audit-unavailable' };
  }

  const selection = await selectManagedWithJev({
    principalActive: input.principalActive,
    modelAlias: input.modelAlias,
    candidates: eligible,
    statements: input.statements,
    jev: {
      apiKey,
      minimumConfidence: input.jev.minimumConfidence,
      sendPrompt: input.jev.sendPrompt,
    },
    ...(input.promptText !== undefined ? { promptText: input.promptText } : {}),
    ...(input.ports.fetchJev ? { fetcher: input.ports.fetchJev } : {}),
  });
  if (selection.status === 'no-candidates') return deny('no-candidates');

  try {
    await input.ports.writeAudit({
      ...base,
      kind: 'decision',
      candidateId: selection.candidate.id,
      decision: selection.decision,
    });
  } catch {
    return { status: 'failed', reason: 'audit-unavailable' };
  }

  const attempts = [
    selection.candidate,
    ...eligible.filter((candidate) => candidate.id !== selection.candidate.id),
  ];
  let earlierAttemptPossiblyBilled = false;
  for (const [index, candidate] of attempts.entries()) {
    let response: T;
    try {
      response = await input.ports.invokeDirect(candidate);
    } catch (error) {
      const failure = error instanceof DirectProviderFailure ? error : undefined;
      const possiblyBilled = failure?.possiblyBilled ?? false;
      earlierAttemptPossiblyBilled ||= possiblyBilled;
      try {
        await input.ports.writeAudit({
          ...base,
          kind: 'attempt',
          candidateId: candidate.id,
          outcome: 'failed',
          ...(failure ? { failureCategory: failure.category } : {}),
          possiblyBilled,
        });
      } catch {
        return { status: 'failed', reason: 'outcome-audit-unavailable', possiblyBilled: true };
      }
      const retryable =
        failure !== undefined &&
        !failure.responseStarted &&
        failure.category !== 'other' &&
        index < attempts.length - 1;
      if (!retryable) {
        return {
          status: 'failed',
          reason: 'provider-failed',
          ...(earlierAttemptPossiblyBilled ? { possiblyBilled: true } : {}),
        };
      }
      continue;
    }

    try {
      await input.ports.writeAudit({
        ...base,
        kind: 'attempt',
        candidateId: candidate.id,
        outcome: 'succeeded',
      });
    } catch {
      return { status: 'failed', reason: 'outcome-audit-unavailable', possiblyBilled: true };
    }
    return {
      status: 'invoked',
      candidate,
      decision: selection.decision,
      response,
      ...(earlierAttemptPossiblyBilled ? { possiblyBilled: true } : {}),
    };
  }
  return { status: 'failed', reason: 'provider-failed' };
}
