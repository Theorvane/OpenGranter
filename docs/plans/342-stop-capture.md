# Stop sequence capture consistency

## Issue and problem

- Issue: #342. The shared stop snapshot checks the array count but then executes
  caller iteration, allowing length drift or an unrelated iterator to bypass the
  four-entry cap or forward different values in local programmatic calls.
- HTTP JSON cannot carry these objects. No network exploit or secret disclosure
  is claimed; existing accepted JSON and provider mappings remain unchanged.

## Scope and expected behavior

- Capture one safe integer count from zero to four and fixed indexed strings once.
  Ignore custom iterators and freeze the copy before asynchronous external work.
- Preserve null/omission, literal strings, Unicode, empty arrays, indexed scalar
  lookup and malformed/sparse rejection. Invalid first captures fail without retry.
- All four adapters retain native stop/output-limit mappings and safe non-billable
  pre-secret failure. Shared IAM/Deny/limits/audit/usage/privacy remain unchanged.
- No capability, native larger-list, stream, schema or full #116 expansion.

## Design

- Replace caller for-of with validated bounded indexed capture. Snapshot length
  once; do not use spread/iteration, which would retain the original defect.
- The copy captures sequential indexed values; this does not guarantee atomic
  arbitrary caller object graphs or certify all Proxy behavior.
- Reversible implementation repair; no glossary or ADR decision is needed. Update
  stop contract, PRD, architecture, acceptance and compatibility inventory.

## TDD plan

- First public regressions fail for changing length, custom iterator substitution
  and an index getter appending entries during capture.
- Cover malformed counts/first entries, four-entry edge, sparse arrays, frozen
  copy, inherited indexed values and existing null/string/empty behavior.
- All adapter boundaries verify exact stops before credential-await mutation,
  malformed/throwing captures fail pre-secret, and HTTP/security suites stay green.
- Minimum implementation, focused tests, format and full npm run check.

## Delivery

- Issue/plan, recorded red/green, checks, exact-head AI review, required CI and
  human-account merge. Link the plan and disclose capture timing limits in the PR.
- Rollback restores the bound/traversal inconsistency. Pin v18 stays unchanged;
  model-specific constraints and complete compatibility remain under #116.

## Verification evidence

- Public regression red: 1 pass, 3 expected failures for count drift, iterator
  substitution and appended entries. All-adapter red: 18 passes, 8 expected failures.
- Focused stop/reasoning/tool/SDK green: 54 passes. All four native mappings retain
  captured stops/output limits; invalid/throwing captures fail safely pre-secret.
- Full npm run check passed strict types, linting, 1,551 tests with one existing
  PostgreSQL skip, planning/contracts/fixture scan and offline pin integrity.
- Existing HTTP/security/persistence/accounting/privacy gates remain green.
  Evidence-only plan update also passes the planning checker.
