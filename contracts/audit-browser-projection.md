# Audit client publication closure

The production audit JSON and page CSV clients may publish only pure metadata validation/serialization dependencies, never a runtime PostgreSQL reader/writer module. Known-event projection and InvalidGatewayAuditEvent identity remain shared with the server. Exact request/principal/model/time/cursor checks and mandatory server audit are unchanged. The explicit reviewed-source builder remains required; this extraction grants no additional source, authentication or activation.

## Complete nested metadata

Policy-version and eligible-candidate arrays must validate every position, including holes. Reject incomplete evidence before a durable insert, or withhold the entire review/export result. Dense and empty arrays retain order and semantics; no replacement, compaction or fabricated policy/candidate is allowed. Top-level page completeness remains a separate contract.
