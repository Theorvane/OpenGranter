# Internal proxy-token lifetime caps

Issuance through createPostgresTokenManagementService uses the persisted target principal kind: human permits at most 30 days and service at most 90 days. A day is 86,400,000 ms. The requested absolute expiry must be after the captured credential creation time and at or before its owner-specific cap. Caller-supplied kind or maximum cannot alter this rule.

The service resolves the actor's current IAM snapshot, evaluates iam:Manage for the target, and persists the required authorization decision before reading the target kind. Denied policy and audit failure stop before the kind read. The owner read must return exactly one matching ID with a recognized kind; missing, malformed, duplicate, or failed reads prevent issuance.

After reading the cap, capture one timestamp for both the lifetime check and credential creation. Invalid expiry, unavailable kind, and failed issuance use the existing safe TokenManagementUnavailable contract. An allowed decision is authorization metadata, not an issuance-success claim. Credential mutation and the issued lifecycle event occur only on successful issuance and remain atomic.

Revocation and previously issued credentials retain their existing behavior; no retroactive truncation occurs. The lower-level trusted coordinator and credential primitive remain infrastructure boundaries with optional caller-supplied issuance guards; the product service always supplies the fixed kind-based guard. SSO authentication and a public management API are not introduced here. No transaction spans actor snapshot, authorization audit, target-kind read, and credential write.
