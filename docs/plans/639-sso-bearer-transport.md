# Explicit in-memory SSO management transport (#639, #637)

## Problem and scope
Trusted session mounts currently require hosts to hand-roll bearer forwarding. Add an opt-in CatalogRequest adapter for the already-selected API-specific SSO access token; never acquire or validate that token in the browser. The server remains responsible for RFC 9068 authentication, fresh IAM, mutation validation and mandatory audit.

## Contract and design
Only canonical management GET principal/me/models/usage/audit and POST proxy-token issue/revoke are permitted. Reject absolute/protocol-relative URLs, traversal and unknown methods/paths before touching fetch. Forward only approved headers plus the supplied bearer. Force same-origin mode, omitted ambient credentials, no-store and redirect error. No proxy endpoints, cookies, token persistence, refresh, IdP/session/BFF or entry activation. Caller supplies trusted fetch and trusted expiry, disposes on logout/identity change/known expiry. One lifetime abort signal cancels outstanding native fetch requests on disposal. Mutation cancellation is not rollback or revocation. Generic failures never include credentials or transport diagnostics.

## TDD and delivery
Run behavioral unit RED against the minimal pass-through scaffold, then implement allowlisting/header isolation/expiry/disposal and exercise success, Deny, failure and late-response cleanup. Add real loopback canonical HTTP integration using synthetic signed access tokens and PGlite; distinguish from company IdP/native PostgreSQL/deployment acceptance. Run strict TypeScript, changed lint, document checks, focused regression and full check. Review exact HEAD with all required CI before merge. This is stacked on unmerged integration work and does not complete #637 or #639.

## Carry-forward and final integration (2026-11-17 19:00 KST)

Preserve the interrupted 18:00 worktree unchanged; carry its adapter and original seven RED/GREEN cases into a separate issue branch stacked on response-cleanup PR967. Add real canonical HTTP Account DOM rendering and active-principal invalidation using this bearer adapter, without changing frontend-owned entry files. The original RED log shows seven behavior failures (including missing Authorization); current transport/HTTP tests pass eight cases before this extension. Browser proof uses only local synthetic signing and PGlite, never a production login or deployed endpoint. Full local default-concurrency suites previously suffered SIGKILL; run the complete suite with bounded concurrency separately and report this difference, not as a default full-check success.
