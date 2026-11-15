# Browser workspace adapter

The explicit trusted caller supplies the root, browser CSV ports and page lifecycle event target. The adapter connects the existing single Models/Operations workspace to actual CSV download dispatch. It issues no requests before an explicit trusted grant.

Pagehide clears the trusted grant, aborts screen reads and disposes CSV resources. Authorization while hidden is ignored. Pageshow only unlocks the ability to accept a fresh grant; it never restores authority, even with BFCache. Explicit clear forwards logout/identity replacement. Final disposal removes listeners, clears DOM and permanently fences all methods. Download started is not file completion; downloaded files and server mutations cannot be recalled.

No login, token input, storage, session issuer, BFF, policy, public entry activation or deployment changes. PR920 remains the sole outer Models navigation owner.
