import assert from 'node:assert/strict';
import test from 'node:test';
import { snapshotChatMessages } from '../src/gateway/chat-messages.ts';
import { probabilityFixture, probabilityPrivacy } from './nonstream-logprobs-fixture.ts';

const call = (id: string, name: string) => ({
  id,
  type: 'function',
  function: { name, arguments: '{}' },
});
const history = (name: unknown = 'read') => [
  { role: 'user', content: 'private prompt' },
  { role: 'assistant', content: null, tool_calls: [call('call_read', 'read')] },
  { role: 'tool', tool_call_id: 'call_read', content: 'fixture-tool-result', name },
];
test('tool result names validate pending call identity and are not forwarded as speaker names', () => {
  const captured = snapshotChatMessages(history());
  assert.deepEqual(captured[2], {
    role: 'tool',
    tool_call_id: 'call_read',
    content: 'fixture-tool-result',
  });
  assert.ok(Object.isFrozen(captured[2]));
  const multi = snapshotChatMessages([
    { role: 'assistant', content: null, tool_calls: [call('a', 'read'), call('b', 'write')] },
    { role: 'tool', tool_call_id: 'b', name: 'write', content: 'second' },
    { role: 'tool', tool_call_id: 'a', name: 'read', content: 'first' },
  ]);
  assert.equal(multi.length, 3);
  assert.ok(multi.every((m) => m.role !== 'tool' || !Object.hasOwn(m, 'name')));
});
test('named result capture reads own name once and cannot be changed after capture', () => {
  let reads = 0;
  const messages = history();
  const result = messages[2];
  assert.ok(result);
  Object.defineProperty(result, 'name', {
    enumerable: true,
    get: () => {
      reads++;
      return reads === 1 ? 'read' : 'private mutation';
    },
  });
  const captured = snapshotChatMessages(messages);
  assert.equal(reads, 1);
  assert.equal(Object.hasOwn(captured[2] ?? {}, 'name'), false);
});
for (const base of ['/v1', '/api/v1'])
  for (const kind of ['openai', 'openrouter', 'anthropic', 'google'] as const)
    test(`${base} ${kind}: correlated result name reaches approved transports without new authority`, async () => {
      const f = probabilityFixture(kind, undefined, { absent: true });
      const r = await f.handler(f.request(base, { messages: history() }));
      assert.equal(r.status, 200);
      await r.text();
      assert.equal(f.counts().secrets, 1);
      assert.equal(f.records[0]?.outcome, 'succeeded');
      assert.doesNotMatch(JSON.stringify(f.sent), /"role":"tool"[^}]*"name"/u);
      probabilityPrivacy(f);
    });
test('invalid correlated result names reject privately before routes or credentials on both bases', async () => {
  for (const base of ['/v1', '/api/v1'])
    for (const name of ['wrong', '', null, undefined, 42, {}, 'private mismatch']) {
      const f = probabilityFixture('openrouter', undefined, { absent: true });
      const messages = history(name);
      if (name === undefined) Reflect.deleteProperty(messages.at(-1) ?? {}, 'name');
      const r = await f.handler(f.request(base, { messages }));
      // JSON omits undefined; test that internal-only value separately below.
      assert.equal(r.status, name === undefined ? 200 : 400);
      const body = await r.text();
      assert.doesNotMatch(body, /private mismatch|fixture-(?:provider|proxy)-key/u);
      assert.equal(f.counts().secrets, name === undefined ? 1 : 0);
      assert.equal(f.counts().routes, name === undefined ? 1 : 0);
    }
  const ownUndefined = history();
  Object.defineProperty(ownUndefined[2], 'name', { value: undefined });
  assert.throws(() => snapshotChatMessages(ownUndefined), { message: 'Invalid chat messages' });
});
