# Public managed OpenAI text streaming

Activate managed OpenAI text/refusal streaming through an optional trusted gateway port on both /v1 and /api/v1 and generate that port from stored native registrations in persisted direct/dual servers. Retain complete model/final-provider IAM, limits, Jev/order selection, required usage/audit and bounded cancellation. Reject managed tools/tool histories before inference; unsupported native registrations fail before provider-key lookup without silently changing candidate selection. Exact upstream model IDs remain required. Native tools, Anthropic/Gemini streaming and full #116 remain open.

This public subset preserves fixed destinations and captured scope. It does not
claim full #116 compatibility.

## Persisted history regression

Persisted stream acceptance also exposed a pre-existing audit-history ordering bug: selecting event_id as text made unqualified ORDER BY event_id lexicographic at event 10. This increment includes numeric source-column ordering, verified across multi-digit IDs and keyset pages, so the required metadata remains readable after multiple streams.

Before the fix, add a public reader regression with 12 events and verify incorrect first-page IDs (9, 8, 7 instead of 12, 11, 10), as well as the public HTTP AuditHistoryUnavailable failure with a larger page, then assert descending numeric IDs and stable keyset pages.

## Acceptance cases

- Both bases deliver only the authorized alias through the registered fixed OpenAI host; the final usage and DONE follow required ledger and outcome audit writes.
- OpenAI 7.23.0 and OpenRouter 1.4.18 parse the native text subset on both bases. SDK abort cancels the native body and records one failed possibly billed attempt. Missing native usage remains missing in the ledger, with no fabricated client counters.
- Authentication, explicit model/provider Deny and limits stop provider secrets and upstream calls. Managed tool controls/history reject even when a delegated function port is present. Unsupported selected Anthropic/Gemini kinds fail before their provider key.
- Required ledger or outcome-audit failures after output produce a safe stream error and no DONE. Persisted direct/dual factories replace runtime adapter overrides with generated captured native adapters.
- Audit history remains readable beyond event ID 9 and keyset pages follow descending numeric IDs.

Native model IDs must exactly match registration route scope; automatic snapshot equivalence, live provider certification, native tool streams and broader release gates remain unresolved. Optional Jev credential lookup remains at the established coordinator stage, before the selected provider adapter.
