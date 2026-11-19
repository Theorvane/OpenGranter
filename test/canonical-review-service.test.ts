import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { test } from 'node:test';
import { runCanonicalReviewService } from '../src/gateway/canonical-review-service.ts';

const tick = () => new Promise<void>((resolve) => setImmediate(resolve));
const ports = {
  openConnection: () => {
    throw new Error('unused');
  },
  issuer: 'https://issuer.example',
  audience: 'management',
  jwks: { keys: [] },
  browserArtifactSha256: 'a'.repeat(64),
  browserArtifactPath: '/trusted/app.js',
};
function harness(module: unknown = { createCanonicalReviewPorts: () => ports }) {
  const signals = new EventEmitter();
  const messages: string[] = [];
  const exits: number[] = [];
  const starts: unknown[] = [];
  let closes = 0;
  return {
    signals,
    messages,
    exits,
    starts,
    closes: () => closes,
    options: {
      env: { OPENGRANTER_BOOTSTRAP_MODULE: '/trusted/sso.ts', OPENGRANTER_PORT: '18081' },
      signals,
      report: (message: string) => messages.push(message),
      exit: (code: number) => exits.push(code),
      loadModule: async () => module,
      start: async (input: unknown) => {
        starts.push(input);
        return {
          close: async () => {
            closes++;
          },
        };
      },
    },
  };
}
test('dedicated canonical review service connects trusted browser ports and owns lifecycle fields', async () => {
  const h = harness({
    createCanonicalReviewPorts: () => ({
      ...ports,
      browserArtifactSha256: 'a'.repeat(64),
      host: 'ignored',
      port: 1,
      now: null,
      newRequestId: null,
    }),
  });
  const done = runCanonicalReviewService(h.options);
  await tick();
  assert.equal(h.starts.length, 1);
  const input = h.starts[0] as Record<string, unknown>;
  assert.equal(input.browserArtifactSha256, 'a'.repeat(64));
  assert.equal(input.host, '127.0.0.1');
  assert.equal(input.port, 18081);
  assert.equal(input.browserArtifactPath, '/trusted/app.js');
  assert.equal(typeof input.now, 'function');
  assert.equal(typeof input.newRequestId, 'function');
  assert.deepEqual(h.messages, ['Gateway listening']);
  h.signals.emit('SIGTERM');
  h.signals.emit('SIGINT');
  await done;
  assert.equal(h.closes(), 1);
  assert.deepEqual(h.exits, [0]);
  assert.equal(h.signals.listenerCount('SIGTERM'), 0);
});
test('canonical review service rejects proxy factories and incomplete browser ports without starting', async () => {
  for (const module of [
    ...[undefined, null, true, 0, '', 'A'.repeat(64), 'a'.repeat(63)].map((pin) => ({
      createCanonicalReviewPorts: () => ({ ...ports, browserArtifactSha256: pin }),
    })),
    { createGatewayPorts: () => ports },
    { createSsoBrowserPorts: () => ports },
    {},
    { createCanonicalReviewPorts: () => null },
    ...['openConnection', 'issuer', 'audience', 'jwks', 'browserArtifactPath'].map((field) => ({
      createCanonicalReviewPorts: () => ({ ...ports, [field]: undefined }),
    })),
    { createCanonicalReviewPorts: () => ({ ...ports, browserArtifactPath: './app.js' }) },
  ]) {
    const h = harness(module);
    const done = runCanonicalReviewService(h.options);
    await tick();
    h.signals.emit('SIGTERM');
    await done;
    assert.equal(h.starts.length, 0);
    assert.deepEqual(h.exits, [1]);
    assert.deepEqual(h.messages, ['Gateway startup unavailable']);
  }
});
test('canonical review service validates config before import and sanitizes loader failures', async () => {
  const h = harness();
  let loaded = false;
  await runCanonicalReviewService({
    ...h.options,
    env: {},
    loadModule: async () => {
      loaded = true;
      throw new Error('secret/path');
    },
  });
  assert.equal(loaded, false);
  assert.deepEqual(h.messages, ['Gateway configuration invalid']);
  const failed = harness();
  await runCanonicalReviewService({
    ...failed.options,
    loadModule: async () => {
      throw new Error('secret/path');
    },
  });
  assert.deepEqual(failed.messages, ['Gateway startup unavailable']);
});

test('signal during SSO startup closes a late runtime without readiness', async () => {
  const h = harness();
  let finishStart: (runtime: { close: () => Promise<void> }) => void = () => {};
  const starting = new Promise<{ close: () => Promise<void> }>((resolve) => {
    finishStart = resolve;
  });
  let closes = 0;
  const done = runCanonicalReviewService({ ...h.options, start: () => starting });
  await tick();
  h.signals.emit('SIGINT');
  finishStart({
    close: async () => {
      closes++;
    },
  });
  await done;
  assert.equal(closes, 1);
  assert.deepEqual(h.messages, []);
  assert.deepEqual(h.exits, [0]);
});
test('SSO runtime errors and failed shutdown expose fixed diagnostics only', async () => {
  const failed = harness();
  await runCanonicalReviewService({
    ...failed.options,
    start: async () => {
      throw new Error('private SQL /path');
    },
  });
  assert.deepEqual(failed.messages, ['Gateway startup unavailable']);
  assert.deepEqual(failed.exits, [1]);
  const h = harness();
  const done = runCanonicalReviewService({
    ...h.options,
    start: async () => ({
      close: async () => {
        throw new Error('private DB');
      },
    }),
  });
  await tick();
  h.signals.emit('SIGTERM');
  await done;
  assert.deepEqual(h.messages, ['Gateway listening', 'Gateway shutdown unavailable']);
  assert.deepEqual(h.exits, [1]);
});
