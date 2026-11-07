# Public management workspace entry (#637)

1. Join existing #723 feature integration into #754 without duplicating its UI/API implementations or changing authentication. Preserve both documentation append histories.
2. Prove the actual public entry still mounts only catalog: add a failing built-entry navigation assertion before replacing the mount with the existing Models/Usage workspace. Own only the two-line entry wiring and its acceptance test; frontend retains component ownership.
3. Preserve signed-out startup, zero ambient authority/network, pagehide clearing and fresh authority after pageshow. Public navigation must never imply login or grant usage permission. No session, schema, listener activation or paid calls.
4. Execute the actual built entry and combined signed-fixture HTTP/embedded-SQL regressions, plus typecheck/lint/planning checks. Native-browser signed-out navigation is separate from IdP/login and installed acceptance.
5. Push the existing #754 with a new exact HEAD; rerun all required CI and request independent formal review. No merge until every gate passes.
