# Shared usage browser contracts

The canonical management browser builder can bundle usage-client and usage-review using the same validated usage records and exact JSON cost comparison as the server. Five explicitly named pure shared usage modules are permitted only as transitive dependencies of a management entry. No arbitrary shared/server source, Node built-ins, external packages, polyfills, runtime imports or environment injection is enabled. Existing server imports re-export the same functions/classes, preserving runtime identity and all validation semantics.

This enables the existing trusted-request JSON/CSV review coordinator to become a browser artifact, not a new authority source, session adapter, navigation entry, billing reconciliation or deployment. Audit client bundling is not changed.
