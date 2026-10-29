# Compatible upstream transient statuses

## Issue and problem

- Issue: [#554](https://github.com/Theorvane/OpenGranter/issues/554), refs #116.
- Registered upstream nonstream 429/503 currently becomes generic 502 despite bounded Retry-After delivery. Compatible clients lose the observed HTTP status.
- Primary reference checked 2026-10-29: [OpenRouter errors](https://openrouter.ai/docs/api_reference/errors-and-debugging). This increment does not parse provider error bodies or claim full typed error parity.

## Scope and expected behavior

- On /api/v1/chat/completions only, return exact observed upstream 429/503 after required failed-attempt usage and outcome audit. Numeric error.code equals HTTP status; fixed message, opengranter_code, unmapped error_type and request identifiers remain unchanged.
- /v1 retains generic 502/symbolic errors. Both bases retain the same bounded Retry-After parsing, required persistence, IAM/limits and approved destination controls.
- Only a typed429/503 scalar captured by a known adapter is eligible, matching rate-limit/server-error respectively and an upstream responseStarted===true flag. Missing, invalid, mismatched, unrelated/unclassified exception metadata and all other upstream statuses/timeouts remain generic 502. No inference from a category alone.
- Local denials/configuration/persistence failures and successful/unhinted fallback cannot inherit an earlier status or hint. Existing response-start/possible-billing flags, fallback and conservative usage remain unchanged.
- No raw body/header forwarding, new audit/ledger fields, new retries/sleeps, streaming status changes, exact provider error_type parsing, date hints or full #116 completion. Jev #7 stays unresolved.

## Design

Add a pure allowlist/category validator. The nonstream adapters capture only observed 429/503 into optional failure-class metadata. Coordinators revalidate/project it only on terminal upstream/provider failure after successful required handoffs. The compatible gateway chooses that bounded status; legacy ignores it. Fixed error serialization retains numeric/symbolic bodies and allows existing validated Retry-After on the selected429/503 as well as generic 502. Hint validity and status validity are independent.

Update [PRD](../PRD.md), [architecture](../architecture.md), [acceptance](../acceptance.md), [compatibility](../openrouter-compatibility.md), [error contract](../../contracts/openrouter-error-schema.md) and handoff. This follows the existing compatibility requirement without changing authorization or introducing new domain choices.

## TDD plan

- First add actual adapter→public HTTP regressions for both bases/four adapters, upstream 429/503 with/without hints. Expected red: missing compatible status, while legacy/other statuses remain unchanged.
- Cover category/status mismatch, malformed/custom metadata and unknown exceptions; required handoff delays/failure; admission/limits; fallback final-outcome isolation and existing private accounting.
- Update existing bounded-hint and pinned OpenAI/OpenRouter/AI SDK tests for the deliberate compatible status contract while keeping legacy assertions intact. Preserve exact header/body privacy checks.
- Make the smallest typed-scalar change, refactor green, run focused provider/routing/error/SDK regressions and npm run check with the documented CPU-affinity setup.

## Delivery

Open a ready PR linking this plan with exact red/green/full evidence. Status changes can affect client retry/backoff behavior; probes disable retries and do not certify every client's automatic policy or prevent duplicate billing. Rollback restores compatible generic 502 projection only. Pins, dependencies and storage remain unchanged.

## Verification evidence

- Initial red before production edits: 40 public cases, 16 expected missing compatible status failures and 24 passes. Minimal typed capture/projection made the initial focused selection green at 258 cases.
- Additional defensive red: 20 boundary cases, 2 expected failures for contradictory no-response metadata and 18 passes. Require responseStarted===true in constructors and terminal coordinator projection, preserving the existing hint contract independently.
- Final focused provider/routing/error/accounting/actual-SDK regression selection passed 278 cases. Includes spoofed/unclassified metadata, fallback final-outcome isolation, required persistence/admission gates and delayed handoff assertions.
- Typecheck, focused Biome, planning/link/fixture-secret checks, git diff --check and CLAUDE.md symlink passed. Six source pins, dependencies and migrations are byte-unchanged.

- Final npm run check passed: 7,785 total, 7,784 passed, zero failures/cancellations and one optional external PostgreSQL skip (~243 seconds). Typecheck, lint, planning/links/fixture-secret checks and all six offline pin integrity checks passed. Existing 42 lint warnings/65 infos remain unchanged.
