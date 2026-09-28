import { evaluate, type Statement } from '../policy/evaluate.ts';

export type RouteKind = 'delegated' | 'managed';

export interface RouteCandidate {
  readonly id: string;
  readonly kind: RouteKind;
  readonly upstreamModelId: string;
  readonly providerId: string;
}

export interface CandidateAuthorizationInput {
  readonly principalActive: boolean;
  readonly modelAlias: string;
  readonly routeKind: RouteKind;
  readonly candidates: readonly RouteCandidate[];
  readonly statements: readonly Statement[];
}

export interface AuthorizedCandidates {
  readonly candidates: readonly RouteCandidate[];
}

/** Filter a versioned route's candidates before ranking, fallback, or any upstream call. */
export function authorizeCandidates(input: CandidateAuthorizationInput): AuthorizedCandidates {
  const modelDecision = evaluate({
    principalActive: input.principalActive,
    action: 'llm:InvokeModel',
    resource: `model:${input.modelAlias}`,
    statements: input.statements,
  });
  if (modelDecision.effect === 'Deny') {
    return Object.freeze({ candidates: Object.freeze([]) });
  }

  const candidates = input.candidates
    .map(({ id, kind, upstreamModelId, providerId }) =>
      Object.freeze({ id, kind, upstreamModelId, providerId }),
    )
    .filter((candidate) => {
      if (candidate.kind !== input.routeKind) return false;
      return (
        evaluate({
          principalActive: input.principalActive,
          action: 'llm:UseProvider',
          resource: `provider:${candidate.providerId}`,
          statements: input.statements,
        }).effect === 'Allow'
      );
    });

  return Object.freeze({ candidates: Object.freeze(candidates) });
}

/** Keep provider bounds separate for each upstream model attempt. */
export function authorizedProviderIdsForModel(
  authorization: AuthorizedCandidates,
  upstreamModelId: string,
): readonly string[] {
  return [
    ...new Set(
      authorization.candidates
        .filter((candidate) => candidate.upstreamModelId === upstreamModelId)
        .map((candidate) => candidate.providerId),
    ),
  ];
}
