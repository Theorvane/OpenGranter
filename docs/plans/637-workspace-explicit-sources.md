# Workspace integration with explicit public sources

1. Reproduce the product workspace build failure with the canonical #860 explicit-grant builder and unchanged #868 profile.
2. Supply only the eight existing reviewed, content-free shared sources from the fixed workspace profile, not global builder defaults or directory grants. Preserve the frontend source and artifact bytes.
3. Prove the product builds deterministically while generic builds without grants and builds with an incomplete grant closure still fail. Check receipts and atomic publication regressions.
4. Hand the isolated commit to the canonical builder/profile owner for existing-PR integration. No duplicate PR, runtime/session activation, deployment, provider calls, or merge approval is implied.
