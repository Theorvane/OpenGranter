# Use One Deterministic Order for Usage Pagination

Usage pagination must be validated in PostgreSQL and at the HTTP boundary, including equal timestamps. Use occurrence time and UTF-8 byte order of attempt IDs, both descending, with PostgreSQL C collation and application byte comparison. Database-local collations cannot be reproduced reliably in injected HTTP readers, and JavaScript UTF-16 comparison disagrees with UTF-8 for some Unicode identifiers; deterministic byte ordering makes cursor and lookahead validation portable.

Changing this order later invalidates pagination positions. Clients must restart pagination when deploying or reverting this ordering contract, although cursor encoding stays unchanged. A default-collation index may no longer satisfy the full sort under another locale; measure query cost before choosing a matching index.
