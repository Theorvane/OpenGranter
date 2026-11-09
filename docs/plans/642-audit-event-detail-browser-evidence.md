# Audit event inspection: native browser evidence

Executed 2026-11-10 02:00 KST against http://127.0.0.1:18841 using the actual mounted audit app bundled by the local harness. This is a synthetic signed-SSO / disposable PGlite / real HTTP integration host, not company login, deployed PostgreSQL, a browser session implementation, or provider acceptance. The test host injects its synthetic bearer server-side.

1. Initial page showed five authorized human rows with collapsed native disclosures and no other-principal row.
2. Clicking Inspect audit event 6 exposed event ID 6, UTC time, kind, principal human, request req+1, credential reference private, recorded route-policy version v7, and projected reason/modelAlias. The historical-evidence/not-current-permission disclaimer was visible. No token value was rendered.
3. Enter on the focused summary collapsed the detail; Enter again reopened it with native keyboard focus.
4. Applying request ID absent returned No audit events and removed all disclosures and prior credential/policy evidence. Clearing that filter restored five rows, all initially collapsed.
5. Applying principal other returned Access denied and removed all audit rows, disclosures, filters and CSV controls. Only the test-host clear-authority button remained.

Automated tests separately cover expiry, server failure, unmount, empty versions, text-only markup handling, strict extra-field redaction, and fresh IAM revocation through real SQL/HTTP. Those are not additional manual-browser claims. A prior full check stopped at a test-only fake DOM type mismatch; an instanceof assertion now narrows that fake without production casts. Re-run full check evidence must be terminal PASS, not inferred from targeted tests.

The temporary local URL is not a supported deployment URL. Session/CSRF/IdP contract approval, installed acceptance and original full PRD completion remain open.
