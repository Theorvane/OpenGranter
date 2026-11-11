# Browser usage JSON transport

## Issue and problem
- Issue: #642, parent #637. Usage review UI lacks a caller-authorized JSON page adapter.

## Scope and expected behavior
- Read fixed GET /management/v1/usage JSON using existing principal/model/time/limit/cursor filters. Preserve unknown usage, estimated versus billed money and duplicate markers without repricing.
- No UI/session/token storage/runtime activation/provider calls/database changes. Frontend owns view/session integration. Server IAM remains authoritative.

## Design
- Same no-store, bounded UTF-8/deadline and invalidation semantics as CSV. Strict JSON media/list/continuation grammar; validate and copy allowlisted records using existing parseStoredUsageRecord. Check requested filters and order; never synthesize caller principal.
- Depends on PR843. No new authority or BFF decisions.
- Contract: ../../contracts/management-usage-client.md. Endpoint: ../../contracts/sso-usage-history.md.

## TDD plan
- RED missing module; then unknown costs/markers, empty/malformed pages, order/filter isolation, status-only errors, bounded body and stale cancellation. Include signed SSO + migrated embedded SQL + durable HTTP integration.
- Focused tests, full typecheck/lint/docs, standard npm run check; not browser/installed/real IdP acceptance.

## Delivery
- Exact-head CI and independent formal review before merge. Rollback removes adapter; no data migration.

## Verification evidence
- RED missing-module import: /tmp/og-0100-json-red.log. GREEN30/30 zeroSKIP: /tmp/og-0100-json-green4.log, JSON10 + CSV13 + durableHTTP7. Includes signed JWT/migrated PGlite/real Fetch with SQL durable audit, fresh identity denial and failed audit withholding. Additional reported-cost test initially failed due to invalid fixture null provider ID; fixture corrected to optional undefined.
- Full typecheck and lint pass (existing42warnings161infos); planning/links/fixture scan, six offline compatibility pins and browser-platform esbuild16.2KiB pass. Standard npm run check is a separate pending gate; no full-pass claim.

## Response integrity follow-up
- Before implementation, regress identity Content-Length mismatch at EOF (short and long), UTF-8 bytes versus characters, and compressed Fetch decoded length. Withhold otherwise valid JSON pages whose uncompressed declared length disagrees with observed bytes. Missing Content-Length and compressed bodies retain existing streaming bounds. No session/runtime/permission change.

- 2026-11-11 integrity RED: /tmp/og-0730-json-red.log, 11 pass/1 expected mismatch failure. GREEN: /tmp/og-0730-json-green.log, JSON+CSV30/30 zero skip; typecheck, focused Biome, docs and diff check pass. Rebased on main f85a2af preserving both CSV BOM and byte-integrity changes. Standard full check /tmp/og-0730-fullcheck.log is running, not yet a pass claim. Previous component-equivalent sequential run at prior4d360cb completed9322total9321pass0fail1skip, not exact standard command or current HEAD.

## Pending-request filter snapshot correction
- Before production edits, regress caller mutation during a pending request. Capture only the six allowlisted scalar filters once before query construction; use that same snapshot for response isolation, bounds and cursor checks. Valid original-scope pages must remain usable, while pages matching only mutated filters must be withheld. Exercise accessor inputs without reading any accessor twice. No server authorization, UI/session, runtime or deployment change.

- Snapshot correction evidence: corrected regression against old production gives 12 pass/3 expected failures (/tmp/og-0800-snapshot-red-corrected.log); initial regression used a duplicate attempt cursor fixture and was corrected before final evidence. JSON+CSV+durable SQL HTTP GREEN36/36 zero skip (/tmp/og-0800-snapshot-green2.log); full typecheck, focused Biome, planning/contract scan and diff check pass. Previous exact61677b standard npm run check completed9327total9326pass0fail1skip; the new head still needs its own full check and CI/review.
