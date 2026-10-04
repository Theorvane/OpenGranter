import assert from 'node:assert/strict';
import test from 'node:test';
import { createChatHandler } from '../src/gateway/chat-handler.ts';
import {
  encodeOpenRouterFunctionSse,
  encodeOpenRouterTextSse,
} from '../src/streaming/openrouter-client-sse.ts';
import { OpenRouterFunctionStreamSequence } from '../src/streaming/openrouter-function-stream-sequence.ts';
import type {
  OpenRouterFunctionStreamPayload,
  OpenRouterTextStreamPayload,
} from '../src/streaming/openrouter-stream-chunks.ts';
import {
  decodeOpenRouterFunctionStreamPayload,
  decodeOpenRouterStreamPayload,
} from '../src/streaming/openrouter-stream-chunks.ts';
import { OpenRouterTextStreamSequence } from '../src/streaming/openrouter-stream-sequence.ts';
import {
  probabilityFixture,
  probabilityGroups,
  probabilityInput,
  probabilityPrivacy,
  probabilityToken,
} from './nonstream-logprobs-fixture.ts';
import {
  deferred,
  finalProbabilities,
  probabilityChunk,
  probabilityFrames,
  probabilityStreamPayloads,
  probabilityStreamResponse,
  streamProbabilityFields,
  streamProbabilityFixture,
  streamScope,
} from './stream-logprobs-fixture.ts';

const bases = ['/v1', '/api/v1'];
for (const kind of ['openai', 'openrouter'] as const) {
  for (const mode of ['text', 'refusal', 'function'] as const) {
    test(`${kind} ${mode}: streaming controls and probabilities survive both bases`, async () => {
      for (const base of bases) {
        const f = streamProbabilityFixture(kind, { mode });
        const response = await f.handler(f.request(base, streamProbabilityFields(mode)));
        assert.equal(response.status, 200);
        const frames = probabilityFrames(await response.text());
        assert.deepEqual(frames[0]?.choices[0]?.logprobs, probabilityGroups);
        assert.equal(frames[1]?.choices[0]?.logprobs, null);
        assert.deepEqual(
          frames.at(-1)?.choices[0]?.logprobs,
          kind === 'openrouter' ? finalProbabilities : undefined,
        );
        assert.equal(frames.at(-1)?.usage?.total_tokens, 3);
        assert.equal(f.sent[0]?.logprobs, true);
        assert.equal(f.sent[0]?.top_logprobs, 20);
        assert.equal(f.records.length, 1);
        assert.equal(f.records[0]?.usage.totalTokens, 3);
        assert.equal(
          f.records[0]?.actualInferenceProviderId,
          kind === 'openrouter' ? null : 'provider',
        );
        probabilityPrivacy(f);
      }
    });
    for (const missingUsage of [false, true])
      test(`${kind} ${mode}: absent aggregate usage ${missingUsage} preserves supplied probabilities`, async () => {
        const f = streamProbabilityFixture(kind, { mode, missingUsage });
        const response = await f.handler(f.request('/api/v1', streamProbabilityFields(mode)));
        assert.equal(response.status, 200);
        const frames = probabilityFrames(await response.text());
        assert.equal(frames.length, missingUsage && kind === 'openai' ? 2 : 3);
        if (kind === 'openrouter')
          assert.deepEqual(frames.at(-1)?.choices[0]?.logprobs, finalProbabilities);
        assert.equal(frames.at(-1)?.usage?.total_tokens, missingUsage ? undefined : 3);
        assert.equal(f.records[0]?.usage.status, missingUsage ? 'missing' : 'reported');
        assert.equal(f.records[0]?.usage.totalTokens, missingUsage ? null : 3);
        probabilityPrivacy(f);
      });
    for (const [gate, status] of [
      ['auth', 401],
      ['implicit', 403],
      ['model', 403],
      ['provider', 403],
      ['limit', 429],
      ['selection', 503],
      ['audit', 200],
      ['usage', 200],
    ] as const)
      test(`${kind} ${mode}: stream probabilities preserve ${gate} gate`, async () => {
        for (const base of bases) {
          const f = streamProbabilityFixture(kind, { mode, gate });
          const response = await f.handler(f.request(base, streamProbabilityFields(mode)));
          assert.equal(response.status, status);
          const text = await response.text();
          assert.doesNotMatch(
            text,
            /private-terminal-probability|private (?:ledger|audit) error|fixture-.*key|\[DONE\]/u,
          );
          assert.equal(f.counts().secrets, gate === 'audit' || gate === 'usage' ? 1 : 0);
          assert.equal(f.sent.length, f.counts().secrets);
          probabilityPrivacy(f);
        }
      });
    for (const invalid of [
      'first',
      'later',
      'location',
      ...(kind === 'openrouter' ? (['final'] as const) : (['native-usage'] as const)),
    ] as const)
      test(`${kind} ${mode}: invalid ${invalid} probability frame fails safely without retry`, async () => {
        const f = streamProbabilityFixture(kind, { mode, invalid });
        const response = await f.handler(f.request('/api/v1', streamProbabilityFields(mode)));
        assert.equal(response.status, invalid === 'later' || invalid === 'final' ? 200 : 502);
        const body = await response.text();
        assert.doesNotMatch(
          body,
          /private-terminal-probability|\[DONE\]|Invalid OpenRouter|fixture-.*key/u,
        );
        if (invalid === 'first' || invalid === 'location' || invalid === 'native-usage')
          assert.doesNotMatch(body, /private/u);
        assert.equal(f.records.length, 1);
        assert.equal(f.records[0]?.outcome, 'failed');
        assert.equal(f.records[0]?.possiblyBilled, true);
        assert.equal(f.records[0]?.usage.status, 'missing');
        assert.equal(f.sent.length, 1);
        probabilityPrivacy(f);
      });
  }
  for (const [index, fields] of [
    {},
    { logprobs: null, top_logprobs: null },
    { logprobs: false },
    { logprobs: true },
    { logprobs: true, top_logprobs: 0 },
    { logprobs: true, top_logprobs: 20 },
  ].entries())
    test(`${kind}: exact stream controls ${index} retain omission/null/false/zero`, async () => {
      const f = streamProbabilityFixture(kind);
      const response = await f.handler(f.request('/v1', { stream: true, ...fields }));
      assert.equal(response.status, 200);
      await response.text();
      assert.equal(f.sent[0]?.logprobs, fields.logprobs ?? undefined);
      assert.equal(f.sent[0]?.top_logprobs, fields.top_logprobs ?? undefined);
    });
  for (const [index, groups] of [
    undefined,
    null,
    { content: null },
    { content: [], refusal: [] },
    { content: null, refusal: [probabilityToken] },
    { content: [{ token: '', logprob: 0, bytes: [], top_logprobs: [] }] },
  ].entries())
    test(`${kind}: streamed group shape ${index} retains absence/null/empty/refusal`, async () => {
      const f = streamProbabilityFixture(kind, {
        groups,
        absent: groups === undefined,
        finalGroups: groups,
      });
      const response = await f.handler(f.request('/api/v1', streamProbabilityFields()));
      assert.equal(response.status, 200);
      const frames = probabilityFrames(await response.text());
      assert.deepEqual(frames[0]?.choices[0]?.logprobs, groups);
      if (kind === 'openrouter') assert.deepEqual(frames.at(-1)?.choices[0]?.logprobs, groups);
      probabilityPrivacy(f);
    });
  test(`${kind}: stream request controls are captured before credentials`, async () => {
    const fields = { stream: true, logprobs: true, top_logprobs: 0 };
    const f = probabilityFixture(kind, probabilityGroups, {
      reply: () => probabilityStreamResponse(probabilityStreamPayloads(kind)),
      mutate: () => {
        fields.logprobs = false;
        fields.top_logprobs = 21;
      },
    });
    await f.stream(false, fields);
    assert.equal(f.sent[0]?.logprobs, true);
    assert.equal(f.sent[0]?.top_logprobs, 0);
  });
}
for (const kind of ['anthropic', 'google'] as const)
  test(`${kind}: native stream controls fail before secrets for both stream modes`, async () => {
    for (const functions of [false, true]) {
      const f = probabilityFixture(kind);
      await assert.rejects(() => f.stream(functions, { logprobs: true, top_logprobs: 0 }));
      assert.equal(f.counts().secrets, 0);
      assert.equal(f.sent.length, 0);
    }
  });
for (const functions of [false, true]) {
  const decode = functions ? decodeOpenRouterFunctionStreamPayload : decodeOpenRouterStreamPayload;
  const encode = (event: OpenRouterFunctionStreamPayload) =>
    functions
      ? encodeOpenRouterFunctionSse(event)
      : encodeOpenRouterTextSse(event as OpenRouterTextStreamPayload);
  test(`${functions ? 'function' : 'text'} decoder/encoder capture choice probabilities immutably`, () => {
    const groups = structuredClone(probabilityGroups);
    const event = decode(
      probabilityChunk([{ index: 0, delta: {}, finish_reason: null, logprobs: groups }]),
      streamScope,
    );
    assert.equal(event.kind, 'delta');
    if (event.kind !== 'delta') assert.fail();
    assert.deepEqual(event.logprobs, groups);
    assert.ok(Object.isFrozen(event.logprobs?.content?.[0]?.bytes));
    groups.content[0]!.token = 'changed';
    assert.deepEqual(event.logprobs, probabilityGroups);
    assert.deepEqual(
      JSON.parse(encode(event)?.slice(6) ?? '{}').choices[0].logprobs,
      probabilityGroups,
    );
    assert.throws(
      () => encode({ ...event, logprobs: { content: [{ ...probabilityToken, bytes: [256] }] } }),
      /Unsupported OpenRouter/u,
    );
  });
  test(`${functions ? 'function' : 'text'} sequence snapshots only final probability sidecar then discards private content`, () => {
    const sequence = functions
      ? new OpenRouterFunctionStreamSequence()
      : new OpenRouterTextStreamSequence();
    const end = decode(
      probabilityChunk([
        { index: 0, delta: {}, finish_reason: 'stop', logprobs: probabilityGroups },
      ]),
      streamScope,
    );
    // Text events are a common subset of both public sequences.
    if (end.kind !== 'delta' || end.finishReason === 'tool_calls') assert.fail();
    const groups = structuredClone(finalProbabilities);
    sequence.accept({ ...end, finishReason: end.finishReason });
    sequence.accept({
      kind: 'usage',
      id: 'completion',
      model: 'chat',
      created: 42,
      finishReason: 'stop',
      usage: undefined,
      logprobs: groups,
    });
    groups.content[0]!.token = 'changed';
    sequence.accept({ kind: 'done' });
    const outcome = sequence.finish();
    assert.equal(outcome.status, 'complete');
    if (outcome.status !== 'complete') assert.fail();
    assert.deepEqual(outcome.usageLogprobs, finalProbabilities);
    assert.ok(Object.isFrozen(outcome.usageLogprobs?.content?.[0]));
    assert.equal(JSON.stringify(sequence).includes('private'), false);
    assert.throws(() => sequence.finish());
  });
  for (const missingUsage of [false, true])
    for (const gate of ['usage', 'audit'] as const)
      test(`${functions ? 'function' : 'text'} final probability release awaits ${gate} with missing usage ${missingUsage}`, {
        timeout: 5000,
      }, async () => {
        const f = streamProbabilityFixture('openrouter', {
          mode: functions ? 'function' : 'text',
          missingUsage,
        });
        const started = deferred(),
          release = deferred();
        const ports = {
          ...f.ports,
          writeUsage: async (record: Parameters<typeof f.ports.writeUsage>[0]) => {
            if (gate === 'usage') {
              started.resolve();
              await release.promise;
            }
            await f.ports.writeUsage(record);
          },
          writeAudit: async (event: Parameters<typeof f.ports.writeAudit>[0]) => {
            if (gate === 'audit' && event.kind === 'delegated-attempt') {
              started.resolve();
              await release.promise;
            }
            await f.ports.writeAudit(event);
          },
        };
        const response = await createChatHandler(ports)(
          f.request('/api/v1', streamProbabilityFields(functions ? 'function' : 'text')),
        );
        assert.equal(response.status, 200);
        const reader = response.body!.getReader(),
          decoder = new TextDecoder();
        let text = decoder.decode((await reader.read()).value);
        text += decoder.decode((await reader.read()).value);
        await started.promise;
        assert.doesNotMatch(text, /private-terminal-probability|\[DONE\]/u);
        release.resolve();
        while (true) {
          const value = await reader.read();
          if (value.done) break;
          text += decoder.decode(value.value);
        }
        assert.deepEqual(probabilityFrames(text).at(-1)?.choices[0]?.logprobs, finalProbabilities);
        assert.equal(f.records.length, 1);
        probabilityPrivacy(f);
      });
  test(`${functions ? 'function' : 'text'} trusted terminal probabilities snapshot before persistence and never enter records`, async () => {
    for (const kind of ['openai', 'openrouter'] as const) {
      const f = streamProbabilityFixture(kind),
        groups = structuredClone(finalProbabilities);
      const invoke = async (
        _candidate: unknown,
        _request: unknown,
        onDelta: (
          delta: Extract<ReturnType<typeof decodeOpenRouterStreamPayload>, { kind: 'delta' }>,
        ) => void | Promise<void>,
      ) => {
        const end = decodeOpenRouterStreamPayload(
          probabilityChunk([{ index: 0, delta: {}, finish_reason: 'stop' }]),
          streamScope,
        );
        if (end.kind !== 'delta') assert.fail();
        await onDelta(end);
        return {
          status: 'complete' as const,
          id: 'completion',
          model: 'chat',
          finishReason: 'stop' as const,
          usage: { prompt_tokens: 2, completion_tokens: 1, total_tokens: 3 },
          usageLogprobs: groups,
        };
      };
      const delegated = (_ref: string, ...args: Parameters<typeof invoke>) => invoke(...args);
      const ports = {
        ...f.ports,
        ...(functions
          ? { invokeDirectFunctionStream: invoke, invokeOpenRouterFunctionStream: delegated }
          : { invokeDirectTextStream: invoke, invokeOpenRouterTextStream: delegated }),
        writeUsage: async (record: Parameters<typeof f.ports.writeUsage>[0]) => {
          groups.content[0]!.token = 'changed';
          await f.ports.writeUsage(record);
        },
      };
      const response = await createChatHandler(ports)(
        f.request('/api/v1', streamProbabilityFields(functions ? 'function' : 'text')),
      );
      assert.equal(response.status, 200);
      assert.deepEqual(
        probabilityFrames(await response.text()).at(-1)?.choices[0]?.logprobs,
        finalProbabilities,
      );
      probabilityPrivacy(f);
    }
  });
}

for (const functions of [false, true]) {
  const decode = functions ? decodeOpenRouterFunctionStreamPayload : decodeOpenRouterStreamPayload;
  const encode = (event: OpenRouterFunctionStreamPayload) =>
    functions
      ? encodeOpenRouterFunctionSse(event)
      : encodeOpenRouterTextSse(event as OpenRouterTextStreamPayload);
  test(`${functions ? 'function' : 'text'} malformed stream probabilities and limits reject at decoder/encoder`, () => {
    const bad = [
      1,
      [],
      {},
      { content: [null] },
      { content: [], extra: 'private' },
      ...[
        { token: 'x'.repeat(16385) },
        { logprob: NaN },
        { logprob: Infinity },
        { bytes: [256] },
        { bytes: [-1] },
        { bytes: [1.5] },
        { bytes: new Array(1025).fill(0) },
        { bytes: new Array(1) },
        { top_logprobs: new Array(21).fill({ token: 'a', logprob: 0, bytes: null }) },
        { top_logprobs: new Array(1) },
      ].map((x) => ({ content: [{ ...probabilityToken, ...x }] })),
      { content: new Array(65537).fill({ token: '', logprob: 0, bytes: [], top_logprobs: [] }) },
    ];
    for (const groups of bad) {
      // JSON represents nonfinite values as null; trusted projection must also reject originals.
      assert.throws(() =>
        decode(
          probabilityChunk([{ index: 0, delta: {}, finish_reason: null, logprobs: groups }]),
          streamScope,
        ),
      );
      assert.throws(() =>
        encode({
          kind: 'delta',
          id: 'completion',
          model: 'chat',
          created: 42,
          finishReason: null,
          logprobs: groups,
        } as unknown as Parameters<typeof encode>[0]),
      );
    }
  });
  test(`${functions ? 'function' : 'text'} final null metadata survives missing usage without fabricated counts`, () => {
    const frame = encode({
      kind: 'usage',
      id: 'completion',
      model: 'chat',
      created: 42,
      finishReason: 'stop',
      usage: undefined,
      logprobs: null,
    });
    assert.equal(JSON.parse(frame?.slice(6) ?? '{}').choices?.[0]?.logprobs, null);
    assert.equal(JSON.parse(frame?.slice(6) ?? '{}').usage, undefined);
    assert.throws(() =>
      encode({
        kind: 'usage',
        id: 'completion',
        model: 'chat',
        created: 42,
        finishReason: null,
        usage: undefined,
        logprobs: null,
      }),
    );
  });
  for (const kind of ['openai', 'openrouter'] as const) {
    test(`${kind} ${functions ? 'function' : 'text'} probability callbacks honor backpressure and abort upstream`, {
      timeout: 5000,
    }, async () => {
      const reached = deferred(),
        blocked = deferred(),
        cancelled = deferred();
      let callbacks = 0;
      const f = probabilityFixture(kind, probabilityGroups, {
        reply: () =>
          new Response(
            new ReadableStream<Uint8Array>({
              start(controller) {
                controller.enqueue(
                  new TextEncoder().encode(
                    probabilityStreamPayloads(kind)
                      .map((p) => `data: ${p}\n\n`)
                      .join(''),
                  ),
                );
              },
              cancel() {
                cancelled.resolve();
              },
            }),
            { headers: { 'content-type': 'text/event-stream' } },
          ),
      });
      const controller = new AbortController();
      const onDelta = async (
        event: Extract<OpenRouterFunctionStreamPayload, { kind: 'delta' }>,
      ) => {
        callbacks++;
        assert.deepEqual(event.logprobs, probabilityGroups);
        reached.resolve();
        await blocked.promise;
      };
      const request = probabilityInput(streamProbabilityFields(functions ? 'function' : 'text'));
      const invocation =
        kind === 'openrouter'
          ? (functions
              ? f.ports.invokeOpenRouterFunctionStream!
              : f.ports.invokeOpenRouterTextStream!)(
              'secret/reference',
              { upstreamModelId: 'upstream-model', authorizedProviderSlugs: ['provider'] },
              request,
              onDelta,
              controller.signal,
            )
          : (functions ? f.ports.invokeDirectFunctionStream! : f.ports.invokeDirectTextStream!)(
              {
                id: 'candidate',
                kind: 'managed',
                providerId: 'provider',
                upstreamModelId: 'upstream-model',
              },
              request,
              onDelta,
              controller.signal,
            );
      const rejection = assert.rejects(invocation);
      await reached.promise;
      await new Promise((resolve) => setImmediate(resolve));
      assert.equal(callbacks, 1);
      controller.abort('private cancellation');
      await rejection;
      await cancelled.promise;
      blocked.resolve();
      assert.equal(callbacks, 1);
    });
    test(`${kind} ${functions ? 'function' : 'text'} client cancellation retains one safe failed attempt`, {
      timeout: 5000,
    }, async () => {
      const f = streamProbabilityFixture(kind, { mode: functions ? 'function' : 'text' }),
        interrupted = deferred();
      const response = await createChatHandler({
        ...f.ports,
        writeAudit: async (event) => {
          await f.ports.writeAudit(event);
          if (event.kind === 'stream-interrupted') interrupted.resolve();
        },
      })(f.request('/api/v1', streamProbabilityFields(functions ? 'function' : 'text')));
      assert.equal(response.status, 200);
      const reader = response.body!.getReader();
      assert.match(new TextDecoder().decode((await reader.read()).value), /logprobs/u);
      await reader.cancel('private cancellation');
      await interrupted.promise;
      assert.equal(f.records.length, 1);
      assert.equal(f.records[0]?.outcome, 'failed');
      assert.equal(f.records[0]?.possiblyBilled, true);
      assert.equal(f.records[0]?.usage.status, 'missing');
      probabilityPrivacy(f);
    });
  }
}

for (const functions of [false, true]) {
  test(`${functions ? 'function' : 'text'} sequence keeps live final probability sidecar private`, () => {
    const sequence = functions
      ? new OpenRouterFunctionStreamSequence()
      : new OpenRouterTextStreamSequence();
    sequence.accept({
      kind: 'delta',
      id: 'completion',
      model: 'chat',
      created: 42,
      finishReason: 'stop',
    });
    sequence.accept({
      kind: 'usage',
      id: 'completion',
      model: 'chat',
      created: 42,
      finishReason: 'stop',
      usage: undefined,
      logprobs: finalProbabilities,
    });
    assert.doesNotMatch(
      JSON.stringify(sequence),
      /private-terminal-probability|logprobs|usageLogprobs/u,
    );
    sequence.discard();
    assert.throws(() => sequence.finish());
    assert.doesNotMatch(JSON.stringify(sequence), /private-terminal-probability/u);
  });
  test(`${functions ? 'function' : 'text'} sequence clears terminal sidecar on error or invalid continuation`, () => {
    for (const error of [true, false]) {
      const sequence = functions
        ? new OpenRouterFunctionStreamSequence()
        : new OpenRouterTextStreamSequence();
      sequence.accept({
        kind: 'delta',
        id: 'completion',
        model: 'chat',
        created: 42,
        finishReason: 'stop',
      });
      sequence.accept({
        kind: 'usage',
        id: 'completion',
        model: 'chat',
        created: 42,
        finishReason: 'stop',
        usage: undefined,
        logprobs: finalProbabilities,
      });
      if (error) {
        sequence.accept({ kind: 'error' });
        assert.deepEqual(sequence.finish(), { status: 'failed', possiblyBilled: true });
      } else
        assert.throws(() =>
          sequence.accept({
            kind: 'delta',
            id: 'completion',
            model: 'chat',
            created: 42,
            finishReason: null,
          }),
        );
      assert.doesNotMatch(JSON.stringify(sequence), /private-terminal-probability/u);
    }
  });
  for (const kind of ['openai', 'openrouter'] as const)
    test(`${kind} ${functions ? 'function' : 'text'} probability event still obeys framed SSE byte limit`, async () => {
      const f = streamProbabilityFixture(kind, {
        mode: functions ? 'function' : 'text',
        groups: {
          content: Array.from({ length: 64 }, () => ({
            token: 'x'.repeat(16384),
            logprob: 0,
            bytes: null,
            top_logprobs: [],
          })),
        },
      });
      const response = await f.handler(
        f.request('/api/v1', streamProbabilityFields(functions ? 'function' : 'text')),
      );
      assert.equal(response.status, 502);
      assert.doesNotMatch(await response.text(), /xxxx|\[DONE\]/u);
      assert.equal(f.records.length, 1);
      assert.equal(f.records[0]?.outcome, 'failed');
      assert.equal(f.records[0]?.possiblyBilled, true);
      probabilityPrivacy(f);
    });
}
