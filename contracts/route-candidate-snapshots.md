# Evaluated route candidate snapshots

`authorizeCandidates` evaluates model/provider policy against a defensive candidate snapshot and returns only eligible immutable candidates in administrator order.

- Snapshot fields are `id`, `kind`, `upstreamModelId`, and `providerId`. Extra runtime fields are stripped. Source arrays/objects remain caller-owned and mutable.
- Each returned candidate, the candidate array, and the result are frozen. Updating/replacing source configuration later cannot change this authorization result or its provider/model grouping.
- Candidate fields are copied before provider evaluation. Route-kind filtering, direct/inherited policy semantics, explicit Deny precedence, and model-level default Deny remain unchanged.
- Managed selection/fallback/inference and delegated model/provider mapping use the evaluated snapshot across asynchronous callbacks. New configuration values apply only to a new authorization call.
- Snapshot mutation attempts follow standard frozen-object behavior. This contract does not change callback-exception handling, revalidate DB changes, or add a configuration reload mechanism.
- No secret values or unrelated caller fields are forwarded through snapshots.

## Executable cases

`test/route-candidate-snapshots.test.ts` reproduces source mutation across the public authorization, selection, and managed/delegated invocation boundaries. Existing route contracts continue testing eligibility and ordering.
