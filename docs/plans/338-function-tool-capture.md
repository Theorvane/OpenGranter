# Function tool control capture consistency

## Issue and problem

- Issue: #338. Public tool declaration/choice snapshots reread definition fields
  between validation and projection, allowing later invalid values into output.
- Tools-array length can change between cap check/copy; nested schema-array length
  can change during descriptor traversal and silently drop data. Local accessors/
  Proxy length traps reproduce the defects. HTTP JSON cannot contain these objects;
  no network exploit or credential disclosure is claimed.

## Scope and expected behavior

- Capture tools length/positions and each used type/function/name/description/
  parameters/strict value once; freeze/project only validated captured values.
- Named tool choices use the same first captured name; optional undefined remains
  omitted and strict boolean/null stays exact. Preserve plain/null prototypes,
  exact keys, nonempty 64-unit names and 20,000 declaration cap.
- Nested JSON arrays use one validated length; keep descriptor-based accessor
  rejection without getter execution, sparse/cycle/depth/node-budget checks and
  deeply frozen parameter copies. Shared bounded JSON response formats stay valid.
- No accepted JSON/provider/policy/schema expansion. Native unsupported guards,
  auth/IAM/Deny/limits/persistence/privacy/accounting remain shared; #116 stays open.

## Design

- Snapshot fixed indexed tool entries before reading definition getters. Capture
  tool/definition fields into constants, then validate and project frozen records.
- Capture nested JSON-array length once for bounds and descriptor traversal; do not
  replace descriptor-only nested values with spread/getter reads.
- Invalid first capture rejects without retry. Position snapshots do not promise
  atomic frozen arbitrary caller object graphs before getter execution.
- No domain term/ADR; reversible consistency fix. Update contracts, architecture,
  acceptance and compatibility documentation; pin v18 remains unchanged.

## TDD plan

- Public getter regression first fails: declared/selected names and optional fields
  must use first validated values, never invalid later values.
- Fixed entry/length and nested array-length cases preserve original data/bounds.
- Invalid-first controls, optional undefined, unknown/prototype/sparse shapes,
  nested accessors/cycles/depth/node budgets and deep freezes remain covered.
- Direct/delegated adapters assert exact controls through credential-await mutation;
  malformed/throwing accessors fail safely pre-secret and native guards remain.
- Existing SDK/HTTP/tool/response-format/security suites, format/full npm run check.

## Delivery

- Issue/plan, meaningful red, minimum fix, focused/full checks, exact-head AI review,
  required CI, human-account merge and clean main sync.
- Risk: capture timing changes for local programmatic inputs only; accepted JSON
  contracts remain unchanged. Rollback reopens validation/projection inconsistency.

## Verification evidence

- Public regression red: 1 passed, 5 expected failures for repeated fields/choice,
  declaration length/position drift and nested schema-array element loss.
- Focused tools/history/response-format/SDK green: 69 passed. Direct/delegated
  invokers retain exact declared/selected controls through credential mutation;
  invalid first fields and throwing accessors fail safely before secrets.
- Final npm run check passed strict types, linting, 1,529 tests with one existing
  PostgreSQL skip, planning/contracts checks and offline pin integrity. Nested
  accessors remain unread; bounds/depth/cycles/budgets and shared format consumers
  stay covered. Evidence-only plan update also passes the planning checker.
