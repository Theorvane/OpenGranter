# 639: Contain management transport fallback failures

1. Reproduce a rejected management handler followed by a throwing custom error factory, an errored response stream, or a previously consumed response. Exercise real loopback HTTP in isolated child processes to detect unhandled async request-listener rejection without crashing the test runner.
2. Resolve and consume a custom fallback before committing its status or headers. If fallback preparation fails, use the existing fixed, format-specific internal-error response; never reflect thrown errors or partially read fallback bytes. Keep valid custom fallback responses unchanged.
3. Preserve management no-store/nosniff and discovery no-store on the final response. Do not add authentication, routes, sessions, cookies, deployment or provider calls.
4. Run focused transport regressions, typecheck, lint and repository checks, then obtain exact-head CI and independent formal approval before merge. Real HTTP is not browser/IdP/installed acceptance.
