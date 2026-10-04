import assert from 'node:assert/strict';
import { test } from 'node:test';
import { snapshotChatMessages } from '../src/gateway/chat-messages.ts';

function call() {
  return { id: 'call', type: 'function', function: { name: 'lookup', arguments: 'private args' } };
}
function history(calls: unknown = [call()], result: object = { tool_call_id: 'call' }) {
  return [
    { role: 'assistant', content: null, tool_calls: calls },
    { role: 'tool', content: 'private result', ...result },
  ];
}
test('function call scalars and reference are captured once before exact frozen projection', () => {
  const reads = { id: 0, type: 0, operation: 0, name: 0, args: 0 };
  const operation = Object.defineProperties(
    {},
    {
      name: {
        enumerable: true,
        get: () => {
          reads.name++;
          return reads.name === 1 ? 'lookup' : 42;
        },
      },
      arguments: {
        enumerable: true,
        get: () => {
          reads.args++;
          return reads.args === 1 ? 'private args' : 42;
        },
      },
    },
  );
  const entry = Object.defineProperties(
    {},
    {
      id: {
        enumerable: true,
        get: () => {
          reads.id++;
          return reads.id === 1 ? 'call' : 42;
        },
      },
      type: {
        enumerable: true,
        get: () => {
          reads.type++;
          return reads.type === 1 ? 'function' : 'custom';
        },
      },
      function: {
        enumerable: true,
        get: () => {
          reads.operation++;
          return reads.operation === 1 ? operation : {};
        },
      },
    },
  );
  const captured = snapshotChatMessages(history([entry]));
  assert.deepEqual(captured, history());
  assert.deepEqual(reads, { id: 1, type: 1, operation: 1, name: 1, args: 1 });
  assert.ok(Object.isFrozen(captured));
  assert.ok(Object.isFrozen(captured[0]?.tool_calls?.[0]?.function));
});
test('result ID used for pending matching is the exact single captured output ID', () => {
  let reads = 0;
  const result = Object.defineProperty(
    { role: 'tool', content: 'private result' },
    'tool_call_id',
    {
      enumerable: true,
      get: () => {
        reads++;
        return reads <= 2 ? 'call' : 'different';
      },
    },
  );
  const captured = snapshotChatMessages([{ role: 'assistant', tool_calls: [call()] }, result]);
  assert.equal(captured[1]?.tool_call_id, 'call');
  assert.equal(reads, 1);
});
test('role and supplied call array are captured once before interpreting a history group', () => {
  let roles = 0;
  let arrays = 0;
  const assistant = Object.defineProperties(
    { content: null },
    {
      role: {
        enumerable: true,
        get: () => {
          roles++;
          return roles === 1 ? 'assistant' : 'user';
        },
      },
      tool_calls: {
        enumerable: true,
        get: () => {
          arrays++;
          return arrays === 1 ? [call()] : [];
        },
      },
    },
  );
  const captured = snapshotChatMessages([
    assistant,
    { role: 'tool', tool_call_id: 'call', content: 'private result' },
  ]);
  assert.deepEqual(captured, history());
  assert.equal(roles, 1);
  assert.equal(arrays, 1);
});
test('fixed history and call positions survive replacement or append during scalar validation', () => {
  const source: unknown[] = [];
  const calls: unknown[] = [];
  const first = Object.defineProperty(
    { type: 'function', function: { name: 'lookup', arguments: '{}' } },
    'id',
    {
      enumerable: true,
      get: () => {
        calls[1] = null;
        calls.push(call());
        source[1] = { role: 'tool', tool_call_id: 'orphan', content: 'private' };
        source.push({ role: 'tool', tool_call_id: 'orphan', content: 'private' });
        return 'one';
      },
    },
  );
  calls.push(first, { id: 'two', type: 'function', function: { name: 'lookup', arguments: '{}' } });
  source.push(
    { role: 'assistant', tool_calls: calls },
    { role: 'tool', tool_call_id: 'one', content: 'first' },
    { role: 'tool', tool_call_id: 'two', content: 'second' },
  );
  const captured = snapshotChatMessages(source);
  assert.equal(captured.length, 3);
  assert.deepEqual(
    captured[0]?.tool_calls?.map((c) => c.id),
    ['one', 'two'],
  );
});
test('invalid first roles and duplicate first IDs reject without retrying getters', () => {
  let reads = 0;
  const invalid = Object.defineProperty({ content: 'private' }, 'role', {
    enumerable: true,
    get: () => {
      reads++;
      return reads === 1 ? 'unsupported' : 'user';
    },
  });
  assert.throws(() => snapshotChatMessages([invalid]), TypeError);
  assert.equal(reads, 1);
  let ids = 0;
  const duplicate = Object.defineProperty(
    { type: 'function', function: { name: 'lookup', arguments: '{}' } },
    'id',
    {
      enumerable: true,
      get: () => {
        ids++;
        return ids === 1 ? 'call' : 'later';
      },
    },
  );
  assert.throws(() => snapshotChatMessages(history([call(), duplicate])), TypeError);
  assert.equal(ids, 1);
});
test('capture retains inherited required fields and own undefined sparse bounds and tool integrity rejection', () => {
  const inheritedCall = Object.create({
    id: 'call',
    type: 'function',
    function: Object.create({ name: 'lookup', arguments: 'private args' }),
  });
  const inheritedMessage = Object.assign(Object.create({ role: 'assistant', content: null }), {
    tool_calls: [inheritedCall],
  });
  assert.deepEqual(
    snapshotChatMessages([
      inheritedMessage,
      { role: 'tool', content: 'private result', tool_call_id: 'call' },
    ]),
    history(),
  );
  for (const messages of [
    new Array(1),
    history(new Array(1)),
    history(Array.from({ length: 129 }, (_, i) => ({ ...call(), id: String(i) }))),
    history([call(), call()]),
    history([call()], { tool_call_id: 'orphan' }),
    history().slice(0, 1),
    ...['reasoning', 'reasoning_details', 'refusal', 'tool_calls'].map((key) => [
      { role: 'assistant', content: 'private', [key]: undefined },
    ]),
  ])
    assert.throws(() => snapshotChatMessages(messages), TypeError);
});
test('history and call array lengths are captured once for validation and indexed snapshots', () => {
  let historyReads = 0;
  let callReads = 0;
  const calls = new Proxy([call()], {
    get: (target, key, receiver) => {
      if (key === 'length') {
        callReads++;
        return callReads === 1 ? 1 : 129;
      }
      return Reflect.get(target, key, receiver);
    },
  });
  const source = new Proxy(history(calls), {
    get: (target, key, receiver) => {
      if (key === 'length') {
        historyReads++;
        return historyReads === 1 ? 2 : 0;
      }
      return Reflect.get(target, key, receiver);
    },
  });
  assert.deepEqual(snapshotChatMessages(source), history());
  assert.equal(historyReads, 1);
  assert.equal(callReads, 1);
});
