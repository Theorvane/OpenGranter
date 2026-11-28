# Canonical history filter reset (#986)

Refs #637, #642, historical #723. Canonical History lacks the existing legacy Clear filters action. Restore it for the active Usage/Audit tab only using existing review.load({}); clear that tab drafts, applied filters and CSV delivery alert. This is a fresh first-page authorized request, not a permission change. Other tab retains its own filters; initial Account scope is editable, not an authorization boundary. All reads/exports still authenticate and authorize server-side; denial terminally clears the shared workspace.

Ownership: LLM edits only the Clear filters block in history-app.ts, new management-history-reset.test.ts, this plan and contract/acceptance appends. No shell/entry/backend, session/runtime/DDL, activation or deployment. Independent review required. Independent of unmerged summary PR983; preserve its import/render hook when integrating.

TDD: RED missing-control test, then GREEN valid/invalid drafts, page cursor reset, active-tab isolation, cancelled pending CSV/late reads, detached control/denial/disposal guard. Run focused clients/DOM/workspace tests, lint, typecheck, planning and compatibility. Native browser evidence separate from fixture tests and real installed acceptance.
