# Browser fixture generation validation (R1.4)

1. Scope: refs #639 and #637, existing native-DOM component harness only. Make generation reject missing/duplicated import markers and malformed source instead of emitting an unusable fixture. No session or security-policy decisions.
2. Write focused RED tests for a pure builder: data module matching stripped current source, preserved surrounding HTML, missing/duplicate marker rejection, malformed TypeScript rejection, inert closing-script payloads.
3. Extract the builder into the existing generator. Dependencies and HTML fixture unchanged. Run focused tests, typecheck, lint and planning checks; require exact-head CI and independent formal approval before merge.
4. Generator/component evidence only, not installed/browser-session, Docker, live-provider or release acceptance. A headless chromium wrapper probe timed out without output on this host; no automated native browser success is claimed.

## Observed evidence (2026-11-02 Asia/Seoul)

Initial module-not-found RED was only scaffolding. Meaningful RED with the prior replace-only algorithm: missing and duplicate marker tests both failed (3 PASS, 2 FAIL). Marker-count validation then passed all 5 new cases; all 19 focused generator/view/mount cases pass on Node22.23.4. CLI generated the real fixture successfully. Focused strict TypeScript check passed after explicitly including Node types; the first invocation omitted those types and failed. Biome passes with 3 style advisories; planning and whitespace checks pass. Full local npm check not run. Full repository typecheck invocation did not produce a verified completion result; do not count it as PASS. No runtime management source changed.
