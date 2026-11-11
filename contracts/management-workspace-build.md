# Management workspace artifact profile

The product workspace is `src/management/sso-catalog-entry.ts`, not the legacy `catalog-entry.ts`. From the repository root:

```sh
npm run --silent management:workspace:build -- --output /absolute/new-release/workspace.js
```

The parent directory must already exist. This fixed profile uses the existing browser source boundary without extending grants. It builds the frontend-owned Models, Usage history, Credentials, Account and Audit workspace. It adds no grants, session source, API mount or automatic request. The current public entry remains signed out until a separately approved host supplies authority; building does not implement company login.

A complete in-memory module is staged beside the destination and published by exclusive hard link. Existing files, directories and symlinks are never replaced. Temporary staging is removed on failure. The JSON receipt contains `profile`, `entry`, `bytes`, `sha256` and the absolute `artifactPath`; no source or credential data is emitted. Use `--silent` to keep npm banners out of the receipt. CLI errors are fixed and do not disclose filesystem errors or paths.

`sha256` hashes the exact UTF-8 file bytes. Supply that digest to the separately reviewed artifact-integrity gate when deploying an approved release. This receipt is not a signature, source-provenance proof, approval or installed certification. Rebuild after approved source changes; use a fresh versioned output path rather than replacing an existing artifact. Deployment, lifecycle/recovery and browser authentication remain independent gates.

Parent dependency: frontend #834 exact `2591928b0ca296e10450245a0046e819289915bb`. The integration has not reconciled #860's alternative explicit-grant builder or #864/#865 runtime. All parent merge gates and fresh main-based exact-head CI/review still apply.

Local browser observation: generated artifact at `http://127.0.0.1:18955/management` renders signed-out navigation and Usage history. Audit currently renders Account instead of Audit, reproduced and reported to the frontend owner; the profile does not certify navigation correctness. Preview private APIs intentionally return 503. No login, private SQL/browser, installed PostgreSQL, IdP, provider or paid-call acceptance is claimed.
