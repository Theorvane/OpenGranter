# Integrate existing authorized usage summaries (#637)

1. Preserve PR754 source composition and read-only API contracts. Reuse frontend commits 748890f7 and 751d1c6b only; do not import unrelated credential/session APIs from their ancestry.
2. RED: require model-group and exact known-token coverage on the mounted page reached through signed SSO, loopback HTTP and migrated embedded SQL.
3. Cherry-pick the existing renderer implementations, adapting only ready-render placement. Keep unknown counters unknown, exact aliases, page-only totals and duplicate inclusion. No new requests, permissions, cookies or runtime/schema activation.
4. GREEN: integration, supported browser build, summary and authority lifecycle tests; typecheck, lint, planning checks and exact-head CI. Existing installed PostgreSQL/native-browser/provider gaps remain explicit.
5. Submit a separate dependent PR; independent exact-head formal approval and all dependency/CI gates remain mandatory before merge.
