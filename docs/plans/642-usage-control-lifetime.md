# Usage control render lifetime (#642)

1. Bind every usage action to the render that created its control. Detached filter, paging, retry, CSV and cancellation controls must never act with a renewed authority or interrupt a newer request. Server IAM remains authoritative.
2. Reproduce stale controls across renewal over loopback HTTP before changing production code. Exercise stale cancel during an active replacement request and preserve fresh-control behavior.
3. Implement one render-generation guard in the existing usage button helper, including expiry validation. Do not add sessions, public entry wiring, runtime activation, schema, permissions or caches.
4. Run focused UI/client/workspace/HTTP integration tests, typecheck, lint and planning checks; require exact-head CI and independent formal approval before merge. Structural DOM and loopback HTTP are not native browser or installed SSO evidence.
