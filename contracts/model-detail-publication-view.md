# Published model detail view (#641)

The existing authorized Models detail renders validated publication metadata as text only. Show exact names/descriptions, modalities, parameters, context bounds and prompt/completion base USD-per-token rates. Omitted values are Not published; null bounds are Unknown; zero remains zero; empty arrays are None published. No arithmetic, capability inference, route controls or new authority. Loading, failure, denial, list return and disposal erase the detail. Existing SSO binding, fresh IAM and mandatory durable access audit remain unchanged. No session acquisition or runtime activation.

Acceptance: structural DOM missing/null/zero/text-safety and lifecycle cases; actual loopback Node HTTP with signed synthetic JWT and migrated embedded PostgreSQL verifies list/detail and fresh policy denial. Native browser evidence must be reported separately from structural DOM, login and installed acceptance. See [plan](../docs/plans/641-model-detail-publication-view.md).

## Explicit detail refresh
Refresh model reads the selected alias again through the existing SSO catalog authority. Loading removes prior publication; fresh missing, unavailable or denial states cannot retain it. This is a read-only action, not provider inference or new navigation authority.
