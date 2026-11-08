# Mounted audit CSV download

1. Scope: #637/#642 current-page metadata CSV in the existing trusted workspace. Session approval remains blocked by #786; no session, permission, retention, runtime or deployment changes.
2. RED: exercise the mounted view with an actual Blob URL, verify exact bounded server CSV bytes/type and fixed download filename, and require cleanup on navigation, expiry, renewal, failed export and disposal.
3. GREEN: expose a download anchor only for the current authorized export, revoke its URL before every replacement render and disposal, and guard native click/auxclick/contextmenu defaults against stale controls and suspended expiry timers.
4. Keep server-reported continuation visible; never imply full-history export. If Blob creation fails retain the safe text preview without a broken anchor. Files already saved by the user cannot be recalled.
5. Run compiled-workspace and focused integration tests, typecheck/lint/scripts/compatibility, request exact-HEAD review and CI. No merge without formal approval and all required CI. Native-browser, installed API and provider acceptance remain separate.
