# Audit record details (#642)

1. Problem: the scoped audit list shows only four summary fields. Event identity, credential reference, policy versions and decision metadata already delivered by the API are hidden.
2. Add native collapsed details/summary to each audit row. Render exact references, timestamp, policy versions and projected metadata via textContent. Reuse the existing audit projector as defense in depth; omit invalid metadata.
3. No new endpoint, permission, retention, schema, login, session, model call or deployment. Existing history lifecycle removes details on paging, filtering, denial, navigation and disposal. No second fetch or cache.
4. RED: require native details, exact event/policy metadata and redaction in existing history integration. Add empty policy and invalid metadata tests; page/denial/disposal must remove details. GREEN: implement renderer and connect audit rows only.
5. Run focused history/client/workspace/operations tests, full TypeScript, changed-file lint and scripts. Separate synthetic HTTP, browser and installed evidence.
6. Draft PR based940. Dependency-first merge requires exact-head required CI and independent formal approval. Rollback removes renderer integration. Login/IdP/CSRF and deployment gates unchanged.
