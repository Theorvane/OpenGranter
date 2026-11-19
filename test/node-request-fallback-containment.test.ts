import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { test } from 'node:test';

const factories = {
  invalidStatus: '() => Response.error()',
  invalidHeader: '() => new Response(null, { headers: { x: String.fromCharCode(1) } })',
  throwing: '() => { throw Error("private-factory"); }',
  streaming:
    '() => new Response(new ReadableStream({ pull(controller) { if (sent) { controller.error(Error("private-stream")); return; } sent = true; controller.enqueue(new TextEncoder().encode("private-partial")); } }), { status: 503, headers: { "x-private-fallback": "must-not-survive" } })',
  consumed: '() => consumed',
};

for (const [name, factory] of Object.entries(factories)) {
  for (const path of ['/management/v1/models', '/api/v1/models']) {
    test(`failed ${name} fallback is contained over actual HTTP at ${path}`, () => {
      const source = `
        import assert from "node:assert/strict";
        import { once } from "node:events";
        import { createNodeRequestServer } from ${JSON.stringify(new URL('../src/gateway/node-request-server.ts', import.meta.url).href)};
        let sent = false;
        const consumed = new Response("private-consumed");
        await consumed.text();
        const server = createNodeRequestServer(async () => { throw Error("private-handler"); }, ${factory});
        server.listen(0, "127.0.0.1");
        await once(server, "listening");
        try {
          for (let attempt = 0; attempt < 2; attempt++) {
            sent = false;
            const response = await fetch("http://127.0.0.1:" + server.address().port + ${JSON.stringify(path)}, { signal: AbortSignal.timeout(3000) });
            assert.equal(response.status, 500);
            assert.equal(response.headers.get("x-private-fallback"), null);
            assert.equal(response.headers.get("cache-control"), "no-store");
            if (${JSON.stringify(path)}.startsWith("/management/")) {
              assert.equal(response.headers.get("x-content-type-options"), "nosniff");
            }
            const body = await response.json();
            assert.equal(body.error.message, "Internal server error.");
            assert.equal(body.error.code, ${JSON.stringify(path)}.startsWith("/api/") ? 500 : "internal_error");
            assert.equal(JSON.stringify(body).includes("private"), false);
          }
        } finally {
          server.closeAllConnections();
          await new Promise(resolve => server.close(resolve));
        }
      `;
      const result = spawnSync(
        process.execPath,
        ['--experimental-strip-types', '--input-type=module', '-e', source],
        { encoding: 'utf8', timeout: 10000 },
      );
      assert.equal(result.error, undefined);
      assert.equal(result.status, 0, result.stderr);
    });
  }
}
