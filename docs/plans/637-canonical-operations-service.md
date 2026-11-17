# Canonical operations process entry (#637, #640, #643)

1. Add a separate explicit executable and trusted createCanonicalOperationsPorts module factory. Never infer write approval from a read-only or proxy factory. Preserve every existing entry and deployment default.
2. Require existing absolute public artifact path, reviewed SHA-256, trusted issuer/audience/JWKS and owned SQL connection. Reuse existing host/port parsing, process-owned clock/IDs, signal shutdown and generic diagnostics.
3. RED: substituting the read-only process rejects the operations factory and fails HTTP startup. GREEN: exercise isolated configuration/lifecycle and real loopback signed-bearer read/issue/revoke plus fresh Deny and durable-audit failure.
4. No cookie/BFF/session, grants, new DDL, migration selection, provider calls or deployment activation. Account DDL remains an explicitly approved prerequisite. Real IdP/native PostgreSQL/installed acceptance remains separate.
5. Obtain exact-HEAD full required CI and independent formal approval before ordered dependency merge.
