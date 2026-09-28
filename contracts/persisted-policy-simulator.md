# Internal persisted policy simulator

`createPostgresPolicySimulator(client)` returns an async simulator for `{ principalId, action, resource }`. It is a trusted internal diagnostic; the caller must restrict access to policy metadata. It is not an authenticated endpoint or a grant to execute the simulated action.

- Principal IDs are nonempty strings of at most 256 characters; action and resource are nonempty strings of at most 512 characters. Invalid inputs throw `InvalidPolicySimulationInput` before SQL.
- Each call loads one consistent current principal/direct-policy/role-policy snapshot. A missing principal returns `undefined`, never an Allow. An inactive principal yields `Deny`/`inactive` with empty evaluated policy versions.
- Existing attachment evaluation supplies `Allow`/`allowed`, `Deny`/`implicit-deny`, or `Deny`/`explicit-deny` and resolved policy IDs/versions. Direct and inherited policies combine; every matching Deny wins. No partial Allow is returned from incomplete active attachments.
- The result contains only `effect`, `reason`, and `policyVersions`. Caller-supplied principal state/statements/roles/policy versions cannot affect evaluation. Stored unexpected fields and statements are never returned.
- Malformed/incomplete snapshots or driver failures throw fixed `PolicySimulationUnavailable`, without raw database errors or causes. No credential, upstream, audit append, usage append, or management mutation is called.
- The simulator evaluates IAM only; it does not authenticate tokens, validate catalog existence/routes, check limits, validate provider configuration, or contact inference. An IAM Allow is not a promise that an actual request will succeed.
- Changes between calls affect the next snapshot. Changes after a snapshot read are not revalidated. Reusing the evaluator aligns IAM decisions with the gateway for the same principal snapshot and action/resource, not different concurrent snapshots.
- Public simulator authentication, reader visibility, access audit, hypothetical policy inputs, and UI remain undecided.

## Executable cases

`test/postgres-policy-simulator.test.ts` covers persisted grants/denials, current version/attachment/state changes, bounded validation, safe failures, output projection, and comparison with the actual PostgreSQL HTTP gateway's IAM boundary.
