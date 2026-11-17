# Exact Unicode history filters (#642)

The Usage and Audit management clients must not allow URLSearchParams to change the meaning of a caller-supplied exact filter. Before serialization, reject strings containing unpaired UTF-16 high or low surrogates as `invalid_query`; no HTTP request is made. Apply this to Usage JSON/CSV principal/model filters and Audit JSON/CSV string parameters. Existing format restrictions still apply, including Audit principal IDs remaining ASCII-only.

Well-formed Unicode model filters retain exact scalar values: a valid surrogate pair is accepted where the existing validator permits it, literal U+FFFD is not confused with malformed input, and composed/decomposed sequences remain distinct. Do not normalize, trim, substitute or retry. Valid input still crosses fresh server authentication, IAM and mandatory audit, with 401/403/unavailable outcomes preserved. This validation grants no authority and makes no server-policy change.

Public-client regressions cover malformed and preserved strings for all four clients. Signed synthetic JWT + loopback canonical HTTP/PGlite integration verifies valid non-ASCII models receive authorized JSON/CSV results, malformed models cause neither a request nor an audit event, and fresh Deny is enforced. These are not real browser/login/company IdP/native PostgreSQL/provider or installed acceptance results.
