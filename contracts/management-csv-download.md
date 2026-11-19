# Explicit management CSV file download (#642)

`createCsvDownload(ports)` returns frozen `{ save(kind, csv), dispose() }`. Ports supply the caller-owned `document`, `urls` (`URL`) and `deferCleanup(callback)` returning a cancellation function. There is no ambient document, session, fetch, storage or timer access.

- Call `save('usage' | 'audit', result.csv)` only after an explicit export action and a fresh `ready` result from the authorized review client. Never reuse a prior result after identity/session invalidation. This adapter cannot validate authorization or erase caller-owned copies.
- Preserve the server CSV string exactly as UTF-8, with no BOM, row synthesis, formula handling changes or page joining. Reject non-string values/invalid kind and UTF-8 size above 2MiB before allocating a URL. Filenames are fixed `opengranter-usage-page.csv` and `opengranter-audit-page.csv`; each is one page, not a complete export.
- A connected hidden anchor uses an object URL and `download` filename; click once and remove immediately. Result `started` means dispatch only, not browser permission, completed download or file-system success. `invalid`, `unavailable`, `disposed` are fixed safe results; never auto-retry because a browser action may already have happened.
- Caller schedules URL cleanup after the click has been processed, e.g. `deferCleanup: cb => { const timer = setTimeout(cb, 1000); return () => clearTimeout(timer); }`. This timeout is resource cleanup, NOT evidence of completion or a session timer. Pending object URLs remain until cleanup/dispose; cancellation and revocation are best-effort on browser-port failure.
- Dispose together with the complete identity epoch on logout, known expiry, identity change or fresh denial. Disposal terminally blocks retained save methods, cancels scheduled cleanup and revokes all pending URLs. Already downloaded files, browser history and external CSV copies cannot be erased. Do not route failed exports to `save`.
- Native browser download policy, actual download completion and installed deployment acceptance require separate evidence. DOM-port tests, canonical bundle execution, Node Blob fetches and loopback HTTP/SQL integration are not native-browser acceptance.

No permission, authentication acquisition, session/CSRF/IdP policy, API endpoint, runtime activation, new audit write, provider call or persistence mutation is introduced.

A TypeScript browser caller with overloaded native document methods can use an explicit HTMLAnchorElement type argument with createCsvDownload and pass document, URL and deferred cleanup. This native DOM shape was compile-checked without widening the repository server-only lib; it is not browser runtime evidence.
