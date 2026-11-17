# Exact Unicode history browser closure (#642)

1. Parent PR971 exact-head check CI fails canonical Usage/Audit/Operations builds because the reviewed pure Unicode validator is outside the fixed shared closure. Reproduce with canonical builder before changing it.
2. Permit only src/shared/text/well-formed-unicode.ts as a transitive dependency, never as an entry or a directory-wide allowlist. Preserve external/server/symlink rejection.
3. Execute bundled public Usage/Audit clients: malformed filters never call the port; exact Unicode Usage model remains unchanged. Retain canonical browser build and boundary regressions.
4. No runtime/session/IAM/deployment changes. Require exact-head required CI and independent formal approval before merge.

## Local evidence

- New canonical bundle RED: 1 pass / 2 fail with the expected source-boundary error.
- Canonical browser/Usage/Audit/Operations regressions GREEN: 53 pass / 0 fail / 0 skip. An initial CLI publication failure was the host npm launcher, corrected with a temporary wrapper targeting the existing complete npm CLI; no test or repository toolchain was weakened.
- Parent PR971 CI check failure is real and remains recorded; this additive fix does not retroactively make that exact head green.
