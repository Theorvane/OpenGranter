import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import type { Statement } from '../src/policy/evaluate.ts';
import {
  authorizeCandidates,
  authorizedProviderIdsForModel,
  type RouteCandidate,
  type RouteKind,
} from '../src/routing/authorize-candidates.ts';

interface RouteCase {
  readonly id: string;
  readonly principal_active: boolean;
  readonly model_alias: string;
  readonly route_kind: RouteKind;
  readonly candidates: readonly {
    readonly id: string;
    readonly kind: RouteKind;
    readonly upstream_model_id: string;
    readonly provider_id: string;
  }[];
  readonly statements: readonly Statement[];
  readonly expected_candidate_ids: readonly string[];
  readonly expected_provider_ids_by_model: Readonly<Record<string, readonly string[]>>;
}

const fixture = JSON.parse(
  readFileSync(new URL('../contracts/route_cases.json', import.meta.url), 'utf8'),
) as { readonly cases: readonly RouteCase[] };

for (const scenario of fixture.cases) {
  test(`route contract: ${scenario.id}`, () => {
    const candidates: RouteCandidate[] = scenario.candidates.map((candidate) => ({
      id: candidate.id,
      kind: candidate.kind,
      upstreamModelId: candidate.upstream_model_id,
      providerId: candidate.provider_id,
    }));
    const result = authorizeCandidates({
      principalActive: scenario.principal_active,
      modelAlias: scenario.model_alias,
      routeKind: scenario.route_kind,
      candidates,
      statements: scenario.statements,
    });
    assert.deepEqual(
      result.candidates.map((candidate) => candidate.id),
      scenario.expected_candidate_ids,
    );
    for (const [upstreamModelId, providerIds] of Object.entries(
      scenario.expected_provider_ids_by_model,
    )) {
      assert.deepEqual(authorizedProviderIdsForModel(result, upstreamModelId), providerIds);
    }
  });
}
