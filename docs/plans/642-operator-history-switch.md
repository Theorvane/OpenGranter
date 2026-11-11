# Operator history switch (#642)

1. Keep scoped history disabled when OPENGRANTER_SSO_HISTORY_READS is absent. Accept only exact true/false strings; reject empty, whitespace and other values before DB ownership.
2. Propagate explicit boolean through the public-trust loader and owned browser process into the existing opt-in listener. Reject nonboolean module fields before starting.
3. Demonstrate failing then passing loader/service tests, run runtime regressions and static checks. Require exact-head CI and formal review after parent #864.

No session, cookie, IAM grant, provisioning, production activation or paid call. Local process tests are not installed/browser acceptance.

4. Integrate the merged optional artifact-integrity gate without weakening either switch. Preserve both loader fields and module validation across the shared source edits. Test exact pinned public bytes plus true/false/absent history through the real loader and loopback listener; malformed configuration must open no database.
5. Keep this change stacked on #864 until its exact-head approval and CI gates allow merge; then rebase this PR and repeat exact-head CI/review. These local SQL/HTTP tests use ephemeral PGlite and in-memory fixture signing keys, not an installed IdP, browser session, provider or production acceptance.

6. Integration evidence: on the original #865 stack (52610bd, before #866), the four combined-loader tests failed: the pin was silently absent and malformed pins were accepted. Merge #866 main 8aa7192 and resolve both shared-source gates without dropping either. Four tests then passed; the 18-case focused loader/process/bootstrap/history suite passed with zero skips, TypeScript noEmit, changed-file Biome and documentation checks passed. This is a stack-integration RED/GREEN result, not a claim that reviewed #866 alone was broken or that full local npm check or installed acceptance passed.
