import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  snapshotBoundedJsonObject,
  snapshotFunctionTools,
  snapshotToolChoice,
} from '../src/gateway/chat-tools.ts';

function tool(definition: object = { name: 'lookup' }) {
  return { type: 'function', function: definition };
}
function plain(value: unknown) {
  return JSON.parse(JSON.stringify(value));
}
test('declaration fields and references use one validated capture before deep frozen projection', () => {
  const expected = {
    name: 'lookup',
    description: 'private description',
    strict: true,
    parameters: { enum: ['private', 'Ω'] },
  };
  const reads: Record<string, number> = {};
  const definition = Object.create(null);
  for (const [key, value] of Object.entries(expected))
    Object.defineProperty(definition, key, {
      enumerable: true,
      get: () => {
        reads[key] = (reads[key] ?? 0) + 1;
        return reads[key] === 1 ? value : 42;
      },
    });
  const entry = Object.defineProperty({ type: 'function' }, 'function', {
    enumerable: true,
    get: () => {
      reads.function = (reads.function ?? 0) + 1;
      return reads.function === 1 ? definition : {};
    },
  });
  const captured = snapshotFunctionTools([entry]);
  assert.deepEqual(plain(captured), [tool(expected)]);
  assert.deepEqual(reads, { function: 1, name: 1, description: 1, parameters: 1, strict: 1 });
  assert.ok(Object.isFrozen(captured));
  assert.ok(Object.isFrozen(captured?.[0]?.function.parameters));
  assert.ok(Object.isFrozen(captured?.[0]?.function.parameters?.enum));
});
test('optional undefined controls remain omitted without subsequent getter reads', () => {
  const reads: Record<string, number> = {};
  const definition = { name: 'lookup' };
  for (const key of ['description', 'parameters', 'strict'])
    Object.defineProperty(definition, key, {
      enumerable: true,
      get: () => {
        reads[key] = (reads[key] ?? 0) + 1;
        return reads[key] === 1 ? undefined : 'private later';
      },
    });
  assert.deepEqual(plain(snapshotFunctionTools([tool(definition)])), [tool()]);
  assert.deepEqual(reads, { description: 1, parameters: 1, strict: 1 });
});
test('named tool choice projects the same captured name and rejects invalid first names', () => {
  let reads = 0;
  const definition = Object.defineProperty({}, 'name', {
    enumerable: true,
    get: () => {
      reads++;
      return reads === 1 ? 'lookup' : 42;
    },
  });
  assert.deepEqual(snapshotToolChoice(tool(definition)), tool());
  assert.equal(reads, 1);
  let invalidReads = 0;
  const invalid = Object.defineProperty({}, 'name', {
    enumerable: true,
    get: () => {
      invalidReads++;
      return invalidReads === 1 ? '' : 'lookup';
    },
  });
  assert.throws(() => snapshotToolChoice(tool(invalid)), TypeError);
  assert.equal(invalidReads, 1);
});
test('declaration count and indexed entries are captured before nested validation', () => {
  let lengths = 0;
  const source: unknown[] = [];
  const definition = Object.defineProperty({}, 'name', {
    enumerable: true,
    get: () => {
      source[1] = null;
      source.push(tool());
      return 'first';
    },
  });
  source.push(tool(definition), tool({ name: 'second' }));
  const proxied = new Proxy(source, {
    get: (target, key, receiver) => {
      if (key === 'length') {
        lengths++;
        return lengths === 1 ? 2 : 0;
      }
      return Reflect.get(target, key, receiver);
    },
  });
  assert.deepEqual(plain(snapshotFunctionTools(proxied)), [
    tool({ name: 'first' }),
    tool({ name: 'second' }),
  ]);
  assert.equal(lengths, 1);
});
test('nested JSON array length is captured once without dropping descriptor values', () => {
  let reads = 0;
  const values = new Proxy(['private', 'Ω'], {
    get: (target, key, receiver) => {
      if (key === 'length') {
        reads++;
        return reads === 1 ? 2 : 1;
      }
      return Reflect.get(target, key, receiver);
    },
  });
  assert.deepEqual(plain(snapshotBoundedJsonObject({ enum: values })), { enum: ['private', 'Ω'] });
  assert.equal(reads, 1);
});
test('capture retains plain prototypes bounds cycles and nested accessor rejection without execution', () => {
  let reads = 0;
  const accessor = Object.defineProperty({}, 'private', {
    enumerable: true,
    get: () => {
      reads++;
      return 'private';
    },
  });
  const cycle: Record<string, unknown> = {};
  cycle.self = cycle;
  let deep: object = {};
  for (let i = 0; i < 66; i++) deep = { child: deep };
  for (const parameters of [
    accessor,
    cycle,
    deep,
    { enum: new Array(1) },
    { enum: Array(20_001).fill('x') },
  ])
    assert.throws(() => snapshotFunctionTools([tool({ name: 'lookup', parameters })]), TypeError);
  assert.equal(reads, 0);
  for (const value of [
    new Array(1),
    Array(20_001).fill(tool()),
    [tool({ name: 'x'.repeat(65) })],
    [tool({ name: 'lookup', strict: 'true' })],
    [tool({ name: 'lookup', parameters: new Date() })],
  ])
    assert.throws(() => snapshotFunctionTools(value), TypeError);
  assert.deepEqual(
    plain(
      snapshotFunctionTools([
        Object.assign(
          Object.create(null),
          tool(Object.assign(Object.create(null), { name: 'lookup' })),
        ),
      ]),
    ),
    [tool()],
  );
  for (const choice of ['none', 'auto', 'required'] as const)
    assert.equal(snapshotToolChoice(choice), choice);
});
