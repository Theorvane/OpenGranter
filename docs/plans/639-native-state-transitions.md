# Native boundary transition matrix (R1.5)

1. Scope: refs #639 and #637, extend the existing component smoke only. No session/API/security-policy implementation or installed-acceptance claim.
2. Cover all 25 ordered boundary state pairs, detached stale nodes, hostile Symbol/bigint/NaN/proxy/revoked-proxy input without property access, and recovery to loading after each unknown input.
3. RED: generate a temporary fixture with same-state mounting incorrectly short-circuited and verify native browser FAIL. GREEN: restore unchanged runtime source and verify PASS 9/9 expanded cases. Mutation output stays outside the repository.
4. Run focused generator/view/mount/auth tests and planning/whitespace checks. Require exact-head full CI and independent GitHub approval before merge. Contract decisions for real sessions and installed evidence remain blockers outside this slice.

## Observed evidence (2026-11-02 Asia/Seoul)

Native browser mutation RED retained the previous loading node and reported FAIL. Restoring unchanged production code produced PASS 9/9 expanded component cases, including all 25 ordered pairs and five hostile primitive/proxy recovery cases. An additional no-op mount mutation also failed. Focused generator/view/mount/Codex tests: 34/34 PASS, zero failures/skips on Node22.23.4; planning and whitespace checks PASS. No full local npm check, installed login/logout/expiry, Docker, VM, OAuth or paid-model acceptance is claimed.
