# Referenced JSON-schema format source drift

## Issue and problem

- Issue: #298; release gate #116 stays open.
- Runtime #297 forwards bounded JSON-schema formats, but the version-15 source
  projection only sees their parent reference, missing inner definition drift.

## Scope and expected behavior

- Select exactly ChatFormatJsonSchemaConfig and ChatJsonSchemaConfig in the
  existing definitions map; bump the reviewed pin/projector to version 16.
- Detect inner discriminator/reference, name bounds, schema object shape,
  description/strict types, required lists and literal default changes while
  parent references remain fixed. Ignore editorial annotations/unrelated formats.
- Reject missing/malformed sources, rehashed invalid exact maps and versions 1..15.
- No runtime, model/provider, IAM, credential, usage or audit behavior changes.
  This is partial structural drift coverage, not instance/output certification.

## Design

- Extend the existing explicit definition allowlist and exact-map validator.
- Explicitly retrieve from the existing bounded credential-free fixed-host
  fetcher; compare the old projection before replacing the pin. Preserve all
  existing selections and record reviewed source/projection digests.
- Update drift contract, acceptance and compatibility inventory. PRD/architecture
  runtime behavior and domain vocabulary do not change; no new ADR is needed.
- Open dependencies: other referenced formats, full instance conformance, native
  schema mappings and #116 release gates remain unresolved follow-up scope.

## TDD plan

- Add exact new-definition selection and unchanged-parent drift cases first;
  expect absent definitions/undetected drift before implementation.
- Cover malformed/missing source definitions and rehashed invalid maps, stale
  version rejection, annotation omission and literal annotation-like data keys.
- Minimal change: two allowlist entries and pin version; preserve old projections.
- Run focused drift tests, npm run check and explicit compatibility:drift.

## Delivery

- Issue/plan, tests/red, minimal implementation and reviewed pin refresh/green,
  full checks, exact-head review/CI, merge using authorized account roles.
- Risk: accidental source drift acceptance; compare every old selection first
  and disclose any unrelated source digest change rather than hiding it.
- Verification evidence and remaining gaps are recorded in the PR.

## Verification evidence

- Initial drift test red: 92 passed, 7 expected failures (v15/absent selections,
  undetected inner drift, invalid sources/maps and stale-pin acceptance).
- Focused green: 99 passed, no failures.
- Explicit fixed-source comparison: prior projection unchanged; canonical
  source SHA-256 f6041af462fa5dfea4b1ea246bcb02a208a57af2784fb7110a212e637d0e913e.
- New projection SHA-256:
  48937004d7e679a75bf61a6775716898b1a5b93d0875b041f8cf23f970a3e2f0.
- Live compatibility:drift passed; full npm run check results are in the PR.
