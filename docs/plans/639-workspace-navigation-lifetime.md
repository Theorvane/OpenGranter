# Workspace navigation lifetime (#639, #642)

1. Reuse the existing trusted workspace and transport; do not add a screen, endpoint, session, credential source, runtime listener or schema activation.
2. Bind each navigation control to the render that created it. Detached controls after navigation, authority renewal, clearing, pagehide/restoration or disposal must neither dispatch with current authority nor replace the current view.
3. Keep current navigation functional and retain server-side SSO/IAM/audit enforcement. This is UI lifetime isolation, not an authentication or authorization replacement.
4. Reproduce the extra request in RED, implement a render-revision guard, and run GREEN and catalog/usage/page/build regressions. Require exact-head CI and formal independent approval before merge. Browser and installed IdP acceptance are separate gates.
