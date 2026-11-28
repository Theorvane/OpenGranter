# Use Jev as an optional managed-route decision service

The direct-only restriction and provisional integration direction are superseded by [ADR 0009](0009-owned-provider-routing.md) and the [owned-routing consumer contract](../contracts/owned-provider-routing.md) for the opt-in successor. Sanhouse Choice research support is distinct from the existing hosted TypeSafe adapter.

The direct-route choice stays inside OpenGranter's IAM and audit boundary. TypeSafe Jev may recommend one of the already eligible direct model/provider candidates, but OpenGranter validates the ID and performs the inference call with its own registered provider adapter. Using OpenRouter's hosted Jev router would place direct-provider selection back in the delegated route and would not preserve this direct-route ownership. The authorized fallback behavior is confirmed; the specific TypeSafe integration target and prompt-disclosure default remain provisional until the product owner confirms them.
