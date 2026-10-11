# Pre-registered SSO identity bindings plan

## Issue and problem

- Issue #486. The contributor confirmed administrator-pre-registered issuer/subject bindings and API-specific SSO JWT access tokens on 2026-10-11, resolving Q4/Q5 in the [earlier plan](105-sso-management-foundation.md).
- Persisted IAM principals exist, but no SSO binding table/reader does. The trusted internal management service requires an authenticated principal ID. Public management authentication is still unimplemented.

## Scope and expected behavior

- Migration011 adds exact issuer/subject -> existing principal bindings with a composite primary key and FK. A principal may have multiple bindings; no automatic creation, email/username fallback or normalized/cross-issuer lookup.
- Internal reader captures own issuer/subject once before a single parameterized consistent binding/principal query per operation. Only an active human returns its principal ID; missing mapping, inactive human or service yields undefined. Duplicate/inconsistent/malformed SQL results and driver/getter failures yield fixed safe availability errors without claims/causes.
- Local input bounds: opaque issuer1..2048 and subject1..256 UTF-16 units, excluding NUL/ill-formed Unicode. Preserve exact whitespace/case/Unicode/URL spelling; do not conflate this reader with the pending JWT issuer URI/trust or access-token claim profile. Invalid input fails before SQL. Freeze projected SQL parameters and ignore extra caller fields; reload current binding/kind/active state each call without a cache.
- No JWT decoding/verification, issuer/JWKS fetching, public HTTP authentication, principal/policy creation, mutation, audit append, secret/inference or usage work. Existing IAM/Deny/required audit, token lifetimes and proxy/discovery/routing behavior remain unchanged.

## Design

- Add TypeScript createPostgresSsoIdentityBindingReader with resolveHumanPrincipal, narrow SQL port and safe InvalidSsoIdentityBindingInput/SsoIdentityBindingUnavailable errors. Select exact binding fields plus principal ID/kind/active; validate the complete result before returning only a string ID. Use explicit C collation on binding key columns so database locale cannot merge exact identities. FK deletion remains restricted like existing IAM attachment tables.
- Add migration011 to the strict bundled manifest; preserve every historical SQL file. Nonempty bounded text checks are storage guards, with UTF-16/well-formed validation at the reader. No unique principal-only constraint is implied by pre-registration.
- [OIDC Core claim stability](https://openid.net/specs/openid-connect-core-1_0.html#ClaimStability) supports issuer+subject identity rather than email/name. Its ID-token subject bounds are not silently adopted as the selected access-token profile. [RFC9068](https://www.rfc-editor.org/rfc/rfc9068.html) is relevant to later token verification, not implemented here.
- Prefer a read foundation over prematurely adding account creation or a public authentication boundary. Record the agreed term in [CONTEXT](../../CONTEXT.md) and the enrollment/API-auth trade-off in [ADR0008](../adr/0008-pre-registered-sso-management.md).
- Update [PRD](../PRD.md), [architecture](../architecture.md), [acceptance](../acceptance.md), [SSO foundation contract](../../contracts/sso-management-foundation.md), [binding contract](../../contracts/sso-identity-bindings.md) and [compatibility inventory](../openrouter-compatibility.md).
- Still open: JWT issuer/audience/algorithm/key/rotation/token-type/expiry/skew profile, public HTTP paths/errors/authentication audit, management binding/provisioning lifecycle and policy concurrency. Binding resolution grants no management permission or durable authentication guarantee.

## TDD plan

- First migrated-storage tests expect binding storage, uniqueness and exact read semantics; current migrations lack the relation and must fail before production changes. Add reader tests before implementation for success, denial and failure boundaries, then minimal migration/reader.
- Test exact cross-issuer/case/Unicode/whitespace identities, multi-binding principals, uniqueness/FK/deletion behavior, no account creation, missing/inactive/service denial and next-call state changes.
- Test own input getters once, asynchronous mutation, fixed errors without claims/causes, malformed/duplicate/mismatched SQL data, thrown driver/result getters, ignored extra fields and immutable parameterization. Test forged caller state cannot replace persisted human kind/active state.
- Format changed files; run focused tests, migration bundle regressions and full npm run check including unchanged OpenRouter pins.

## Delivery

- Issue/new branch/plan before production code; exact-head sjungwon03-ai review/approval and both CI checks before sjungwon03 squash merge/main sync. PR reports red/green, full checks, plan/contract and remaining risks.
- Additive empty table needs no backfill and does not change existing readers. Trusted administrator provisioning/audit is separate; rollback must deliberately remove bindings before dropping the new table. No edits to historical migrations. Read-time state may change after this query; later management operations still need current policy evaluation. Public JWT/management, catalog publication/refresh, full #116 and unresolved #7 remain open.

## Verification evidence

Persisted IAM principals lacked an SSO identity mapping. Following the contributor's confirmed pre-registration and API-specific JWT choices, add migration 011 and an internal resolveHumanPrincipal reader. One parameterized joined query returns only an existing active human ID for an exact issuer/subject binding; missing mappings, inactive humans and service principals return undefined. Multiple bindings can name one principal. No automatic account creation, email fallback or identity normalization occurs.

Capture own required inputs and persisted result fields once, freeze projected SQL parameters, validate complete results and sanitize input/driver/getter/malformed/duplicate/mismatched failures without claims or causes. Reload binding/kind/active state each operation. C-collated composite keys and a restricting foreign key preserve exact identities. Historical migrations and all three OpenRouter pins remain byte-identical. This foundation does not verify JWTs, authenticate public requests, write bindings, grant policy rights or call audit/secrets/inference/usage ports.

TDD: before production changes, three storage tests failed for the absent table and old migration manifest. After the reader tests were written, the initial deny-only typed skeleton produced 54 expected behavioral failures and four denial passes: active human resolution returned undefined, invalid inputs/results did not raise their required errors, and the relation was still absent. The minimal migration/reader made the initial 67 focused cases green. Full validation revealed an existing gateway startup assertion pinned to migration 010; update its expected history and the migration-runner fixture to include 011, and verify an existing populated 010 database upgrades without backfill or historical checksum changes. All 92 focused cases pass, including 62 new cases. Full npm run check passes strict types, lint, 6193 tests with one existing PostgreSQL skip, planning/contracts/fixture scans and offline schema integrity.

Remaining scope: local opaque-string limits (issuer 1–2048, subject/principal ID 1–256 UTF-16 units, no NUL/ill-formed Unicode) are read bounds, not a JWT issuer-trust/access-token profile. SQL character-count guards are coarser than UTF-16 reader bounds. State changes after the joined read are not revalidated. Signature, issuer/audience/algorithm/key/JWKS/rotation/token-type/expiry/skew validation, public HTTP authentication/errors/audit, and audited administrator binding provisioning remain separate work. Current IAM and mandatory management decision audit still apply; no production login path is enabled here. Catalog publication/refresh, complete #116 and unresolved #7 remain open. Additive rollout requires shipping migration 011; rollback must deliberately handle its bindings before table removal.

