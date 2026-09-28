# Internal PostgreSQL token-management service

`createPostgresTokenManagementService({ client, now })` exposes `issue` and `revoke` to trusted application code. It does not authenticate actors or expose an HTTP endpoint. `authenticatedActorId` must originate from prior trusted authentication; accepting it directly from request data would permit impersonation.

- `issue({ authenticatedActorId, requestId, principalId, expiresAt })` returns the credential ID and one-time raw token on successful mutation.
- `revoke({ authenticatedActorId, requestId, credentialId })` returns the existing revocation result. The owner comes from stored credential state.
- IDs are nonempty strings of at most 256 characters. Expiry is a nonnegative safe integer; the credential primitive additionally requires future expiry relative to the injected clock.
- Each operation reads one consistent current actor/role/policy snapshot, with no actor cache. Extra caller fields (including actor state, statements, policy versions, or nominated owner) cannot affect evaluation or audit.
- Missing/inactive actors are denied with empty evaluated policy versions. Active unattached actors default deny; direct and inherited statements apply together, with explicit Deny precedence.
- Successful snapshot resolution feeds the existing `iam:Manage` owner-scoped coordinator. Required allow/deny decision persistence precedes credential mutation. Credential lifecycle events record successful completion atomically with mutation.
- Invalid inputs throw `InvalidTokenManagementInput` before SQL. Valid policy denials throw `TokenManagementDenied` after required decision persistence. Snapshot/read/write failures throw fixed `TokenManagementUnavailable` with no driver cause or secrets and no credential mutation.
- A failed snapshot read cannot produce a reliable policy decision and therefore writes no allowed/denied decision. A decision-write failure also prevents mutation.
- Policies changed between operations affect the next read. Changes concurrent with an operation after its snapshot read are not revalidated; no transaction spans snapshot, decision, and mutation.

## Executable cases

`test/postgres-token-management-service.test.ts` covers persisted role grants, direct Deny precedence, next-operation policy/attachment/active-state changes, missing actors, ignored forged fields, immutable owner scoping, malformed/unavailable snapshots, required decision-store failure, and invalid inputs before SQL.
