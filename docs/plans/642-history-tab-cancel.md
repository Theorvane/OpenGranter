# Cancel inactive history work (#642)

## Issue and problem
- Issue: #642, parent #637.
- History tab switches leave outgoing JSON/CSV work running. A late CSV can invoke the download adapter after its screen has been left.

## Scope and expected behavior
- Cancel outgoing local work when changing Usage/Audit tabs. Suppress late data, errors and CSV delivery using existing review cancellation.
- Retain applied filters and page navigation; returning performs the existing fresh authorized read. Ready/empty pages without pending work are unchanged.
- No new endpoints, identity/session decisions, grants, writes, migrations, retention, provider calls or public-entry activation. Cancellation cannot undo server processing or audit.

## Design
- Change only the history mount navigation handler: cancel previous review before selecting target, then perform existing target refresh; cancellation notifications must never render a cached destination ahead of its fresh authorization. Check the identity lifetime after cancellation notifications.
- Reuse review cancellation rather than duplicate transport revision logic. No open security decision is resolved by this local fix.
- Documents: docs/PRD.md, docs/architecture.md, docs/acceptance.md, contracts/management-history-workspace.md.

## TDD plan
- RED: public DOM tab switches must abort the outgoing request; current mount does not.
- Cover both directions, stalled JSON, pending CSV headers and body, late completion/denial disposal, same-tab no-op, return refresh with retained filters, terminal denial and disposal.
- GREEN: smallest mount change; run mount/workspace/session/build regression tests, strict typecheck/lint, planning checker and npm run check.

## Delivery
- Stack on #975 (exact 29fbac1); parent must satisfy its merge gates first.
- Report RED/GREEN and CI/review evidence separately. No installed/browser/IdP/provider success inferred from DOM/HTTP tests.
- Rollback removes outgoing cancel wiring; server authority and data formats are unchanged.

## Latest-parent integration (2026-11-19 09:00 KST)
- Integrate exact #946 741cb8dbc2c99b4e71217f6587748d49cdcf9505 into a separate issue-#637 integration PR stacked on the existing #976 UI candidate. Keep latest canonical API, mandatory audit, cancellation, filtering and token operations; no alternate authority or activation.
- Resolve Models detail overlap using the main-reviewed model-detail renderer including its CSP-safe multiline class, retaining later refresh and capability filters. Update equivalent label expectations, not privacy or security assertions.
- History pending-tab coalescing from the older parent is superseded by #976 explicit cancel-on-leave. Preserve same-active-tab no-op assertions and all newer reset and cancellation tests; record this contract difference explicitly.
- Reproduce missing canonical model metadata before resolution, then run both source/compiled detail and later UI regression tests. Fresh exact-head independent review and CI required; parent dependencies remain gates.

### Execution evidence
- RED: both source and compiled later Models renderer omitted canonical published labels; 0 pass / 4 fail. Integration uses the single main-reviewed model-detail renderer and removes the later duplicate, retaining refresh and capability filters. Parent CSP multiline test also passes.
- GREEN seven model/history/tab/operations/review suites: 70 pass / 0 fail / 0 skip. Additional nine regression files: 79 pass / 1 fail / 0 skip; embedded-PostgreSQL workspace file SIGKILL. Source/compiled artifact and dormant-entry group: 15 pass / 0 fail / 0 skip.
- HTTP/model/history/identity group: 2 pass / 2 fail / 0 skip; two owned HTTP/embedded-PostgreSQL files SIGKILL. Full TypeScript SIGKILL(-9); no unchanged resource retry or full-check success claim.
- Full Biome passes (42 warnings / 181 infos) after organizing integration import. Planning/link/fixture scan, six offline compatibility pins and staged/unstaged diff checks pass. Logs /tmp/og-190900-{red,green,regression,http,browser,typecheck,lint,scripts,compat}.log.
- #944 independently approved exact-head six-CI-green squash merged; #945 retargeted main but now conflicts, so no #945/#946 or integration merge. New integration requires #976 and #946 plus strict exact-head gates. No native GUI/company SSO/installed PostgreSQL/operator URL or provider acceptance performed.
