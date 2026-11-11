# SSO usage HTTP framing

Refs #637, #642 and #858; [plan](../docs/plans/858-usage-http-framing.md).

- At the canonical /management/v1/usage boundary, reject Transfer-Encoding whenever present and Content-Length unless absent or exactly 0. Reject before calling the trusted history service, for JSON and CSV, including absent or malformed Bearer. This is transport validation, not a new authenticated read or audit event.
- Node deliberately omits GET bodies when creating Fetch requests. Validation must therefore examine original framing headers; request.body alone is insufficient. The shared Node adapter is unchanged.
- Return the existing fixed 400 invalid_request response with no-store and nosniff, no attachment or pagination headers, and no data, body text or credential reflection. Unsupported paths remain 404; existing method handling stays unchanged.
- Ordinary bodyless and exact-zero-length GETs retain fresh authentication, current IAM, pagination, CSV and awaited mandatory durable metadata audit. Do not turn authorization/audit failures into empty successful exports.
- Real loopback fixed-length and chunked GET regressions exercise the production Node adapter and Fetch handler with a controlled service. Existing signed-test-JWT and embedded SQL composition tests cover authorization/audit. Neither proves company SSO, browser login, installed PostgreSQL, deployment or live provider acceptance.
