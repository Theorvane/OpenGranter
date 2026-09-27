import {
  authorizeCandidates,
  type CandidateAuthorizationInput,
  type RouteCandidate,
} from './authorize-candidates.ts';

export interface ManagedSelectionInput extends Omit<CandidateAuthorizationInput, 'routeKind'> {
  readonly select: (eligible: readonly RouteCandidate[]) => Promise<string>;
}

export type ManagedSelectionResult =
  | { readonly status: 'selected'; readonly candidate: RouteCandidate }
  | { readonly status: 'no-candidates' }
  | { readonly status: 'invalid-choice' };

/** Keep an external selector inside the IAM-approved direct candidate set. */
export async function selectAuthorizedManagedCandidate(
  input: ManagedSelectionInput,
): Promise<ManagedSelectionResult> {
  const eligible = authorizeCandidates({ ...input, routeKind: 'managed' }).candidates;
  if (eligible.length === 0) return { status: 'no-candidates' };

  const chosenId = await input.select(eligible);
  const candidate = eligible.find((candidate) => candidate.id === chosenId);
  if (!candidate) return { status: 'invalid-choice' };
  return { status: 'selected', candidate };
}
