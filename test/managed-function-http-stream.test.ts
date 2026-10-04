import assert from 'node:assert/strict';
import test from 'node:test';
import { DirectProviderFailure } from '../src/routing/invoke-jev-managed-route.ts';
import { createManagedFunctionHttpStreamResponse } from '../src/streaming/delegated-http-stream.ts';
import type { UsageRecord } from '../src/usage/record-usage.ts';

function deferred() {
  let resolve!: () => void;
  const promise = new Promise<void>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}
function fixture() {
  const audits: unknown[] = [];
  const records: UsageRecord[] = [];
  let callbacks = 0;
  const interruption = deferred();
  const input: Parameters<typeof createManagedFunctionHttpStreamResponse>[0] = {
    signal: new AbortController().signal,
    format: 'opengranter',
    principalId: 'p',
    credentialId: 'c',
    policyVersions: [],
    principalActive: true,
    requestId: 'r',
    routeVersion: 'v',
    modelAlias: 'alias',
    candidates: [{ id: 'one', kind: 'managed', upstreamModelId: 'native', providerId: 'openai' }],
    statements: [{ effect: 'Allow', actions: ['llm:*'], resources: ['*'] }],
    request: {
      model: 'alias',
      messages: [{ role: 'user', content: 'private prompt' }],
    },
    ports: {
      checkLimit: async () => true,
      resolveSecret: async () => 'unused',
      writeUsage: async (record) => {
        records.push(record);
      },
      writeAudit: async (event) => {
        audits.push(event);
        if (event.kind === 'stream-interrupted') interruption.resolve();
      },
      invokeDirectFunctionStream: async (_candidate, _chat, onDelta) => {
        callbacks++;
        await onDelta({
          kind: 'delta',
          id: 's',
          created: 4,
          model: 'alias',
          content: 'private answer',
          finishReason: null,
        });
        callbacks++;
        await onDelta({ kind: 'delta', id: 's', created: 4, model: 'alias', finishReason: 'stop' });
        return {
          status: 'complete',
          id: 's',
          model: 'alias',
          finishReason: 'stop',
          usage: { prompt_tokens: 2, completion_tokens: 1, total_tokens: 3 },
        };
      },
    },
  };
  return { input, audits, records, interruption, callbacks: () => callbacks };
}
for (const format of ['opengranter', 'openrouter'] as const)
  test(`managed HTTP success and bounded demand ${format}`, async () => {
    const f = fixture();
    const response = await createManagedFunctionHttpStreamResponse({ ...f.input, format });
    assert.equal(response.status, 200);
    assert.equal(response.headers.get('x-request-id'), 'r');
    await new Promise((resolve) => setImmediate(resolve));
    assert.equal(f.callbacks(), 1);
    assert.equal(f.records.length, 0);
    const text = await response.text();
    assert.ok(text.endsWith('data: [DONE]\n\n'));
    assert.ok(text.includes('"model":"alias"'));
    assert.equal(f.records.length, 1);
    assert.equal(f.records[0]?.outcome, 'succeeded');
    assert.ok(!JSON.stringify([...f.records, ...f.audits]).includes('private'));
  });
for (const reason of ['deny', 'limit', 'provider', 'secret', 'audit'] as const)
  test(`managed HTTP maps pre-output ${reason}`, async () => {
    const f = fixture();
    const ports = { ...f.input.ports };
    if (reason === 'limit') ports.checkLimit = async () => false;
    if (reason === 'provider')
      ports.invokeDirectFunctionStream = async () => {
        throw new DirectProviderFailure('other', false, false);
      };
    if (reason === 'secret') ports.resolveSecret = async () => undefined;
    if (reason === 'audit')
      ports.writeAudit = async () => {
        throw Error('private audit');
      };
    const response = await createManagedFunctionHttpStreamResponse({
      ...f.input,
      format: 'openrouter',
      ports,
      ...(reason === 'deny' ? { statements: [] } : {}),
      ...(reason === 'secret'
        ? { jev: { credentialRef: 'secret/jev', minimumConfidence: 0.5, sendPrompt: false } }
        : {}),
    });
    assert.equal(
      response.status,
      reason === 'deny' ? 403 : reason === 'limit' ? 429 : reason === 'provider' ? 502 : 503,
    );
    assert.ok(!(await response.text()).includes('private'));
  });
for (const format of ['opengranter', 'openrouter'] as const)
  for (const reason of ['provider', 'usage', 'audit'] as const)
    test(`managed HTTP safe midstream ${format}/${reason}`, async () => {
      const f = fixture();
      const ports = { ...f.input.ports };
      if (reason === 'provider')
        ports.invokeDirectFunctionStream = async (_c, _r, onDelta) => {
          await onDelta({
            kind: 'delta',
            id: 's',
            created: 4,
            model: 'alias',
            content: 'private answer',
            finishReason: null,
          });
          throw Error('private upstream');
        };
      if (reason === 'usage')
        ports.writeUsage = async () => {
          throw Error('private ledger');
        };
      if (reason === 'audit')
        ports.writeAudit = async (event) => {
          if (event.kind === 'attempt') throw Error('private audit');
          f.audits.push(event);
        };
      const response = await createManagedFunctionHttpStreamResponse({ ...f.input, format, ports });
      const text = await response.text();
      const last = JSON.parse(text.trim().split('\n\n').at(-1)?.slice(6) ?? '{}');
      assert.ok(last.error);
      assert.ok(!JSON.stringify(last).includes('private'));
      assert.ok(!text.includes('[DONE]'));
      assert.ok(
        f.audits.some((event) => (event as { kind: string }).kind === 'stream-interrupted'),
      );
    });
test('managed HTTP cancellation records one failed billed attempt without completion', {
  timeout: 3000,
}, async () => {
  const f = fixture();
  const response = await createManagedFunctionHttpStreamResponse({
    ...f.input,
    ports: {
      ...f.input.ports,
      invokeDirectFunctionStream: async (_c, _r, onDelta, signal) => {
        await onDelta({
          kind: 'delta',
          id: 's',
          created: 4,
          model: 'alias',
          content: 'private answer',
          finishReason: null,
        });
        assert.ok(signal);
        if (signal.aborted) throw Error('private cancel');
        await new Promise<void>((_resolve, reject) =>
          signal.addEventListener('abort', () => reject(Error('private cancel')), { once: true }),
        );
        assert.fail('cancelled stream completed');
      },
    },
  });
  const reader = response.body?.getReader();
  assert.ok(reader);
  await reader.read();
  await reader.cancel();
  await f.interruption.promise;
  assert.equal(f.records.length, 1);
  assert.equal(f.records[0]?.outcome, 'failed');
  assert.equal(f.records[0]?.possiblyBilled, true);
});
