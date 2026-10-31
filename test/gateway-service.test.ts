import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { test } from 'node:test';
import { parseGatewayServiceConfig, runGatewayService } from '../src/gateway/gateway-service.ts';

const env = { OPENGRANTER_BOOTSTRAP_MODULE: '/trusted/bootstrap.ts' };
const ports = { openConnection() {}, resolveSecret() {}, checkLimit() {} };
function harness(overrides = {}) {
  const signals = new EventEmitter();
  const messages: string[] = [];
  const exits: number[] = [];
  let closes = 0;
  let starts = 0;
  let imported = 0;
  const options = {
    env,
    signals,
    report: (message: string) => messages.push(message),
    exit: (code: number) => {
      exits.push(code);
    },
    loadModule: async () => {
      imported++;
      return { createGatewayPorts: () => ports };
    },
    start: async (input: unknown) => {
      starts++;
      assert.equal((input as { host: string }).host, '127.0.0.1');
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
    get closes() {
      return closes;
    },
    get starts() {
      return starts;
    },
    get imported() {
      return imported;
    },
  };
}
const tick = () => new Promise<void>((resolve) => setImmediate(resolve));

test('service validates configuration before loading trusted code', async () => {
  assert.deepEqual(parseGatewayServiceConfig(env), {
    modulePath: '/trusted/bootstrap.ts',
    host: '127.0.0.1',
    port: 8080,
    shutdownMs: 30000,
  });
  for (const bad of [
    {},
    { ...env, OPENGRANTER_BOOTSTRAP_MODULE: './relative.ts' },
    { ...env, OPENGRANTER_HOST: 'bad host' },
    { ...env, OPENGRANTER_PORT: '0' },
    { ...env, OPENGRANTER_PORT: '8080x' },
    { ...env, OPENGRANTER_PORT: '65536' },
    { ...env, OPENGRANTER_SHUTDOWN_MS: '0' },
    { ...env, OPENGRANTER_SHUTDOWN_MS: '2147483648' },
  ]) {
    const h = harness({ env: bad });
    await runGatewayService(h.options);
    assert.equal(h.imported, 0);
    assert.deepEqual(h.exits, [1]);
    assert.deepEqual(h.messages, ['Gateway configuration invalid']);
  }
});

test('service starts and closes exactly once on mixed signals', async () => {
  const h = harness();
  const done = runGatewayService(h.options);
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

test('missing factory or required ports never starts runtime', async () => {
  for (const module of [
    {},
    { createGatewayPorts: () => ({}) },
    { createGatewayPorts: () => ({ ...ports, checkLimit: undefined }) },
    { createGatewayPorts: () => null },
  ]) {
    const h = harness({ loadModule: async () => module });
    await runGatewayService(h.options);
    assert.equal(h.starts, 0);
    assert.deepEqual(h.messages, ['Gateway startup unavailable']);
    assert.deepEqual(h.exits, [1]);
  }
});

test('deployment code cannot override executable-owned fields', async () => {
  const h = harness({
    loadModule: async () => ({
      createGatewayPorts: () => ({
        ...ports,
        host: 'untrusted',
        port: 1,
        now: 'bad',
        newRequestId: 'bad',
      }),
    }),
    start: async (input: {
      host: string;
      port: number;
      now: () => number;
      newRequestId: () => string;
    }) => {
      assert.equal(input.host, '127.0.0.1');
      assert.equal(input.port, 8080);
      assert.equal(typeof input.now(), 'number');
      assert.equal(typeof input.newRequestId(), 'string');
      return { close: async () => {} };
    },
  });
  const done = runGatewayService(h.options);
  await tick();
  h.signals.emit('SIGINT');
  await done;
  assert.deepEqual(h.exits, [0]);
});

test('signal during import prevents factory and server startup', async () => {
  let release: (value: unknown) => void = () => {};
  const h = harness({
    loadModule: () =>
      new Promise((resolve) => {
        release = resolve;
      }),
  });
  const done = runGatewayService(h.options);
  await tick();
  h.signals.emit('SIGTERM');
  release({
    createGatewayPorts: () => {
      throw new Error('must not run');
    },
  });
  await done;
  assert.equal(h.starts, 0);
  assert.deepEqual(h.exits, [0]);
});

test('signal during runtime startup closes late runtime without readiness message', async () => {
  let release: (value: { close: () => Promise<void> }) => void = () => {};
  let closed = 0;
  const h = harness({
    start: () =>
      new Promise((resolve) => {
        release = resolve;
      }),
  });
  const done = runGatewayService(h.options);
  await tick();
  h.signals.emit('SIGTERM');
  release({
    close: async () => {
      closed++;
    },
  });
  await done;
  assert.equal(closed, 1);
  assert.deepEqual(h.messages, []);
  assert.deepEqual(h.exits, [0]);
});

test('import, factory, startup and shutdown failures have fixed diagnostics', async () => {
  const fail = () => {
    throw new Error('private-secret-path-prompt');
  };
  for (const override of [
    { loadModule: fail },
    { loadModule: async () => ({ createGatewayPorts: fail }) },
    { start: fail },
  ]) {
    const h = harness(override);
    await runGatewayService(h.options);
    assert.deepEqual(h.messages, ['Gateway startup unavailable']);
    assert.deepEqual(h.exits, [1]);
  }
  const h = harness({ start: async () => ({ close: fail }) });
  const done = runGatewayService(h.options);
  await tick();
  h.signals.emit('SIGTERM');
  await done;
  assert.deepEqual(h.messages, ['Gateway listening', 'Gateway shutdown unavailable']);
  assert.deepEqual(h.exits, [1]);
});

test('deadline bounds hung startup and hung shutdown without signal reset', async () => {
  for (const override of [
    { loadModule: () => new Promise(() => {}) },
    { start: async () => ({ close: () => new Promise(() => {}) }) },
  ]) {
    const h = harness({ ...override, env: { ...env, OPENGRANTER_SHUTDOWN_MS: '20' } });
    const done = runGatewayService(h.options);
    await tick();
    h.signals.emit('SIGTERM');
    h.signals.emit('SIGINT');
    await done;
    assert.equal(h.messages.at(-1), 'Gateway shutdown deadline exceeded');
    assert.deepEqual(h.exits, [1]);
  }
});
