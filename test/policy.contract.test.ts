import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { evaluate, type Statement } from '../src/policy/evaluate.ts';

interface PolicyCase {
  readonly id: string;
  readonly principal_active: boolean;
  readonly action: string;
  readonly resource: string;
  readonly statements: readonly Statement[];
  readonly expected: 'Allow' | 'Deny';
}

const fixture = JSON.parse(
  readFileSync(new URL('../contracts/policy_cases.json', import.meta.url), 'utf8'),
) as { readonly cases: readonly PolicyCase[] };

for (const scenario of fixture.cases) {
  test(`policy contract: ${scenario.id}`, () => {
    const result = evaluate({
      principalActive: scenario.principal_active,
      action: scenario.action,
      resource: scenario.resource,
      statements: scenario.statements,
    });
    assert.equal(result.effect, scenario.expected);
  });
}
