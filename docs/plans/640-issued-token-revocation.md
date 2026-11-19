# Issued token revocation handoff (#640)

1. Preserve existing SSO issuance/revocation contracts and trusted caller lifetime. No session acquisition, permissions, endpoint, schema or deployment changes.
2. Add a nonsecret credential-ID review handoff from successful issuance to the sibling revocation panel. Explicit activation clears the displayed bearer secret; it does not submit or revoke. Require the existing separate confirmation. Preserve standalone components.
3. Reject handoff while revocation is pending, locked or disposed; never replace an in-flight mutation. Invalidate retained actions, sanitize callback failure and never pass the bearer secret to the handoff. Cancel does not revoke.
4. Meaningful RED: issued credential exists but no handoff control. GREEN: exact credential reaches review without copying, only confirmation sends one existing revoke POST. Test stale actions, cancel, pending work, denial/disposal and unknown outcomes.
5. Exercise owned loopback HTTP with synthetic signed SSO and embedded PostgreSQL: issuance persists hashed credential/lifecycle event; handoff sends nothing; confirmed revoke persists atomic event and blocks subsequent token authentication. Fresh IAM Deny or audit failure must not produce a success claim.
6. Run focused regressions, full typecheck, changed-file lint, scripts and pins. Open draft PR; no merge before exact-head required CI and valid independent formal approval. Local/embedded/browser evidence is not installed/IdP/provider certification.

## Verification evidence

- Meaningful RED: issued credential exists, but the handoff button is absent (0 pass / 1 fail), /tmp/og2030-red.log.
- Final focused UI regressions: six files, 80 pass / 0 fail / 0 skip, /tmp/og2030-ui-final.log.
- Final owned HTTP + signed synthetic JWT + embedded PostgreSQL: four cases pass / 0 fail / 0 skip, /tmp/og2030-http-final.log. Credential verifies before revoke, cannot verify afterward; atomic lifecycle events persist. Fresh Deny, inactive actor and unavailable decision audit do not revoke or claim success. No secrets in test output.
- Initial uncapped HTTP run and combined regression with concurrent local preview were resource SIGKILL, not success. Final isolated HTTP uses Node heap cap80 after stopping only this preview. Full suite/full npm check not run locally.
- Full repository typecheck PASS (GOMAXPROCS1/GOGC20/GOMEMLIMIT192MiB, Node cap128); changed-file Biome, planning checker, six offline pins and diff check PASS.
- Actual Chromium temporary loopback18881: review issuance, confirm, show clearly public nonfunctional bearer replacement, handoff clears display and copies exact credential to separate confirmation, confirm revocation reports success through owned HTTP. Harness replaces real bearer response server-side with a PUBLIC NONFUNCTIONAL fixture label to prevent secret capture; full real-token behavior is covered by HTTP tests. Preview stopped after inspection to bound resource usage. Not persistent/external URL or company IdP acceptance.
- Exact-head CI and valid independent formal approval still required; no merge or deployment.

## Main integration, 2026-11-19 07:30 KST

- Parent PR943 is verified merged as bae3ed1596b3b5666e36a572e4ef559214a70c9a. Preserve reviewed main content when resolving stale stack conflicts; the net change remains the scoped issued-token handoff (three production modules). No authority/session/schema expansion.
- Fresh meaningful RED: remove the optional issuance handoff callback; the focused scenario fails because Review issued token revocation is absent (0 pass / 1 fail). Restore the production callback: six DOM/token/operations/session/history/Account files pass 96/96 with zero skips (/tmp/og-190730-red.log and /tmp/og-190730-ui.log).
- Fresh owned HTTP embedded PostgreSQL run was SIGKILL despite Node80/Go192MiB caps; fresh full-repository typecheck was Killed with Node128/Go192MiB caps. Neither is passing evidence, and aggregate npm run check was not completed locally. Do not overwrite the distinctly historical prior passing HTTP/typecheck evidence above. No unchanged resource retries.
- Full lint passes with 42 warnings and 181 informational diagnostics; planning/link/secret scan, six offline compatibility pins and whitespace checks pass. Logs /tmp/og-190730-{http,typecheck,lint,compat}.log.
- Page tools time out; desktop inspection finds Chromium renderer Aw, Snap! error code9 on an existing local evidence tab. No browser/display restart or kill; no fresh browser flow, installed database, company IdP, persistent URL or live-provider acceptance claimed.
- Exact updated-head required CI and a new independent formal review remain prerequisites to merging this integration.
