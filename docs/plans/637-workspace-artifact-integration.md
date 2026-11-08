# 637: Public workspace artifact integration

1. Merge reviewed main artifact publication into the existing consolidated UI branch; retain both shared usage-parser containment tests and atomic publication tests. Do not edit UI, authentication, session, runtime or schema.
2. Extend the owned-bootstrap acceptance to both the original catalog entry and the consolidated public Models/Usage/Credentials/Account entry. Build each with the actual CLI --output, read the published file and serve those identical bytes over a real loopback HTTP socket.
3. Preserve anonymous credential-write denial, unavailable inference routes, private responses, one database acquisition and idempotent shutdown. Public assets confer no authentication authority.
4. RED/GREEN must distinguish the pre-main consolidated branch rejecting --output from the merged implementation. Run both build restrictions and owned-bootstrap tests, plus workspace HTTP integration, typecheck, lint and planning checks.
5. Open a focused integration PR against the existing UI branch, request exact-head independent formal approval and all required CI before merging. Do not independently duplicate or merge the UI stack.
6. PGlite, signed test fixtures and loopback HTTP are local acceptance only, not native-browser login, company IdP, installed PostgreSQL, provider or deployment acceptance. Existing session and audit-schema decisions remain pending.
