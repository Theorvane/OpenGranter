import assert from 'node:assert/strict';
import type { AddressInfo } from 'node:net';
import test from 'node:test';
import { OpenRouter } from '@openrouter/sdk';
import OpenAI from 'openai';
import { createNodeRequestServer } from '../src/gateway/node-request-server.ts';
import {
  benchmarkData,
  benchmarkModel,
  benchmarkPrivacy,
  benchmarkRow,
} from './model-benchmark-metadata-fixture.ts';
import { discoveryFixture } from './model-discovery-filters-fixture.ts';

async function socket(
  f: ReturnType<typeof discoveryFixture>,
  run: (sdk: OpenRouter, openai: OpenAI) => Promise<void>,
) {
  const server = createNodeRequestServer(f.handler);
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  try {
    const url = `http://127.0.0.1:${(server.address() as AddressInfo).port}/api/v1`;
    await run(
      new OpenRouter({
        apiKey: 'fixture-proxy-key',
        serverURL: url,
        retryConfig: { strategy: 'none' },
        timeoutMs: 3000,
      }),
      new OpenAI({ apiKey: 'fixture-proxy-key', baseURL: url, maxRetries: 0, timeout: 3000 }),
    );
  } finally {
    server.closeAllConnections();
    await new Promise<void>((resolve, reject) =>
      server.close((error) => (error ? reject(error) : resolve())),
    );
  }
}
const sets: Record<string, unknown>[] = [
  { benchmarks: benchmarkData },
  { benchmarks: { design_arena: [] } },
  {
    benchmarks: {
      design_arena: [{ arena: '', category: ' \n ', elo: -0.5, win_rate: 123.456, rank: 0 }],
      artificial_analysis: { intelligence_index: null, coding_index: null, agentic_index: null },
    },
  },
  {
    benchmarks: {
      design_arena: [
        { ...benchmarkRow, rank: Number.MIN_SAFE_INTEGER },
        { ...benchmarkRow, rank: Number.MAX_SAFE_INTEGER },
      ],
      artificial_analysis: {
        intelligence_index: Number.MAX_VALUE,
        coding_index: -Number.MAX_VALUE,
        agentic_index: Number.MIN_VALUE,
      },
    },
  },
  {},
];
for (const [index, extra] of sets.entries())
  test(`installed SDK benchmark field mappings and exact null/empty/extreme case${index}`, async () => {
    const f = discoveryFixture([benchmarkModel(extra)]);
    await socket(f, async (sdk, openai) => {
      const row = (await sdk.models.list()).result.data[0];
      assert.ok(row);
      const raw = (await openai.models.list()).data[0] as unknown as Record<string, unknown>;
      assert.equal(Object.hasOwn(raw, 'benchmarks'), Object.hasOwn(extra, 'benchmarks'));
      assert.deepEqual(raw.benchmarks, extra.benchmarks);
      const expected = extra.benchmarks as typeof benchmarkData | undefined;
      assert.deepEqual(
        row.benchmarks,
        expected === undefined
          ? undefined
          : {
              ...(Object.hasOwn(expected, 'artificial_analysis')
                ? {
                    artificialAnalysis: {
                      intelligenceIndex: expected.artificial_analysis.intelligence_index,
                      codingIndex: expected.artificial_analysis.coding_index,
                      agenticIndex: expected.artificial_analysis.agentic_index,
                    },
                  }
                : {}),
              designArena: expected.design_arena.map(({ win_rate, ...rest }) => ({
                ...rest,
                winRate: win_rate,
              })),
            },
      );
    });
    benchmarkPrivacy(f);
  });
test('installed SDK pages retain benchmark objects and fresh provider Deny', async () => {
  const f = discoveryFixture([
    benchmarkModel({ benchmarks: benchmarkData }, 'first'),
    benchmarkModel({ benchmarks: { design_arena: [] } }, 'second'),
  ]);
  await socket(f, async (sdk, openai) => {
    const first = await sdk.models.list({ limit: 1 });
    assert.equal(first.result.data[0]?.benchmarks?.designArena.length, 2);
    const next = await first.next();
    assert.ok(next);
    assert.deepEqual(next.result.data[0]?.benchmarks, { designArena: [] });
    const raw = (await openai.models.list({ query: { offset: 1, limit: 1 } }))
      .data[0] as unknown as Record<string, unknown>;
    assert.deepEqual(raw.benchmarks, { design_arena: [] });
    f.statements.splice(0, f.statements.length, {
      effect: 'Deny',
      actions: ['*'],
      resources: ['provider:provider'],
    });
    const denied = await first.next();
    assert.ok(denied);
    assert.equal(denied.result.totalCount, 0);
    assert.deepEqual(denied.result.data, []);
    assert.deepEqual((await openai.models.list()).data, []);
  });
  benchmarkPrivacy(f);
});
test('installed SDK malformed/nonfinite benchmark errors remain sanitized', async () => {
  const f = discoveryFixture([
    benchmarkModel({ benchmarks: { design_arena: [{ ...benchmarkRow, win_rate: NaN }] } }),
  ]);
  await socket(f, async (sdk, openai) => {
    await assert.rejects(
      () => sdk.models.list(),
      (error) => {
        assert.ok(error instanceof Error);
        assert.doesNotMatch(error.message, /benchmark-private|benchmarks|win_rate/u);
        return true;
      },
    );
    await assert.rejects(
      () => openai.models.list(),
      (error) => {
        assert.ok(error instanceof OpenAI.APIError);
        assert.equal(error.status, 503);
        assert.doesNotMatch(error.message, /benchmark-private|benchmarks|win_rate/u);
        return true;
      },
    );
  });
  benchmarkPrivacy(f);
});
