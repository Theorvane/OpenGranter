# Authorized publication filters (#641)

The existing authorized model list offers exact Published input modality, Published output modality and Published supported parameter selectors. Their choices are the sorted, deduplicated labels in the current authorized publication only. Unknown and empty metadata create no choice. Future labels, Unicode, case and whitespace remain exact; render labels as text, never markup. Empty selection means any, including unpublished.

Selections intersect one another and existing case-insensitive ID/publisher/name/description search. An active choice excludes rows with unknown/empty or nonmatching metadata. No-match is not an empty server catalog. Changing a selector makes no transport request and never broadens the server-authorized list. Detail/refresh retain their existing fresh authorization/audit semantics; a prior visible match supplies no authority.

Controls live only for the current render: navigation, refresh, denial, expiry or disposal clears their values and invalidates detached control/button actions. No filter is persisted across identity changes. This is published information inspection, not capability verification, policy simulation, routing selection, quotas, or model execution. No session, API, retention, credential or authorization contract changes.

Tests: `test/management-catalog-publication-filters.test.ts` covers intersected filters/search, unknown/empty metadata, exact/safe future options, no-match and reset, detail action, teardown and loopback HTTP fresh Deny. Loopback uses synthetic authorization and is not installed browser/company IdP/live-provider acceptance.
