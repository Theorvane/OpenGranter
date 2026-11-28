# Owned-routing durable audit metadata (#1014)

The existing `gateway_audit_events` append and principal-scoped history contracts accept three additional event kinds. Every event has required `kind`, `requestId`, `principalId`, `credentialId`, `policyVersions`, `routeVersion` and `modelAlias` fields. Attribution and identifier grammars match existing gateway audit projection. Policy versions contain only `id` and `version`, at most 1024 entries. No new table, permission or gateway activation is introduced.

| Kind | Required additional fields |
| --- | --- |
| `owned-selection-started` | `candidateIds`: 1–1024 distinct valid identifiers |
| `owned-selection` | `candidateId`; `selection`: `strategy` or `deterministic-fallback`; `strategy`: `administrator-priority`, `jev-research` or `custom` |
| `owned-denied` | `reason`: `no-candidates`, `configuration` or `reservation` |

These are closed plain data records: missing, extra, inherited, symbol, nonenumerable or accessor fields reject. Arrays must be dense data arrays without extra fields. Candidate identifiers and order are retained exactly. Empty policy-version arrays retain the existing attribution contract. Cross-request candidate membership cannot be inferred by this stateless projector; the core owns eligibility enforcement.

The public append boundary validates unknown input before SQL; the exported event type describes valid metadata. It rejects unknown event kinds and malformed owned events with fixed `InvalidGatewayAuditEvent`, without storing prompts, responses, raw credentials, credential references, raw Jev responses or arbitrary metadata. Strategy values are bounded provenance labels, never raw custom strategy IDs. Existing event projections retain their prior behavior.

History uses the same projection, request/model/time filters, cursor and principal scoping. HTTP reads still require explicit `audit:Read` on the target principal, including self reads; explicit Deny wins. Malformed stored pages fail closed as `AuditHistoryUnavailable`; required read-audit failure still withholds the page. CSV and SSO readers share the projector and existing permissions.

## Failure and recovery

The [existing acknowledgement contract](gateway-audit-acknowledgement.md) applies without retry or exactly-once claims. SQL rejection or missing/malformed acknowledgement becomes fixed `GatewayAuditUnavailable`. Append success requires the caller-owned committed/autocommit SQL boundary; a transaction-local returned row alone does not establish commit. The core awaits started and selection events before recommendation/inference and awaits denial events before returning a denial. A failed preselection append must stop selection and inference.

After a timeout, lost acknowledgement, rollback or process crash, a request-correlated event may be absent or present. Do not silently discard the failure, replay inference, retry append automatically, or infer completion/billing from a started event. Investigate the existing request-scoped audit and usage history; any deliberate new request is subject to fresh authentication, IAM and admission checks. There is no new recovery queue or parallel ledger, and crash reconciliation/exactly-once delivery remain unresolved product work.

## Dependencies and evidence

The producer is unmerged PR #1007 at `7a494e20e5fbb2df6b8bc6c7a1f7e6636e4ace04`. This main-based slice accepts its genuine events without importing or activating that core. Reservations and durable usage reconciliation (THE-18), authenticated composition (THE-20), installed PostgreSQL and operational acceptance remain separate prerequisites. A `reservation` denial is metadata compatibility, never proof that reservations exist. `jev-research` provenance neither enables Jev nor certifies its response schema.
