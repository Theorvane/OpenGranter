import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { test } from 'node:test';
import { runManagementService } from '../src/gateway/management-service.ts';

const env = { OPENGRANTER_MANAGEMENT_BOOTSTRAP_MODULE: '/trusted/management.ts' };
const ports = {
  openConnection() {},
  issuer: 'https://issuer.example',
  audience: 'management',
  jwks: { keys: [] },
};
const tick = () => new Promise<void>((resolve) => setImmediate(resolve));
function harness(overrides = {}) {
  const signals = new EventEmitter();
  const messages: string[] = [];
  const exits: number[] = [];
  let imports = 0;
  let starts = 0;
  let closes = 0;
  const options = {
    env,
    signals,
    report: (message: string) => messages.push(message),
    exit: (code: number) => {
      exits.push(code);
    },
    loadModule: async () => {
      imports++;
      return { createManagementPorts: () => ports };
    },
    start: async (input: unknown) => {
      starts++;
      const actual = input as {
        host: string;
        port: number;
        now: () => number;
        newRequestId: () => string;
      };
      assert.equal(actual.host, '127.0.0.1');
      assert.equal(actual.port, 8081);
      assert.equal(typeof actual.now(), 'number');
      assert.match(actual.newRequestId(), /^[0-9a-f-]{36}$/u);
      return {
        close: async () => {
          closes++;
        },
      };
    },
    ...overrides,
  };
  return {
    options,
    signals,
    messages,
    exits,
    get imports() {
      return imports;
    },
    get starts() {
      return starts;
    },
    get closes() {
      return closes;
    },
  };
}

test('management service starts independently and shuts down once', async () => {
  const h = harness();
  const done = runManagementService(h.options);
  await tick();
  assert.deepEqual(h.messages, ['Gateway listening']);
  h.signals.emit('SIGTERM');
  h.signals.emit('SIGINT');
  await done;
  assert.equal(h.starts, 1);
  assert.equal(h.closes, 1);
  assert.deepEqual(h.exits, [0]);
  assert.equal(h.signals.listenerCount('SIGTERM'), 0);
});

test('management config is required and validated before import', async () => {
  for (const bad of [
    {},
    { OPENGRANTER_BOOTSTRAP_MODULE: '/inference.ts' },
    { ...env, OPENGRANTER_MANAGEMENT_PORT: '0' },
    { ...env, OPENGRANTER_MANAGEMENT_BOOTSTRAP_MODULE: './relative.ts' },
  ]) {
    const h = harness({ env: bad });
    await runManagementService(h.options);
    assert.equal(h.imports, 0);
    assert.deepEqual(h.exits, [1]);
    assert.deepEqual(h.messages, ['Gateway configuration invalid']);
  }
});

test('management rejects inference factory and malformed management ports privately', async () => {
  for (const module of [
    { createGatewayPorts: () => ports },
    { createManagementPorts: () => ({ openConnection() {} }) },
    { createManagementPorts: () => null },
    {
      createManagementPorts: () => {
        throw new Error('PRIVATE');
      },
    },
  ]) {
    const h = harness({ loadModule: async () => module });
    await runManagementService(h.options);
    assert.equal(h.starts, 0);
    assert.deepEqual(h.exits, [1]);
    assert.deepEqual(h.messages, ['Gateway startup unavailable']);
  }
});

test('management environment and process fields cannot inherit inference settings or factory overrides', async () => {
  const h = harness({
    env: {
      ...env,
      OPENGRANTER_PORT: '9999',
      OPENGRANTER_HOST: 'bad host',
      OPENGRANTER_MANAGEMENT_PORT: '8099',
    },
    loadModule: async () => ({
      createManagementPorts: () => ({
        ...ports,
        host: 'factory-host',
        port: 1,
        now: 'bad',
        newRequestId: 'bad',
        browserJavascript: 'public bundle',
      }),
    }),
    start: async (input: unknown) => {
      const actual = input as {
        host: string;
        port: number;
        now: () => number;
        newRequestId: () => string;
        browserJavascript: string;
      };
      assert.equal(actual.host, '127.0.0.1');
      assert.equal(actual.port, 8099);
      assert.equal(typeof actual.now(), 'number');
      assert.equal(typeof actual.newRequestId(), 'string');
      assert.equal(actual.browserJavascript, 'public bundle');
      return { close: async () => {} };
    },
  });
  const done = runManagementService(h.options);
  await tick();
  h.signals.emit('SIGINT');
  await done;
  assert.deepEqual(h.messages, ['Gateway listening']);
  assert.deepEqual(h.exits, [0]);
});

test('management shutdown deadline bounds a stalled bootstrap with fixed diagnostics', async () => {
  const h = harness({
    env: { ...env, OPENGRANTER_MANAGEMENT_SHUTDOWN_MS: '20' },
    loadModule: () => new Promise(() => {}),
  });
  const done = runManagementService(h.options);
  await tick();
  h.signals.emit('SIGTERM');
  h.signals.emit('SIGINT');
  await done;
  assert.equal(h.starts, 0);
  assert.deepEqual(h.messages, ['Gateway shutdown deadline exceeded']);
  assert.deepEqual(h.exits, [1]);
});
