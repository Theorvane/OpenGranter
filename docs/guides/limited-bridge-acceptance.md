# Limited bridge deployment acceptance

This is an evidence checklist for one administrator-approved Docker bridge deployment, one external client and one real provider/model. It does not expand the product scope. See the [container guide](container.md), [service guide](service.md) and [restart plan](../plans/633-bridge-restart-acceptance.md).

## Evidence and support boundaries

| Path or property | Available evidence | Still required for limited release |
| --- | --- | --- |
| Linux Docker bridge with host-loopback publication | Existing Container CI startup, unauthenticated401 and SIGTERM checks | Install on the approved host; record image/base digests, database endpoint reference and bootstrap revision without secret values |
| Gateway restart and persisted catalog/migrations | #633 adds a disposable CI check; exact-head CI must pass | Restart the installed gateway, repeat authenticated discovery and compare provisioned configuration and migration history |
| Database persistence/recovery | External PostgreSQL is required; gateway root is read-only | Record the deployment database storage/volume, verify application records survive the approved restart procedure; CI gateway restart is not database-volume or restore evidence |
| HTTP availability | Unauthenticated models401 is a listener/authentication probe | Authorized discovery plus a bounded provider request; no general health/readiness endpoint is certified |
| Real external client/provider | Repository conformance tests are not a live deployment certificate | Record exact client/version, provider/model and successful discovery/chat/stream/tool-call round trips |
| IAM, limits, secrets, audit and usage | Existing automated tests; bootstrap supplies limits and secret resolution | Run the deployment-specific controls below and preserve redacted evidence |
| Other providers, full OpenRouter compatibility, systemd certification, Jev #7 | Outside this limited acceptance | Remain explicitly unsupported or unverified by this release; do not infer support from this checklist |

## Prerequisites and protected inputs

Before creating resources or making requests, obtain an approved Docker host/database, client/provider/model selection, maximum paid-call budget and operator authorization. Supply credentials through protected input/secret storage, never chat, Git, command arguments, audit exports or logs. Preserve separate proxy-token and provider-credential references. Follow the container guide to build and launch the image on a bridge with host-loopback publication; external client ingress must use approved TLS/firewall configuration, not an unrestricted published port.

The administrator must provision the organization, principal, token, route, provider registration, IAM policies, real limits port and secret resolver. There is no turnkey provisioning bootstrap. Never promote the CI deny-all bootstrap or an always-allow limit function into production. Stop if any prerequisite is missing rather than replacing the control.

## Ordered operator checks

1. Record exact merged source revision, image/base digests and protected configuration references. Install using the container guide. Check non-root/read-only/capability and mount settings without dumping secret-bearing environment variables or the whole bootstrap.
2. Check unauthenticated discovery returns401; record only status and request ID. Authenticate with the approved client and confirm only the intended model alias is discoverable. A listening log or401 alone is not readiness.
3. Make one small ordinary chat request and one streaming request. Verify final completion and usage, not just the first frame. Exercise a harmless local tool round trip: receive a tool call, validate its name/arguments, return a deterministic result with the matching call ID, and receive the final response. Do not execute arbitrary model-supplied commands.
4. With administrator-provisioned test principals/policies, verify missing/invalid token and explicit IAM denial cannot invoke the provider. Configure an actual rejecting limit condition and verify denial before provider use. Preserve request IDs, decisions and provider-call counts without raw tokens, prompts or responses.
5. Inspect redacted audit/usage records: correct principal, route and request correlation; denial events; completed or interrupted stream outcome; missing usage is not zero and estimated cost is not billed cost. Verify operational errors/logs and exported audit records contain no test credential or content leakage. Keep protected content auditing disabled unless separately approved.
6. Record current application configuration, migration history and the request IDs used above. Stop with `docker stop --time 40 opengranter`, confirm exit0, then `docker start opengranter`. Poll HTTP again, repeat authenticated discovery and verify configuration/history and earlier audit/usage records remain. Do not rely on retained listening logs. If database/container storage restart is part of the approved installation procedure, verify it separately with the operator; do not delete volumes or imply backup/restore was tested.
7. Publish a redacted results table with PASS/FAIL/BLOCKED per gate, timestamp, exact revision, evidence location and owner. Any failed or blocked gate keeps overall acceptance open. Do not automatically replay interrupted potentially billed requests.

## Rollback and handoff

Keep the prior approved image and configuration references. Reverting an image does not undo committed migrations; use the database owner's tested recovery procedure. Stop paid tests when the approved budget is reached. Hand over unsupported paths, unresolved findings and operator ownership without opening unrelated feature work. Only after every agreed gate has verified evidence may the overall execution task and its repeating routine be closed.
