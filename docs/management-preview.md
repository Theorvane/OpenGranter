# Management UI local preview

This explicit developer command builds the reviewed public SSO UI entry and serves it on **127.0.0.1 only**. It replaces ad hoc preview scripts; it is not the installed gateway or an authenticated management service.

1. Use Node.js >=22.14 and install locked dependencies with `npm ci`.
2. From the repository run:

   ```sh
   node --experimental-strip-types scripts/preview-management.ts --port 18741
   ```

3. Open the printed `http://127.0.0.1:18741/management` URL in a browser on the same machine. `--port 0` allocates an available port and prints the actual URL. Existing listeners are not replaced.
4. Stop with Ctrl-C or SIGTERM. The command closes active connections. Source changes require restarting the preview; no watch or hot-reload is installed.

Only `/management`, `/management/` and `/management/app.js` are served. The real bundled entry renders **Sign-in required** and does not obtain credentials, install a global authorization function, use storage, authenticate a user or fetch private data. All other paths, including management APIs, return fixed 404/no-store. GET/HEAD, restrictive CSP and no-store behavior come from the reviewed static HTTP boundary. No host override, environment injection, database, provider, session or proxy-token bridge is supported. Never enter credentials into this preview or expose it through an ingress as an authenticated service.

Acceptance evidence: `test/management-preview.test.ts` exercises real localhost HTTP, the CLI, shutdown, argument validation and bind conflict; `test/management-sso-catalog-entry.test.ts` exercises the actual compiled entry in a VM DOM harness. These are not visual-browser, login, installed deployment or live-provider acceptance. Session/BFF/IdP/CSRF/CORS contracts and review gates remain prerequisites for authenticated integration.

Plan: [local preview](plans/639-management-preview.md). Parent: #637 / #639.
