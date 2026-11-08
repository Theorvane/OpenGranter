# Render-owned model navigation (#637, #639, #641)

1. Reproduce retained detail/refresh/back/retry controls sending requests after navigation or grant renewal, in source and compiled code.
2. Bind every action to its exact rendered authority snapshot, checking expiry synchronously before dispatch. Prevent repeated clicks from aborting the current read. Preserve server authentication, IAM, mandatory audit and privacy.
3. Verify active controls and loopback HTTP integration. Separate local HTTP evidence from native browser, real IdP and installed acceptance.
4. Run focused tests, types/lint/scripts/offline compatibility and public entry build; submit draft PR and request independent exact-head review. No merge without all required CI and formal approval.

No session, credential, CSRF, permission, schema, runtime activation or paid call change. Login still requires an approved BFF contract. This fixes the existing core Models screen, not a new optional adapter.
