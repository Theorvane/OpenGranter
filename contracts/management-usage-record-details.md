# Scoped usage record details (#642)

1. Render a collapsed native `details` per already-authorized usage page row. No detail endpoint, additional request, grant, retention or session acquisition is introduced. Existing server-side scope and mandatory access-audit gates remain authoritative.
2. Reuse `projectUsageJson` to validate and copy the content-free allowlist and recompute exact decimal comparison. Render text only; never stringify raw extras. Malformed input produces only a generic unavailable summary.
3. Display request/attempt/credential attribution, recorded principal/policy/price versions, route/candidate/provider, latency/outcome, partial counters, estimated and reported amounts/source, duplicate and possibly-billed flags. Historical attribution is not current authority. Unknown is not zero; currency mismatch is not conversion. No invoice reconciliation claim.
4. No detail cache: loading, filters, page/tab changes, unavailable reads, terminal denial and disposal remove the current row/details together under existing history/operations lifetime rules. Native expanded state is intentionally not retained after a read.
5. Tests: renderer + history integration; owned HTTP with embedded PostgreSQL and synthetic RFC9068 identity checks principal isolation, mandatory audit outage/retry, fresh 401 and explicit IAM Deny 403. No additional read on expanding a row. Production IdP, installed PostgreSQL, external ingress and paid provider acceptance remain separate gates.

## 2026-11-16 local evidence

- Meaningful pre-integration RED: owned HTTP read returns the usage row but no detail element (0 pass / 1 fail).
- Focused four-file run: 45 pass, 0 fail, 0 skip. Covers two isolated real HTTP + embedded PostgreSQL cases; not full repository tests.
- Chromium at temporary loopback `http://127.0.0.1:18880/`: list -> expand native detail -> historical attribution and exact `0.000000000000000001` difference -> unmatched model filter removes details -> clear filter shows Loading without rows -> ready -> synthetic IAM deactivate -> Refresh clears rows while Loading -> Sign-in required with no operations. Synthetic credential stays server-side.
- This loopback harness is not deployed product access, company SSO login/logout, installed database or provider E2E. It is intentionally uncommitted and does not change public entry activation.
