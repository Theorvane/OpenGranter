import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import test from 'node:test';
import {
  OpenRouterChatFailure,
  type OpenRouterChatPorts,
} from '../src/providers/openrouter-chat.ts';
import { createOpenRouterTextStreamInvoker } from '../src/providers/openrouter-stream.ts';
import { invokeDelegatedTextStream } from '../src/streaming/invoke-delegated-text-stream.ts';
import type { UsageRecord } from '../src/usage/record-usage.ts';

const encoder = new TextEncoder();
const request = { model: 'chat', messages: [{ role: 'user' as const, content: 'private prompt' }] };
const attempt = { upstreamModelId: 'openai/example', authorizedProviderSlugs: ['OpenAI'] };

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

function delta(finishReason: string | null = null) {
  return `data: ${JSON.stringify({
    id: 'gen-1',
    object: 'chat.completion.chunk',
    created: 42,
    model: attempt.upstreamModelId,
    choices: [{ index: 0, delta: { content: 'private answer' }, finish_reason: finishReason }],
  })}\n\n`;
}

function successfulResponse() {
  const usage = `data: ${JSON.stringify({
    id: 'gen-1',
    object: 'chat.completion.chunk',
    created: 42,
    model: attempt.upstreamModelId,
    choices: [],
    usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 },
  })}\n\n`;
  return new Response(encoder.encode(`${delta()}${delta('stop')}${usage}data: [DONE]\n\n`), {
    headers: { 'content-type': 'text/event-stream' },
  });
}

function invoker(ports: Partial<OpenRouterChatPorts> = {}) {
  return createOpenRouterTextStreamInvoker({
    credentialRef: 'secret/openrouter',
    resolveSecret: async () => 'private-key',
    fetcher: async () => successfulResponse(),
    ...ports,
  });
}

function failure(started: boolean, billed: boolean, category = 'upstream') {
  return (error: unknown) => {
    assert.ok(error instanceof OpenRouterChatFailure);
    assert.equal(error.category, category);
    assert.equal(error.responseStarted, started);
    assert.equal(error.possiblyBilled, billed);
    assert.equal(error.message, 'OpenRouter chat attempt failed');
    assert.equal(JSON.stringify(error).includes('private'), false);
    return true;
  };
}

test('already cancelled attempt performs no credential or HTTP work', async () => {
  const cancellation = new AbortController();
  cancellation.abort('private caller reason');
  let secrets = 0;
  let fetches = 0;
  await assert.rejects(
    invoker({
      resolveSecret: async () => {
        secrets++;
        return 'private-key';
      },
      fetcher: async () => {
        fetches++;
        return successfulResponse();
      },
    })(attempt, request, () => {}, cancellation.signal),
    failure(false, false),
  );
  assert.equal(secrets, 0);
  assert.equal(fetches, 0);
});

test('cancellation while credentials are pending terminates without HTTP', {
  timeout: 3000,
}, async () => {
  const cancellation = new AbortController();
  const entered = deferred<void>();
  const secret = deferred<string>();
  let fetches = 0;
  const running = invoker({
    resolveSecret: async () => {
      entered.resolve();
      return secret.promise;
    },
    fetcher: async () => {
      fetches++;
      return successfulResponse();
    },
  })(attempt, request, () => {}, cancellation.signal);
  const rejected = assert.rejects(running, failure(false, false));
  await entered.promise;
  cancellation.abort('private cancellation');
  try {
    await rejected;
  } finally {
    secret.resolve('private-key');
  }
  assert.equal(fetches, 0);
});

test('pending fetch observes caller cancellation and is possibly billed without replay', {
  timeout: 3000,
}, async () => {
  const cancellation = new AbortController();
  const entered = deferred<AbortSignal>();
  let calls = 0;
  const running = invoker({
    fetcher: async (_url, init) => {
      calls++;
      const signal = init?.signal;
      assert.ok(signal);
      entered.resolve(signal);
      return new Promise<Response>((_resolve, reject) => {
        signal.addEventListener('abort', () => reject(new Error('private transport')), {
          once: true,
        });
      });
    },
  })(attempt, request, () => {}, cancellation.signal);
  const rejected = assert.rejects(running, failure(false, true));
  const signal = await entered.promise;
  cancellation.abort('private cancellation');
  await rejected;
  assert.equal(signal.aborted, true);
  assert.equal(calls, 1);
});

test('cancelled fetch ignoring abort cancels its eventual unread body', {
  timeout: 3000,
}, async () => {
  const cancellation = new AbortController();
  const entered = deferred<void>();
  const response = deferred<Response>();
  const cancelled = deferred<void>();
  const running = invoker({
    fetcher: async () => {
      entered.resolve();
      return response.promise;
    },
  })(attempt, request, () => {}, cancellation.signal);
  const rejected = assert.rejects(running, failure(false, true));
  await entered.promise;
  cancellation.abort('private cancellation');
  await rejected;
  response.resolve(new Response(new ReadableStream({ cancel: () => cancelled.resolve() })));
  await cancelled.promise;
});

test('stalled body cancellation releases reader even when source cancellation never settles', {
  timeout: 3000,
}, async () => {
  const cancellation = new AbortController();
  const fetched = deferred<void>();
  let cancelled = 0;
  const body = new ReadableStream<Uint8Array>({
    pull() {
      fetched.resolve();
    },
    cancel() {
      cancelled++;
      return new Promise<void>(() => {});
    },
  });
  const running = invoker({
    fetcher: async () => new Response(body, { headers: { 'content-type': 'text/event-stream' } }),
  })(attempt, request, () => {}, cancellation.signal);
  const rejected = assert.rejects(running, failure(true, true));
  await fetched.promise;
  // Ensure transport has handed the response to its owned SSE reader.
  await new Promise((resolve) => setImmediate(resolve));
  cancellation.abort('private reason');
  await rejected;
  assert.equal(cancelled, 1);
  assert.equal(body.locked, false);
});

test('cancellation during a blocked delta callback stops buffered event delivery', {
  timeout: 3000,
}, async () => {
  const cancellation = new AbortController();
  const delivered = deferred<void>();
  const release = deferred<void>();
  let callbacks = 0;
  const running = invoker()(
    attempt,
    request,
    async () => {
      callbacks++;
      delivered.resolve();
      await release.promise;
    },
    cancellation.signal,
  );
  const rejected = assert.rejects(running, failure(true, true));
  await delivered.promise;
  cancellation.abort('private reason');
  try {
    await rejected;
  } finally {
    release.resolve();
  }
  assert.equal(callbacks, 1);
});

test('timeout terminates an uncooperative stalled body with its existing safe category', {
  timeout: 3000,
}, async () => {
  const body = new ReadableStream<Uint8Array>();
  const keepAlive = setTimeout(() => {}, 1000);
  try {
    await assert.rejects(
      invoker({
        timeoutMs: 10,
        fetcher: async () =>
          new Response(body, {
            headers: { 'content-type': 'text/event-stream' },
          }),
      })(attempt, request, () => {}),
      failure(true, true, 'timeout'),
    );
    assert.equal(body.locked, false);
  } finally {
    clearTimeout(keepAlive);
  }
});

test('delegated cancellation records one possibly billed failed attempt and no terminal frames', {
  timeout: 3000,
}, async () => {
  const cancellation = new AbortController();
  const records: UsageRecord[] = [];
  const audits: unknown[] = [];
  const delivered = deferred<void>();
  const frames: string[] = [];
  let calls = 0;
  const invokeStream = invoker({
    fetcher: async () => {
      calls++;
      return new Response(
        new ReadableStream<Uint8Array>({
          start(controller) {
            controller.enqueue(encoder.encode(delta()));
          },
        }),
        { headers: { 'content-type': 'text/event-stream' } },
      );
    },
  });
  const running = invokeDelegatedTextStream({
    principalId: 'user-1',
    credentialId: 'credential-1',
    policyVersions: [],
    principalActive: true,
    requestId: 'req-cancel',
    routeVersion: 'v1',
    credentialRef: 'secret/openrouter',
    modelAlias: 'chat',
    request,
    candidates: [
      {
        id: 'candidate-1',
        kind: 'delegated',
        upstreamModelId: attempt.upstreamModelId,
        providerId: 'openai',
      },
    ],
    statements: [
      { effect: 'Allow', actions: ['llm:InvokeModel', 'llm:UseProvider'], resources: ['*'] },
    ],
    onFrame: (frame) => {
      frames.push(frame);
      delivered.resolve();
    },
    ports: {
      checkLimit: async () => true,
      resolveVerifiedProviderSlug: async () => 'OpenAI',
      writeUsage: async (record) => {
        records.push(record);
      },
      writeAudit: async (event) => {
        audits.push(event);
      },
      invokeOpenRouterTextStream: (_ref, scope, chat, callback) =>
        invokeStream(scope, chat, callback, cancellation.signal),
    },
  });
  await delivered.promise;
  cancellation.abort('private reason');
  assert.deepEqual(await running, {
    status: 'failed',
    reason: 'upstream-failed',
    possiblyBilled: true,
  });
  assert.equal(calls, 1);
  assert.equal(
    frames.some((frame) => frame.includes('[DONE]')),
    false,
  );
  assert.equal(records.length, 1);
  assert.equal(records[0]?.outcome, 'failed');
  assert.equal(records[0]?.possiblyBilled, true);
  assert.equal(records[0]?.usage.status, 'missing');
  assert.equal(JSON.stringify({ records, audits }).includes('private'), false);
});

test('successful stream with an active caller signal retains normal completion', async () => {
  const cancellation = new AbortController();
  const result = await invoker()(attempt, request, () => {}, cancellation.signal);
  assert.equal(result.status, 'complete');
  assert.equal(cancellation.signal.aborted, false);
});

test('successful stream removes abort listeners from the captured transport signal', async () => {
  let signal: AbortSignal | undefined;
  const result = await invoker({
    fetcher: async (_url, init) => {
      signal = init?.signal ?? undefined;
      return successfulResponse();
    },
  })(attempt, request, () => {}, new AbortController().signal);
  assert.equal(result.status, 'complete');
  assert.ok(signal);
  assert.equal(EventEmitter.getEventListeners(signal, 'abort').length, 0);
});

test('pre-dispatch cancellation has decision audit but no billable usage handoff', async () => {
  const cancellation = new AbortController();
  cancellation.abort('private reason');
  const records: UsageRecord[] = [];
  const audits: unknown[] = [];
  let secrets = 0;
  const invokeStream = invoker({
    resolveSecret: async () => {
      secrets++;
      return 'private-key';
    },
  });
  const result = await invokeDelegatedTextStream({
    principalId: 'user-1',
    credentialId: 'credential-1',
    policyVersions: [],
    principalActive: true,
    requestId: 'req-early',
    routeVersion: 'v1',
    credentialRef: 'secret/openrouter',
    modelAlias: 'chat',
    request,
    candidates: [
      {
        id: 'candidate-1',
        kind: 'delegated',
        upstreamModelId: attempt.upstreamModelId,
        providerId: 'openai',
      },
    ],
    statements: [
      { effect: 'Allow', actions: ['llm:InvokeModel', 'llm:UseProvider'], resources: ['*'] },
    ],
    onFrame: () => {
      assert.fail('cancelled attempt delivered a frame');
    },
    ports: {
      checkLimit: async () => true,
      resolveVerifiedProviderSlug: async () => 'OpenAI',
      writeUsage: async (record) => {
        records.push(record);
      },
      writeAudit: async (event) => {
        audits.push(event);
      },
      invokeOpenRouterTextStream: (_ref, scope, chat, callback) =>
        invokeStream(scope, chat, callback, cancellation.signal),
    },
  });
  assert.deepEqual(result, { status: 'failed', reason: 'upstream-failed', possiblyBilled: false });
  assert.equal(records.length, 0);
  assert.equal(secrets, 0);
  assert.equal(audits.length, 2);
  assert.equal(JSON.stringify(audits).includes('private'), false);
});

test('complete stream does not wait for an uncooperative source cancellation acknowledgment', {
  timeout: 1000,
}, async () => {
  const payload = new Uint8Array(await successfulResponse().arrayBuffer());
  let cancelled = 0;
  const body = new ReadableStream<Uint8Array>({
    start(controller) {
      controller.enqueue(payload);
    },
    cancel() {
      cancelled++;
      return new Promise<void>(() => {});
    },
  });
  const result = await invoker({
    fetcher: async () =>
      new Response(body, {
        headers: { 'content-type': 'text/event-stream' },
      }),
  })(attempt, request, () => {}, new AbortController().signal);
  assert.equal(result.status, 'complete');
  assert.equal(cancelled, 1);
  assert.equal(body.locked, false);
});
