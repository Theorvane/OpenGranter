# Local management preview (#639)

1. Provide a reproducible explicit CLI for the reviewed SSO public entry, replacing operator-only temporary scripts. Bind IPv4 loopback only; require an explicit numeric port (0 permits OS allocation). Do not accept a host, environment configuration, credential, API backend or filesystem route.
2. Reuse the public-source browser builder and static HTTP boundary. Non-static paths return fixed 404/no-store; never start gateway, session acquisition, provider calls or database work. Signed-out shell is not login acceptance. Do not modify frontend-owned files.
3. Before implementation, run new acceptance tests and record missing-module RED. Test actual TCP GET/HEAD/module, restrictive headers, unsupported paths/methods, invalid port and bind failure. CLI tests cover exact arguments, fixed diagnostics and SIGTERM shutdown.
4. Implement the command and operator guide. Run focused regression, TypeScript/lint/planning, then full check and exact-head CI. Independent formal approval remains required before merge; parent PR694 must integrate first. Keep browser-rendered evidence distinct from Node HTTP/VM tests.
