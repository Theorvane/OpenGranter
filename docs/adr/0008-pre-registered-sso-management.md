# Pre-registered SSO identities and API access tokens

The contributor selected administrator-pre-registered issuer/subject bindings and API-specific SSO JWT access tokens for the first human-only management API on 2026-10-11. This trades automatic first-login onboarding and browser session state for explicit identity enrollment and an API authentication boundary; changing it later would change provisioning and client login flows. SSO identity supplies no IAM bypass. Exact token verification and HTTP profiles remain separate decisions. See [plan](../plans/486-sso-identity-bindings.md).
