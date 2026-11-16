# 642 Request-scoped usage review

1. Integrate existing canonical backend PR934 without reimplementing its request_id parser, SQL, IAM or audit contract. Preserve 945 client work. No session acquisition or activation.
2. RED: request identifier must be serialized by JSON/CSV clients, validated using exact existing 1–256 ASCII grammar, captured before await and checked against every returned JSON row. Invalid identifiers must not reach the transport.
3. Add Request ID filter to Usage and a row action that reloads the existing authorized list for the exact request within the existing principal scope (retain self mode by omitting principal_id); preserve other applied restrictions and clear pagination. Do not silently expand scope, claim complete history, sum costs or infer retries.
4. GREEN: real Node HTTP + signed synthetic RFC9068 access token + migrated embedded PostgreSQL exercise request intersection, pagination, CSV, fresh Deny and audit outage. DOM-port tests verify row action, loading, empty/error and cleanup. These do not certify real browser login or installed PostgreSQL.
5. Typecheck, lint changed files, scripts, compatibility and exact-head PR review/CI. No merge before independent formal approval and required CI. Deployment, TLS, real IdP, paid inference remain gated.
