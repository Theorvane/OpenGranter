# User Model Discovery Source Schema Guard

## Issue and problem

- Issue: #528; refs #116.
- The user model discovery API has runtime and installed-SDK coverage, but its separate official operation has no structural drift guard. The existing five selections cannot detect user-operation query, security, or response-reference changes.
- PR #527 independently reviews drift in existing pins. Start from approved `main`; preserve those pin bytes and integrate that review only after approval and merge.

## Scope and expected behavior

- Add a sixth versioned pin for GET `/models/user`, operation `listModelsUser`: the complete inline `offset`, `limit`, `output_modalities`, and `sort` parameter objects, explicit operation security, HTTP 200 JSON schema, and whole `ModelsListResponse`, `ModelsListResponseData`, and `Model` definitions.
- Both offline integrity checks and live comparison cover six selections. Validate all pins before fetching; project all selections before printing results; perform one bounded fixed-host fetch without credentials; never write pins.
- No runtime API, IAM, upstream preference import, supported query values, secret, usage, or audit changes. This is source monitoring, not a claim of full compatibility. #116 and #7 remain open.

## Design

- Follow the existing bounded single-model projector with exact envelope/key validation and private diagnostics. Preserve security declarations literally, independently of JSON Schema annotation stripping. A pin requires explicit `[{"bearer":[]}]`; valid source security changes count as drift, while missing/malformed declarations fail safely.
- Select the list-root/array/item chain explicitly. Do not traverse arbitrary references, inherit top-level security, fetch external references, or duplicate the existing full model-metadata selection. Security-scheme component definitions and upstream account preferences are outside this selection.
- Keep a separate pin because `/models/user` has a different authentication contract and query operation from `/models`. No costly architectural decision or new domain term is introduced.
- Update `contracts/user-model-schema.md`, README, PRD, architecture, acceptance, OpenRouter compatibility, and handoff documents to state the exact scope and remaining limitations.

## TDD plan

- First add independent source-projection fixtures, expected parameter/security/response shapes, and malformed-input/drift cases; run them before adding the module and pin and record the expected missing-module failure.
- Cover each selected parameter's structure, selected definition changes behind stable references, explicit security changes, identities, annotations, unselected metadata, malformed or duplicate/inherited parameters, pin envelope/hash/date/version/canonicalization failures, and content-free diagnostics.
- Extend the controlled CLI fixtures: sixth-only and shared drift, all-six drift, invalid sixth pin before fetch, invalid sixth source without partial success, one-fetch credential-free behavior, and unchanged pin bytes. Run the new offline six-result expectation before CLI integration and record the failing assertion.
- Implement the smallest projector, pin, and CLI integration; format only touched TypeScript files and run focused tests, `npm run check`, and a fresh bounded source comparison. Report existing reviewed drift separately if #527 is still pending.

## Delivery

1. Record issue, branch, and this plan before code.
2. Write failing independent tests; implement the selected projection and reviewed pin.
3. Write failing six-pin CLI cases; integrate validation and comparison atomically.
4. Update contracts/planning/handoff, run checks, and open a ready PR with red/green evidence.
5. Require successful CI and an approval on the current SHA before merge.

Risks: upstream source may change while work is in progress; record its canonical SHA and retrieval date. A selected pin does not enable unsupported runtime fields or establish full OpenRouter compatibility. Roll back this guard and its CLI selection together if necessary; runtime behavior is unchanged.

Verification evidence will be recorded below and in the PR after execution.

## Verification checkpoint

- Red: the independent suite failed with `ERR_MODULE_NOT_FOUND` before the module/pin existed; the offline and controlled-live six-result cases then failed because the old CLI emitted only five results.
- One test fixture was corrected to omit absent security before hashing; JSON canonicalization correctly rejects JavaScript `undefined`. No production check was weakened.
- Green: independent user-model suite 67 passed; focused user/CLI/single/request suites 428 passed, zero failures; type checking, document checks and diff whitespace checks passed.
- Fresh official comparison matches the new user-model selection, count and single model. The three existing request/query/response drifts remain reported and independently reviewed by #526 / PR #527. The five previous pins are unchanged.
- Initial full gate on approved main 87512ac: `taskset -c 0-3 env -u NODE_NO_WARNINGS -u NODE_OPTIONS PATH="/home/ubuntu/.local/bin:$PATH" npm run check` passed: 7,078 total, 7,077 passed, one optional external PostgreSQL skip, zero failures/cancellations; types, lint, planning checks and all six offline pin checks passed. Log: `/tmp/opengranter-528-check.log`.

## Approved-base integration

PR #527 received approval on dd29d2fbdfcb4f53b0aff099fe37516cce6f0ed4 with all three checks successful and merged as 1704969; issue #526 closed. Rebase onto that approved main, retaining both sets of documentation sections and both reviewed-drift/sixth-guard CLI cases. The five existing pins remain byte-identical to the new main. Repeat focused, fresh-source and full verification on the integrated result; earlier three-drift observations above are historical.

## Integrated verification

- Focused user/CLI/single/request/reviewed-source suites: 446 passed, zero failures.
- Fresh bounded official comparison: all six selections pass. Log: `/tmp/opengranter-528-integrated-live.log`.
- Full gate on approved main 1704969 plus this change: 7,096 total, 7,095 passed, one optional external PostgreSQL skip, zero failures/cancellations. Type checking, lint, planning/link/contract/fixture-secret checks and all six offline pin checks passed. Log: `/tmp/opengranter-528-integrated-check.log`. Existing unrelated lint warnings remain.
- Final diff preserves all five existing pins, runtime, migrations and dependency files relative to 1704969.
