# CSV download activation authority (#642)

1. Reproduce download-link activation after a trusted deadline with suspended timers, and after render replacement, renewal, clear and disposal. Preserve current valid downloads.
2. Guard the existing CSV anchor at activation using the creating render, URL and live trusted deadline; prevent browser default navigation when stale. Do not create a new transport or authority.
3. Run usage/workspace/HTTP tests, typecheck, lint and planning checks; require exact-head CI and formal independent approval before merge. No session, runtime, schema, public entry, provider or permission activation. Structural events are not native-browser acceptance.
