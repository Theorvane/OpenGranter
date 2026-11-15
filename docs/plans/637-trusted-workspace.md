# Trusted management workspace (#637, #639)

1. Compose existing signed-SSO Models list/detail and History/Proxy-token operations into one opt-in trusted-session workspace. Keep public entry unchanged; do not acquire sessions or select credentials.
2. Consume the existing request/expiresAt grant. Navigation disposes its previous screen and owned downloads; logout, replacement, expiry and active 401/403 terminate the whole workspace. Stale replies cannot terminate a newer screen/session.
3. Before implementation run failing acceptance tests for navigation, actual signed-SSO HTTP list/detail transport, loading/empty/error/denial, expiry and token cleanup. Then run focused regression, typecheck, lint, planning and compatibility checks.
4. Submit exact-head CI and independent review; do not merge without formal approval. Browser login, installed PostgreSQL, provider calls and deployment remain separate outstanding gates.
