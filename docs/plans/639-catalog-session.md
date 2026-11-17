# Catalog session lifecycle (#639)

## Contract

Parent #637, R1 #639. Add a UI-independent lifecycle coordinator around the authorized catalog transport. A trusted integration supplies an already-authorized request port for each session. Replacing or clearing that port invalidates pending reads and synchronously drops list/detail data. Locked states never call the API. Navigation exposes loading and suppresses obsolete completions. Empty results differ from failures. Disposal is terminal.

No authentication implementation, token bridge, credentials, identity persistence, DOM, provider calls or policy changes. Frontend owns rendering and trusted session events. Browser session authority and ingress remain separate gates.

## RED/GREEN

Run tests before implementation (missing-module RED), then lifecycle plus existing transport/socket tests, TypeScript, lint, scripts validation. Cover expiry during body parsing, identity replacement, overlapping navigation, denial and terminal disposal. Local tests are not browser or installed/live certification.

## Delivery

Exact-head full required CI and independent formal approval before merge. Revert this isolated component to roll back.
