# Management boundary DOM replacement (R1.2)

## Issue and scope

Refs #639 and #637. The pure renderer does not remove stale protected DOM. Add a synchronous, unused DOM adapter that replaces the supplied management root with fixed boundary content for all five states. No ready state, navigation, session resolution, network, storage, endpoint or authentication behavior. A trusted future integration must select state and invoke this adapter; this does not revoke API access or implement session expiry detection.

## Design and safety

Share the fixed state selection/copy with the document renderer. Build detached elements using ownerDocument, textContent and fixed attributes only; never use innerHTML or coerce unknown input. Replace root children in one operation, removing old sensitive text and controls from that subtree. The caller must own the root and dispose its external resources/listeners; this helper does not erase application memory or other page roots. Use a narrow structural DOM port without adding browser globals to gateway compilation.

## TDD and acceptance

First stub the mount export and add tests asserting replacement of pre-existing protected text, five distinct accessible states, repeated transitions, no input coercion/reflection and no active elements. Observe RED, implement, observe GREEN. Structural DOM fixture tests are unit tests, not actual browser acceptance. Run focused tests, strict typecheck, lint, documentation checks and full check. Exact-head independent review and CI are merge gates. Installed browser/login/logout/expiry journeys remain pending behind the security contracts.

## Rollback

Remove the unused mount adapter and tests. No runtime routes or startup wiring change.

## Execution evidence

Node 22.23.4: RED against no-op mount: 7 failures; GREEN after implementation: 14/14 mount+renderer tests passed. An initial fixture used a non-erasable parameter property; corrected before the meaningful RED run. Focused strict TypeScript passes with explicit Node types. Documentation checker and diff checks pass. Full npm check is blocked locally: the selected Node toolchain npm is a zero-byte non-executable file, and the system npm CLI path is absent. No full local typecheck/test/compatibility success is claimed; exact-head CI is required. DOM fixture coverage is not installed browser acceptance, Docker or real-provider evidence.
