# OpenGranter

Shared domain language for the product that controls access to company-provided LLM resources and records their use.

## Language

**OpenGranter**:
The product that evaluates access to approved LLM services through a unified API and records their use.
_Avoid_: OpenIAM

**Provider**:
An external company or internal platform that supplies model inference to the organization.

**Upstream**:
A service OpenGranter calls to fulfill a model request. An upstream may be OpenRouter or a direct provider.

**Proxy gateway**:
The OpenGranter API boundary that authenticates a proxy token and routes an authorized model request to an approved upstream.

**Route**:
An administrator-approved path from an OpenGranter model alias to an upstream and upstream model. A route may delegate model selection to OpenRouter or use OpenGranter's own selection.

**Route policy**:
The administrator-defined candidate restrictions, selection preference, and fallback boundary for a model alias.

**Inference provider**:
The service that actually runs a model request. On a delegated route, OpenRouter is the upstream and a separate inference provider may serve the request.

**Delegated route**:
A route that sends an authorized request to OpenRouter, which selects the eventual inference provider.

**Managed route**:
A route for which OpenGranter selects a registered direct provider and model before making the upstream call.

**Route decision service**:
An optional service that recommends one candidate from a managed route's already eligible direct destinations. OpenGranter remains responsible for the final selection boundary and the inference call.

**Jev-assisted selection**:
A managed-route selection strategy that asks TypeSafe Jev to recommend one eligible direct destination.

**Model alias**:
A model name exposed by OpenGranter that resolves to one or more approved routes.

**Human user**:
An employee who signs in through company SSO to use models or the management interface.

**Service account**:
An identity used by an internal application to call models without a human session.

**Principal**:
A human user or service account whose permissions are evaluated.

**Proxy token**:
An OpenGranter-issued credential that a principal presents when calling the LLM proxy.

**Provider credential**:
A credential issued by an LLM provider to the organization for accessing its service.
_Avoid_: Proxy token

**Upstream credential**:
A server-held credential used by OpenGranter to call an upstream, including an OpenRouter API key or a direct provider key.

**Role**:
A named collection of permissions that can be assigned to multiple principals.

**Policy**:
A collection of rules that allows or denies a principal's actions on LLM resources.

**Audit event**:
A record of an access decision or administrative change that explains what happened later.

**Content audit**:
Optional retention of LLM prompts and responses linked to audit events.

**Usage ledger**:
A per-call record of token usage and cost attribution.
