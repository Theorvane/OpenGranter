# Visual assets and verification provenance

## Original overview

`opengranter-overview.svg` is original artwork created for this documentation change. It summarizes the existing routing and authorization boundary; it is not a dashboard, deployment diagram, or exact persistence-timing specification. The layout uses local system fonts and does not load external images or scripts.

The documentation structure references [TypeMCP](https://github.com/Theorvane/TypeMCP) in the same organization. No TypeMCP artwork is copied.

## Actual local verification capture

- `contract-checks.txt`: unedited stdout/stderr from the focused run below, captured on 2026-10-31 with Node.js 22.23.4 on Linux ARM64.
- `contract-checks.html`: a static terminal-style presentation containing that transcript verbatim, plus a command and explanatory labels. No dashboard metrics, live-provider results, or synthetic test outcomes are added.
- `contract-checks.svg`: a 1200 × 1020 terminal-style visualization generated from the same transcript. It is not a browser or product screenshot.
- Result of this particular run: 15 tests passed, 0 failed, 0 skipped. This is focused policy/routing evidence, not a screenshot of the complete repository gate.

Reproduce the test output from the repository root:

```sh
node --experimental-strip-types --test --test-reporter=spec \
  test/policy.contract.test.ts test/route.contract.test.ts \
  > assets/contract-checks.txt 2>&1
```

Timing will vary. To refresh the visual, replace the HTML `pre` content and SVG text rows with the escaped transcript and update the date/toolchain label to match the actual run. Preserve line order and the complete results summary. Never replace failed output with invented passing output. Keep the transcript and visualization consistent.

Only the Node test files and local contract fixtures were executed for this capture. No provider credentials, real prompts, customer identities, remote inference, or production database were used. The asset contains no secrets. Assets live at the repository root because the current planning checker treats every file under `docs/` and `contracts/` as UTF-8 text; a binary PNG must not be placed there without first updating that checker.
