# Operator history switch (#642)

1. Keep scoped history disabled when OPENGRANTER_SSO_HISTORY_READS is absent. Accept only exact true/false strings; reject empty, whitespace and other values before DB ownership.
2. Propagate explicit boolean through the public-trust loader and owned browser process into the existing opt-in listener. Reject nonboolean module fields before starting.
3. Demonstrate failing then passing loader/service tests, run runtime regressions and static checks. Require exact-head CI and formal review after parent #864.

No session, cookie, IAM grant, provisioning, production activation or paid call. Local process tests are not installed/browser acceptance.
