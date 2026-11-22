# Canonical authorized model discovery (#992)

Integrate existing PR952 textual publication discovery and PR964 publication filters in the canonical catalog from PR991. Display exact optional model names and descriptions as text; explicitly label an empty description. Search ID, publisher, name and description case-insensitively as literal substrings. Preserve current canonical detail metadata projection; no alternative detail renderer is imported.

Published input modality, output modality and supported parameter selectors derive sorted unique exact labels from the current authorized list only. No metadata is not a match for an active selection. Empty selection includes unknown/empty publication. Selectors intersect search and each other; no-match is distinct from an empty API response. Names, case, Unicode, whitespace and future labels remain exact; never infer provider capabilities or effective permissions.

No transport is triggered by local search/filter changes. Detail and refresh retain fresh existing IAM and required audit. Navigation/loading/denial/expiry/disposal clears retired controls and makes their detached actions inert. No credentials, login/session acquisition, entry activation, runtime, DDL, API, CSV or IAM change. Source PRs are not declared wholly superseded.

Acceptance: source-derived public DOM regressions, exact/safe publication choices, mounted SSO loading/detail/terminal denial and actual loopback HTTP fresh policy Deny/empty publication/audit. Existing canonical signed synthetic SSO and migrated embedded PostgreSQL tests remain separate evidence. Structural DOM tests are not native browser acceptance; no installed IdP/PostgreSQL, live provider or deployment acceptance is claimed.

Within a single list render, every search or filter update retires the previous row actions, even for models that remain visible. Only the current replacement row may invoke detail. Old rows must not become active again after clearing a filter. Full-render identity/denial/disposal invalidation still applies.
