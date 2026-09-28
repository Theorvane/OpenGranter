# SSO management foundation decisions

## Issue and problem

- Issue: [#105](https://github.com/Theorvane/OpenGranter/issues/105).
- The existing token-management facade trusts a previously authenticated actor and exposes no public management HTTP endpoint. SSO and maximum proxy-token lifetime were unresolved.
- Repository inspection confirms persisted human/service principal kinds, fresh actor IAM snapshots, iam:Manage authorization, decision audit, and opaque credential issue/revoke primitives. Owner lookup and maximum lifetime enforcement are not implemented during issuance.

## Scope and expected behavior

- Confirmed by the contributor: use OIDC for company SSO; allow only SSO-authenticated human users to authenticate to the first management API; limit newly issued human-owner proxy tokens to 30 days and service-owner tokens to 90 days, with expiry mandatory.
- Service accounts remain LLM proxy users. Management API authentication for automation is outside this agreed first management slice.
- Preserve existing iam:Manage checks on the target principal and mandatory decision audit; SSO authentication grants no authorization bypass. Proxy API tokens are not the agreed SSO management authentication mechanism.
- This issue records planning only. Runtime behavior is unchanged until implementation issues deliver these requirements.

## Design

- Planned integration boundaries: verified SSO identity to internal human principal, then existing fresh actor policy resolution and issue/revoke coordinator. Issuance must resolve the owner kind before enforcing its lifetime cap.
- OIDC was selected over SAML. Human-only management was selected over introducing service management credentials in the first slice. The contributor selected separate human/service caps over a common cap or no maximum.
- Pending Q4: administrator-pre-registered issuer/subject identity binding versus first-login account creation.
- Pending Q5: API-specific SSO JWT access-token verification versus browser login and server sessions.
- Subsequent authentication profile, HTTP contracts, lifecycle edge cases, and final shared understanding must be completed before coding that new boundary. Do not treat recommendations for Q4/Q5 as requirements.
- See [PRD](../PRD.md), [architecture](../architecture.md), [acceptance](../acceptance.md), and [planning contract](../../contracts/sso-management-foundation.md).

## TDD plan

- No production changes in this documentation issue; validate planning links and fixtures with python3 scripts/check.py and git diff --check.
- Later implementation issues must test verified/unverified/unmapped/inactive identities, human-only management, IAM Allow/Deny and audit failures, expiry caps at and beyond each boundary, missing owner kind, and secret/token non-disclosure through public boundaries.
- Write their issue-specific implementation plans before coding and record actual failing tests, minimal implementation, and full npm run check evidence.

## Delivery

- Record the confirmed decisions and keep unresolved choices explicit; open a ready documentation PR.
- No migration or production behavior change in this PR. SSO provider configuration, secret delivery, and runtime endpoint composition remain implementation work.
- The grill-with-docs planning round waits for remaining answers and confirmation before implementing the new authentication boundary.

## Verification evidence

- Documentation-only change; no production behavior or tests changed.
- python3 scripts/check.py passed planning documents, links, contracts, and fixture secret scanning; git diff --check passed.
- CLAUDE.md remains a symbolic link to AGENTS.md. The pending decisions are explicitly recorded rather than implemented.
