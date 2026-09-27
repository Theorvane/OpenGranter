import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import type { Statement } from '../src/policy/evaluate.ts';
import { evaluateAttachments } from '../src/policy/evaluate-attachments.ts';

interface AttachmentCase {
  readonly id: string;
  readonly principal: {
    readonly id: string;
    readonly kind: 'human' | 'service';
    readonly active: boolean;
    readonly policy_ids: readonly string[];
    readonly role_ids: readonly string[];
  };
  readonly roles: readonly { readonly id: string; readonly policy_ids: readonly string[] }[];
  readonly policies: readonly {
    readonly id: string;
    readonly version: string;
    readonly statements: readonly Statement[];
  }[];
  readonly action: string;
  readonly resource: string;
  readonly expected_effect: 'Allow' | 'Deny';
  readonly expected_reason: string;
  readonly expected_policies: readonly { readonly id: string; readonly version: string }[];
}

const fixture = JSON.parse(
  readFileSync(new URL('../contracts/attachment_cases.json', import.meta.url), 'utf8'),
) as { readonly cases: readonly AttachmentCase[] };

for (const scenario of fixture.cases) {
  test(`attachment contract: ${scenario.id}`, () => {
    const result = evaluateAttachments({
      principal: {
        id: scenario.principal.id,
        kind: scenario.principal.kind,
        active: scenario.principal.active,
        directPolicyIds: scenario.principal.policy_ids,
        roleIds: scenario.principal.role_ids,
      },
      roles: scenario.roles.map((role) => ({ id: role.id, policyIds: role.policy_ids })),
      policies: scenario.policies,
      action: scenario.action,
      resource: scenario.resource,
    });
    assert.deepEqual(result, {
      effect: scenario.expected_effect,
      reason: scenario.expected_reason,
      policyVersions: scenario.expected_policies,
    });
  });
}
