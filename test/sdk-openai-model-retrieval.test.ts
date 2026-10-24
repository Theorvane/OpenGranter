import assert from 'node:assert/strict';
import type { AddressInfo } from 'node:net';
import test from 'node:test';
import OpenAI from 'openai';
import { createNodeRequestServer } from '../src/gateway/node-request-server.ts';
import {
  discoveryFixture,
  discoveryModel,
  discoveryPrivacy,
} from './model-discovery-filters-fixture.ts';
import { singleModelCatalog } from './single-model-discovery-fixture.ts';

for (const kind of ['managed', 'delegated'] as const)
  for (const base of ['/v1', '/api/v1'])
    test(`installed OpenAI retrieves ${kind} bare models on ${base} with exact encoded aliases and current IAM`, async () => {
      const f = discoveryFixture([
        ...singleModelCatalog(kind),
        discoveryModel('simple', { kind, basic: true }),
      ]);
      const paths: string[] = [];
      const server = createNodeRequestServer((request) => {
        paths.push(new URL(request.url).pathname);
        return f.handler(request);
      });
      await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
      try {
        const sdk = new OpenAI({
          apiKey: 'fixture-proxy-key',
          baseURL: `http://127.0.0.1:${(server.address() as AddressInfo).port}${base}`,
          maxRetries: 0,
          timeout: 3000,
        });
        const list = await sdk.models.list();
        for (const id of [
          'simple',
          'fixture/chat',
          'fixture/basic',
          'fixture/chat:free',
          'fixture/模型',
        ]) {
          const { data, response } = await sdk.models.retrieve(id).withResponse();
          assert.deepEqual(
            data,
            list.data.find((model) => model.id === id),
          );
          assert.equal(response.headers.get('cache-control'), 'no-store');
          assert.equal(response.headers.get('x-request-id'), 'request');
        }
        assert.deepEqual(paths.slice(1), [
          `${base}/models/simple`,
          `${base}/models/fixture%2Fchat`,
          `${base}/models/fixture%2Fbasic`,
          `${base}/models/fixture%2Fchat:free`,
          `${base}/models/fixture%2F%E6%A8%A1%E5%9E%8B`,
        ]);
        f.statements.push({ effect: 'Deny', actions: ['*'], resources: ['provider:provider'] });
        await assert.rejects(sdk.models.retrieve('fixture/chat'), (error: unknown) => {
          assert.ok(error instanceof OpenAI.APIError);
          assert.equal(error.status, 404);
          assert.equal(error.headers.get('cache-control'), 'no-store');
          assert.doesNotMatch(JSON.stringify(error.error), /fixture|private|canonical/u);
          return true;
        });
        assert.equal(f.reads(), 7);
        discoveryPrivacy(f);
      } finally {
        server.closeAllConnections();
        await new Promise<void>((resolve, reject) =>
          server.close((error) => (error ? reject(error) : resolve())),
        );
      }
    });
