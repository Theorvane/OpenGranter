# Authenticated gateway policy validation

Runtime authenticator results are validated before immutable projection or downstream request processing. Active state must be boolean. An active result requires nonempty string principal/credential IDs and dense policy-version records with nonempty string IDs/versions. Each dense statement must have effect Allow or Deny and actual dense string arrays for actions/resources. Empty statement/pattern arrays remain valid and do not create a grant. Wildcard semantics are unchanged.

Malformed active authentication produces 503 authentication_unavailable and a required anonymous auth-unavailable audit. Failed required audit produces 503 audit_unavailable. No catalog, route, limit, provider, usage or audit-history read occurs. Invalid values and nested raw data are not reflected in responses or audit.

Absent and boolean-inactive authentication continue to return 401 with auth-denied audit. Valid principals retain the [immutable request context](gateway-principal-snapshots.md). This validates the existing policy subset rather than adding SSO or policy-language support.
