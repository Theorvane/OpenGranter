# Model identifier metadata plan

## Issue and problem

- Issue #478; release gate #116 and unresolved #7 remain open.
- Administrator snapshots reject standard optional hugging_face_id and architecture.tokenizer/instruct_type, withholding informational identifiers from authorized clients.

## Scope and expected behavior

- Accept own optional hugging_face_id and architecture.instruct_type strings or null, and own optional architecture.tokenizer strings. Preserve exact empty/blank/Unicode text, null and omission with a local 0..256 UTF-16 unit bound. Open enum strings remain open; no trim, coercion, format validation or invented default.
- Own undefined, wrong scalar types, tokenizer null and excessive strings invalidate the entire snapshot through existing fixed errors. Required metadata remains required. Capture each supplied value once and freeze it before asynchronous handoffs; inherited optional values remain absent.
- Preserve complete-catalog validation, enabled model AND final-provider IAM, current filters/order/paging, fresh page policy and required private audit. Expose fields only on compatible rich rows; basic/legacy payloads stay unchanged. No identifiers in operational events/errors.
- No Hugging Face fetching, URL resolution, tokenizer loading, prompt formatting, token estimation, model/provider mapping, routing/limits/accounting change, inference work or management/refresh API. Existing JSONB object/64 KiB cap and migrations remain unchanged.

## Design

- Extend the shared TypeScript known-field interface/allowlist and own scalar capture for the root identifier and nested architecture fields. Reuse bounded descriptive text/null handling while preserving required nonblank names.
- The pinned model-response schema already selects these fields and open enum definitions. [Official schema](https://openrouter.ai/openapi.json) and [models reference](https://openrouter.ai/docs/guides/overview/models) supply shapes; the structural schema permits future enum values. Pinned OpenRouter 1.4.18 maps huggingFaceId/instructType and retains tokenizer; OpenAI 7.23.0 retains extra raw JSON fields. Length limits and own-property capture are local restrictions.
- Reuse HTTP projection and PostgreSQL validation for listing and route resolution. Keep all three source pins byte-identical. No new domain term or irreversible trade-off/ADR is needed.
- Update [PRD](../PRD.md), [architecture](../architecture.md), [acceptance](../acceptance.md), [compatibility](../openrouter-compatibility.md), [base contract](../../contracts/model-discovery-metadata.md) and [identifier contract](../../contracts/model-identifier-metadata.md).
- Metadata publication review, stricter identifier semantics, tokenizer-based estimation, refresh and live provider certification remain separate decisions.

## TDD plan

- First public/SDK probes expect preserved own optional identifiers; the current allowlist returns 503 for valid fields. Record behavioral red before production changes.
- Cover known/future/empty/blank/null/omitted values, UTF-16 bounds, invalid scalars and own undefined, hidden malformed rows, nested/root getters, inherited omission, immutable capture across audit mutation and safe thrown getters.
- Verify model/provider/implicit Deny, authentication before catalog access, required dependency failure, basic/legacy shapes, unchanged capability/search behavior and no inference ports. Actual SDK sockets cover mappings, pagination, fresh Deny and private failures.
- Verify PostgreSQL fake list/route capture and safe malformed rejection, migrated PGlite JSONB round trips, no backfill and the existing cap. Apply the minimum validator extension, format changed files and run focused tests and full npm run check.

## Delivery

- Issue, new branch and this plan precede production code. Link contracts and record red/green and full-check results in the PR. Review the published exact diff; both required exact-head check jobs and sjungwon03-ai approval precede sjungwon03 squash merge.
- Rollback must remove newly supported stored fields before the old validator can accept those snapshots. Values are stale administrator data, never instructions or live tokenizer/capability guarantees. Full discovery, #116 and unresolved #7 remain open.

## Factual source check

A read-only factual sub-agent checked the fresh official schema and installed SDK on 2026-10-11: these Model/ModelArchitecture fields match the existing selected pin and accept open enum strings. The unrelated ImageModel tokenizer overlay is not applied to this endpoint. No product decisions were delegated.

## Verification evidence

Publish optional hugging_face_id and architecture.tokenizer/instruct_type in complete administrator model snapshots. Preserve exact strings, null/omission and open enum values with a local 256 UTF-16 unit bound; capture own scalars once in frozen snapshots. Invalid supplied values fail the whole catalog safely.

Shared HTTP/PostgreSQL validation retains complete-catalog checks, enabled model/final-provider IAM, required private audit, fresh page denial, approved routes and basic/legacy shapes. These identifiers never fetch resources, load a tokenizer, transform prompts, establish capability or affect token accounting. Existing JSONB shape/64 KiB cap, migrations and all three schema pins remain unchanged. Update the PRD, architecture, acceptance and contracts.

TDD: node --experimental-strip-types --test test/model-identifier-metadata.test.ts test/sdk-model-identifier-metadata.test.ts first produced 30 passes and 37 expected failures because valid identifiers received 503 catalog rejection, SQL snapshots failed and SDK calls rejected. All 67 new public/storage/SDK cases pass after the minimal validator extension. Full npm run check passes strict types, lint, 5782 tests with one existing PostgreSQL skip, planning/contracts/fixture scans and offline three-pin integrity.

Remaining risks: metadata may be stale; length/own-property rules are local restrictions, not source guarantees. Future enum strings remain informational. Downgrading requires removing newly supported stored fields. Metadata publication/refresh, broader fields, strict identifier semantics, full #116 and unresolved #7 remain open.
