import assert from 'node:assert/strict';
import type { AddressInfo } from 'node:net';
import test from 'node:test';
import { OpenRouter } from '@openrouter/sdk';
import OpenAI from 'openai';
import { createNodeRequestServer } from '../src/gateway/node-request-server.ts';
import {
  capabilityFields,
  capabilityModel,
  capabilityPrivacy,
} from './model-capability-metadata-fixture.ts';
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
const mappings: Record<string, string> = {
  mandatory: 'mandatory',
  default_enabled: 'defaultEnabled',
  default_effort: 'defaultEffort',
  supported_efforts: 'supportedEfforts',
  supports_max_tokens: 'supportsMaxTokens',
};
const sets: Record<string, unknown>[] = [
  capabilityFields,
  { reasoning: { mandatory: false }, alias_target: { slug: '', name: ' ' } },
  { reasoning: { mandatory: true, default_effort: null, supported_efforts: null } },
  {
    reasoning: {
      mandatory: false,
      default_effort: 'future-effort',
      supported_efforts: ['future-effort', null, 'future-effort'],
    },
  },
  {
    reasoning: {
      mandatory: true,
      default_enabled: false,
      default_effort: 'none',
      supported_efforts: [],
      supports_max_tokens: false,
    },
  },
  {},
];
for (const [index, fields] of sets.entries())
  test(`installed SDK reasoning/alias shapes preserve null/omission/open values case${index}`, async () => {
    const f = discoveryFixture([capabilityModel(fields)]);
    await socket(f, async (sdk, openai) => {
      const row = (await sdk.models.list()).result.data[0];
      assert.ok(row);
      const raw = (await openai.models.list()).data[0] as unknown as Record<string, unknown>;
      for (const key of ['reasoning', 'alias_target']) {
        assert.equal(Object.hasOwn(raw, key), Object.hasOwn(fields, key));
        assert.deepEqual(raw[key], fields[key]);
      }
      assert.deepEqual(row.aliasTarget, fields.alias_target);
      const expected = fields.reasoning as Record<string, unknown> | undefined;
      assert.deepEqual(
        row.reasoning,
        expected === undefined
          ? undefined
          : Object.fromEntries(
              Object.entries(expected).map(([key, value]) => [mappings[key], value]),
            ),
      );
    });
    capabilityPrivacy(f);
  });
test('installed SDK pages retain capability objects and fresh Deny', async () => {
  const f = discoveryFixture([
    capabilityModel(capabilityFields, 'first'),
    capabilityModel(
      {
        reasoning: { mandatory: false, supported_efforts: null },
        alias_target: { slug: 'source-two', name: 'Source two' },
      },
      'second',
    ),
  ]);
  await socket(f, async (sdk, openai) => {
    const first = await sdk.models.list({ limit: 1 });
    assert.equal(first.result.data[0]?.reasoning?.mandatory, true);
    assert.equal(first.result.data[0]?.aliasTarget?.slug, capabilityFields.alias_target.slug);
    const next = await first.next();
    assert.ok(next);
    assert.equal(next.result.data[0]?.reasoning?.supportedEfforts, null);
    assert.equal(next.result.data[0]?.aliasTarget?.slug, 'source-two');
    const raw = (await openai.models.list({ query: { limit: 1, offset: 1 } }))
      .data[0] as unknown as Record<string, unknown>;
    assert.deepEqual(raw.reasoning, { mandatory: false, supported_efforts: null });
    f.statements.splice(0, f.statements.length, {
      effect: 'Deny',
      actions: ['*'],
      resources: ['provider:provider'],
    });
    const denied = await first.next();
    assert.ok(denied);
    assert.deepEqual(denied.result.data, []);
    assert.equal(denied.result.totalCount, 0);
    assert.deepEqual((await openai.models.list()).data, []);
  });
  capabilityPrivacy(f);
});
test('installed SDK malformed capability failure stays private', async () => {
  const f = discoveryFixture([capabilityModel({ reasoning: { mandatory: null } })]);
  await socket(f, async (sdk, openai) => {
    await assert.rejects(
      () => sdk.models.list(),
      (error) => {
        assert.ok(error instanceof Error);
        assert.doesNotMatch(error.message, /catalog-private|reasoning|alias_target/u);
        return true;
      },
    );
    await assert.rejects(
      () => openai.models.list(),
      (error) => {
        assert.ok(error instanceof OpenAI.APIError);
        assert.equal(error.status, 503);
        assert.doesNotMatch(error.message, /catalog-private|reasoning|alias_target/u);
        return true;
      },
    );
  });
  capabilityPrivacy(f);
});
