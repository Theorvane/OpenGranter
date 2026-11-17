# SSO catalog request framing

## Issue and problem
Issue #641, parent #637. The SSO catalog GET boundary does not reject body framing. The Node adapter drops GET bodies before Fetch adaptation, so validation must also inspect original framing headers.

## Scope and ordered plan
1. Reproduce list and encoded-detail requests with nonzero Content-Length and Transfer-Encoding through Fetch and real loopback Node. Assert no discovery service work or data disclosure.
2. Reject a non-null body, any Transfer-Encoding or a Content-Length other than exact zero before service invocation. Preserve normal and exact-zero GETs, existing auth/IAM/audit, route matching and errors.
3. Update contract/acceptance, run focused HTTP regressions, strict types and full check; require exact-head CI and independent formal approval.

## Boundaries
This is request validation, not a new authentication, session, runtime or authorization mechanism. Invalid syntax remains 400 before service/audit as previously contracted. No body parser, provider calls, credentials, policy changes or deployment. Frontend and backend runtime files remain owned separately.

## Validation
Record expected RED before implementation and GREEN after implementation. Node loopback framing tests are local HTTP evidence, not browser/company IdP/provider/installed acceptance.
