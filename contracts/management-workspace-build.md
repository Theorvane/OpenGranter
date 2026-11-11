# Management workspace artifact profile

The product workspace is `src/management/sso-catalog-entry.ts`, not the legacy `catalog-entry.ts`. From the repository root:

```sh
npm run --silent management:workspace:build -- --output /absolute/new-release/workspace.js
```

The parent directory must already exist. This fixed profile explicitly passes its eight existing content-free shared source grants to the canonical #860 builder. Generic builds retain management-only containment; each transitive shared source needs a separate grant. No directory or ambient shared-source grants are added. It builds the frontend-owned Models, Usage history, Credentials, Account and Audit workspace. It adds no grants, session source, API mount or automatic request. The current public entry remains signed out until a separately approved host supplies authority; building does not implement company login.

A complete in-memory module is staged beside the destination and published by exclusive hard link. Existing files, directories and symlinks are never replaced. Temporary staging is removed on failure. The JSON receipt contains `profile`, `entry`, `bytes`, `sha256` and the absolute `artifactPath`; no source or credential data is emitted. Use `--silent` to keep npm banners out of the receipt. CLI errors are fixed and do not disclose filesystem errors or paths.

`sha256` hashes the exact UTF-8 file bytes. Supply that digest to the separately reviewed artifact-integrity gate when deploying an approved release. This receipt is not a signature, source-provenance proof, approval or installed certification. Rebuild after approved source changes; use a fresh versioned output path rather than replacing an existing artifact. Deployment, lifecycle/recovery and browser authentication remain independent gates.

Parent dependency: frontend #834 exact `2591928b0ca296e10450245a0046e819289915bb`. The isolated #868/#860 reconciliation uses the canonical explicit-grant builder and a fixed profile-owned publication closure. It does not reconcile #864/#865 runtime. The canonical builder and profile owners must integrate this patch through their existing PRs; no duplicate PR or parent approval is implied. All parent merge gates and fresh main-based exact-head CI/review still apply.

Local browser observation: generated artifact at `http://127.0.0.1:18955/management` renders signed-out navigation and Usage history. Audit currently renders Account instead of Audit, reproduced and reported to the frontend owner; the profile does not certify navigation correctness. Preview private APIs intentionally return 503. No login, private SQL/browser, installed PostgreSQL, IdP, provider or paid-call acceptance is claimed.

## Workspace integrity pin integration

The explicit workspace bootstrap now accepts optional `browserArtifactSha256` from the trusted host. Supply the fixed-profile receipt's exact lowercase 64-hex `sha256`; the operator loader also accepts optional `OPENGRANTER_BROWSER_ARTIFACT_SHA256`. Both use the current-main canonical verifier, not a second implementation. Invalid configured pins and mismatches fail with sanitized diagnostics before database acquisition/listening. The bounded, fatal-UTF-8 decoded snapshot is served unchanged even if the file is subsequently replaced. Omitting the pin preserves legacy trusted-file behavior and is not release verification. Digest verification supplies neither provenance nor deployment approval. No session acquisition, IAM grant, API route, migration, default activation or provider call changes.

This is a narrow workspace integration atop #868, not a completed merge of its divergent API/store stack with current main. See [plan](../docs/plans/637-workspace-artifact-pin.md).
