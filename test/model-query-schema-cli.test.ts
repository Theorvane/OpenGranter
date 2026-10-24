import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { copyFile, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { pathToFileURL } from 'node:url';

test('offline compatibility command verifies all six structural pins', () => {
  const result = spawnSync(
    process.execPath,
    [
      '--disable-warning=ExperimentalWarning',
      '--experimental-strip-types',
      'scripts/check-openrouter-schema.ts',
    ],
    { encoding: 'utf8' },
  );
  assert.equal(result.status, 0);
  assert.equal(
    result.stdout,
    'PASS pinned OpenRouter request schema integrity\nPASS pinned OpenRouter model-query schema integrity\nPASS pinned OpenRouter model-response schema integrity\nPASS pinned OpenRouter model-count schema integrity\nPASS pinned OpenRouter single-model schema integrity\nPASS pinned OpenRouter user-model schema integrity\n',
  );
  assert.equal(result.stderr, '');
});

const root = new URL('../', import.meta.url);
const scriptNames = [
  'check-openrouter-schema.ts',
  'openrouter-schema.ts',
  'openrouter-model-query-schema.ts',
  'openrouter-model-response-schema.ts',
  'openrouter-model-count-schema.ts',
  'openrouter-single-model-schema.ts',
  'openrouter-user-model-schema.ts',
];
const pinNames = [
  'openrouter-request-schema.json',
  'openrouter-model-query-schema.json',
  'openrouter-model-response-schema.json',
  'openrouter-model-count-schema.json',
  'openrouter-single-model-schema.json',
  'openrouter-user-model-schema.json',
];
const safeFailure = 'FAIL OpenRouter schema check unavailable or invalid; no pin changed\n';
async function controlledLive(mode: string) {
  const directory = await mkdtemp(join(tmpdir(), 'opengranter-model-drift-'));
  try {
    await mkdir(join(directory, 'scripts'));
    await mkdir(join(directory, 'contracts'));
    for (const name of scriptNames)
      await copyFile(new URL(`scripts/${name}`, root), join(directory, 'scripts', name));
    const originals = await Promise.all(
      pinNames.map((name) => readFile(new URL(`contracts/${name}`, root), 'utf8')),
    );
    const [chatRaw, modelRaw, responseRaw, countRaw, singleRaw, userRaw] = originals;
    assert.ok(chatRaw && modelRaw && responseRaw && countRaw && singleRaw && userRaw);
    const chatPin = JSON.parse(chatRaw);
    const modelPin = JSON.parse(modelRaw);
    const responsePin = JSON.parse(responseRaw);
    const countPin = JSON.parse(countRaw);
    const singlePin = JSON.parse(singleRaw);
    const userPin = JSON.parse(userRaw);
    const p = chatPin.projection;
    const schemas = {
      ...p.definitions,
      ...p.streamDefinitions,
      ...p.reasoningDefinitions,
      ...p.usageDefinitions,
      ...p.responseDefinitions,
      ChatRequest: { type: 'object', required: p.required, properties: p.fields },
      ...responsePin.projection.definitions,
      ...countPin.projection.definitions,
      ...singlePin.projection.definitions,
      ...userPin.projection.definitions,
    };
    for (const [name, entry] of Object.entries(p.messageNames)) {
      const item = entry as { schema: object; required: boolean };
      const message = schemas[name];
      message.properties.name = item.schema;
      message.required = (message.required ?? []).filter((key: string) => key !== 'name');
      if (item.required) message.required.push('name');
    }
    schemas.ChatAssistantMessage.properties.tool_calls = p.toolMessages.ChatAssistantMessage.schema;
    schemas.ChatToolMessage = p.toolMessages.ChatToolMessage;
    const source = {
      openapi: p.openapi,
      info: { version: p.documentVersion },
      paths: {
        '/chat/completions': {
          post: {
            requestBody: { content: { 'application/json': { schema: { $ref: p.requestRef } } } },
            responses: {
              '200': { content: { 'application/json': { schema: { $ref: p.responseRef } } } },
            },
          },
        },
        '/models': {
          get: {
            operationId: modelPin.projection.operationId,
            parameters: Object.values(modelPin.projection.parameters),
            responses: {
              '200': { content: { 'application/json': { schema: responsePin.projection.schema } } },
            },
          },
        },
        '/model/{author}/{slug}': {
          get: {
            operationId: singlePin.projection.operationId,
            parameters: Object.values(singlePin.projection.parameters),
            responses: {
              '200': { content: { 'application/json': { schema: singlePin.projection.schema } } },
            },
          },
          parameters: [] as Record<string, unknown>[],
        },
        '/models/user': {
          get: {
            operationId: userPin.projection.operationId,
            parameters: Object.values(userPin.projection.parameters),
            security: userPin.projection.security,
            responses: {
              '200': { content: { 'application/json': { schema: userPin.projection.schema } } },
            },
          },
          parameters: [] as Record<string, unknown>[],
        },
        '/models/count': {
          get: {
            operationId: countPin.projection.operationId,
            parameters: Object.values(countPin.projection.parameters),
            responses: {
              '200': { content: { 'application/json': { schema: countPin.projection.schema } } },
            },
          },
        },
      },
      components: { schemas },
    };
    if (mode === 'model-drift' || mode === 'both-drift' || mode === 'all-drift')
      modelPin.projection.parameters.context.schema.minimum = 2;
    if (mode === 'chat-drift' || mode === 'both-drift' || mode === 'all-drift')
      schemas.ChatRequest.properties.user = { type: 'integer' };
    if (mode === 'image-drift')
      schemas.ChatContentImage.properties.image_url.properties.url = { type: 'integer' };
    if (mode === 'content-union-drift')
      schemas.ChatContentItems.discriminator.mapping.image_url = '#/components/schemas/NewImage';
    if (mode === 'alignment-drift') schemas.ChatResult.properties.alignment = { type: 'boolean' };
    if (mode === 'safeguard-drift')
      schemas.ChatStreamChunk.properties.safeguard_results.items = {
        $ref: '#/components/schemas/ChangedSafeguard',
      };
    if (mode === 'defer-loading-drift')
      schemas.ChatFunctionTool.anyOf[0].properties.function.properties.defer_loading = {
        type: 'string',
      };
    if (mode === 'legacy-nullable-drift')
      delete schemas.DefaultParameters.properties.temperature.nullable;
    if (mode === 'breakpoint-ttl-drift')
      schemas.PromptCacheBreakpoint.properties.ttl.type = 'string';
    if (mode === 'offset-nullable-drift')
      modelPin.projection.parameters.offset.schema.nullable = false;
    if (mode === 'response-drift' || mode === 'all-drift')
      schemas.Model.properties.context_length = { type: 'string' };
    if (mode === 'count-query-drift' || mode === 'all-drift')
      countPin.projection.parameters.output_modalities.schema.type = 'integer';
    if (mode === 'count-response-drift')
      schemas.ModelsCountResponse.properties.data.properties.count.type = 'number';
    for (const name of ['min_price', 'max_price', 'min_output_price', 'max_output_price'])
      if (mode === `${name}-drift`) modelPin.projection.parameters[name].schema.minimum = 1;
    if (mode === 'stale-model-pin') modelPin.version = 4;
    const singleOperation = source.paths['/model/{author}/{slug}'].get;
    if (mode === 'single-author-drift')
      singlePin.projection.parameters.author.schema.type = 'integer';
    if (mode === 'single-slug-drift') singlePin.projection.parameters.slug.schema.maxLength = 256;
    if (mode === 'single-root-drift') schemas.ModelResponse.required = [];
    if (mode === 'single-reference-drift')
      singleOperation.responses['200'].content['application/json'].schema = {
        $ref: '#/components/schemas/Other',
      };
    if (mode === 'single-model-drift')
      schemas.Model.properties.name = { type: 'string', maxLength: 64 };
    if (mode === 'metadata-drift') schemas.ModelLinks.properties.details.type = 'boolean';
    if (mode === 'invalid-single-pin') singlePin.version = 0;
    if (mode === 'stale-single-pin') singlePin.version = 2;
    if (mode === 'invalid-single-source') delete schemas.ModelResponse;
    if (mode === 'invalid-single-parameter')
      singleOperation.parameters.push(singlePin.projection.parameters.author);
    if (mode === 'invalid-single-inherited')
      source.paths['/model/{author}/{slug}'].parameters.push(
        singlePin.projection.parameters.author,
      );
    if (mode === 'invalid-model-pin') modelPin.version = 0;
    if (mode === 'invalid-chat-pin') chatPin.version = 0;
    if (mode === 'stale-chat-pin') chatPin.version = 32;
    if (mode === 'invalid-response-pin') responsePin.version = 0;
    if (mode === 'stale-response-pin') responsePin.version = 2;
    if (mode === 'invalid-count-pin') countPin.version = 0;
    if (mode === 'invalid-model-source') source.paths['/models'].get.parameters = [];
    if (mode === 'invalid-response-source') delete schemas.Model;
    if (mode === 'invalid-image-source') delete schemas.ChatContentImage;
    if (mode === 'invalid-count-source') delete schemas.ModelsCountResponse;
    if (mode === 'invalid-count-query-source') source.paths['/models/count'].get.parameters = [];
    const userOperation = source.paths['/models/user'].get;
    if (mode === 'user-query-drift' || mode === 'all-drift')
      userPin.projection.parameters.limit.schema.maximum = 999;
    if (mode === 'user-security-drift') userOperation.security = [];
    if (mode === 'user-identity-drift') userOperation.operationId = 'changed';
    if (mode === 'user-reference-drift')
      userOperation.responses['200'].content['application/json'].schema = {
        $ref: '#/components/schemas/Other',
      };
    if (mode === 'user-list-root-drift') schemas.ModelsListResponse.required = [];
    if (mode === 'user-array-drift')
      schemas.ModelsListResponseData.items = { $ref: '#/components/schemas/Other' };
    if (mode === 'invalid-user-pin') userPin.version = 0;
    if (mode === 'stale-user-pin') userPin.version = 2;
    if (mode === 'invalid-user-source') userOperation.parameters = [];
    if (mode === 'invalid-user-security') userOperation.security = null;
    if (mode === 'invalid-user-parameter')
      userOperation.parameters.push(userPin.projection.parameters.offset);
    if (mode === 'invalid-user-inherited')
      source.paths['/models/user'].parameters.push(userPin.projection.parameters.offset);
    // The downloaded source was constructed before drift mutations, and shares the selected objects.
    await writeFile(join(directory, 'source.json'), JSON.stringify(source));
    const pins = [...originals];
    if (mode === 'invalid-model-pin' || mode === 'stale-model-pin')
      pins[1] = JSON.stringify(modelPin);
    if (mode === 'invalid-chat-pin' || mode === 'stale-chat-pin') pins[0] = JSON.stringify(chatPin);
    if (mode === 'invalid-response-pin' || mode === 'stale-response-pin')
      pins[2] = JSON.stringify(responsePin);
    if (mode === 'invalid-count-pin') pins[3] = JSON.stringify(countPin);
    if (mode === 'invalid-single-pin' || mode === 'stale-single-pin')
      pins[4] = JSON.stringify(singlePin);
    if (mode === 'invalid-user-pin' || mode === 'stale-user-pin') pins[5] = JSON.stringify(userPin);
    for (let i = 0; i < pinNames.length; i++) {
      const name = pinNames[i];
      const raw = pins[i];
      assert.ok(name && raw);
      await writeFile(join(directory, 'contracts', name), raw);
    }
    const script = join(directory, 'scripts', scriptNames[0] ?? '');
    const setup = `import fs from 'node:fs';
      let count=0;
      globalThis.fetch=async (url, init)=> {
        count++; fs.writeFileSync(${JSON.stringify(join(directory, 'calls.json'))}, JSON.stringify({count,url,redirect:init.redirect,credentials:init.credentials,headers:init.headers??null}));
        if (${JSON.stringify(mode)}==='transport-error') throw new Error('private downloaded content and credentials');
        return new Response(fs.readFileSync(${JSON.stringify(join(directory, 'source.json'))}), {status:200});
      };
      process.argv=[process.execPath,${JSON.stringify(script)},'--live'];
      await import(${JSON.stringify(pathToFileURL(script).href)});`;
    const result = spawnSync(
      process.execPath,
      [
        '--disable-warning=ExperimentalWarning',
        '--experimental-strip-types',
        '--input-type=module',
        '-e',
        setup,
      ],
      { encoding: 'utf8', timeout: 5000 },
    );
    const calls = await readFile(join(directory, 'calls.json'), 'utf8').then(JSON.parse, () => ({
      count: 0,
    }));
    for (let i = 0; i < pinNames.length; i++) {
      const name = pinNames[i];
      assert.ok(name);
      assert.equal(await readFile(join(directory, 'contracts', name), 'utf8'), pins[i]);
    }
    if (calls.count)
      assert.deepEqual(calls, {
        count: 1,
        url: 'https://openrouter.ai/openapi.json',
        redirect: 'error',
        credentials: 'omit',
        headers: null,
      });
    assert.equal(`${result.stdout}${result.stderr}`.includes('private'), false);
    return { result, calls };
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
}

test('live compatibility validates all six pins against one bounded credential-free download', async () => {
  const { result, calls } = await controlledLive('unchanged');
  assert.equal(result.status, 0);
  assert.equal(calls.count, 1);
  assert.equal(
    result.stdout,
    'PASS selected OpenRouter request schema unchanged\nPASS selected OpenRouter model-query schema unchanged\nPASS selected OpenRouter model-response schema unchanged\nPASS selected OpenRouter model-count schema unchanged\nPASS selected OpenRouter single-model schema unchanged\nPASS selected OpenRouter user-model schema unchanged\n',
  );
  assert.equal(result.stderr, '');
});
for (const mode of [
  'model-drift',
  'chat-drift',
  'both-drift',
  'response-drift',
  'all-drift',
  'image-drift',
  'content-union-drift',
  'alignment-drift',
  'safeguard-drift',
  'defer-loading-drift',
  'legacy-nullable-drift',
  'breakpoint-ttl-drift',
  'offset-nullable-drift',
  'count-query-drift',
  'count-response-drift',
  'single-author-drift',
  'single-slug-drift',
  'single-root-drift',
  'single-reference-drift',
  'single-model-drift',
  'metadata-drift',
  'user-query-drift',
  'user-security-drift',
  'user-identity-drift',
  'user-reference-drift',
  'user-list-root-drift',
  'user-array-drift',
  'min_price-drift',
  'max_price-drift',
  'min_output_price-drift',
  'max_output_price-drift',
])
  test(`live ${mode} reports the selected subset and preserves all pins`, async () => {
    const { result, calls } = await controlledLive(mode);
    assert.equal(result.status, 1);
    assert.equal(calls.count, 1);
    const chatDrift = [
      'chat-drift',
      'both-drift',
      'all-drift',
      'image-drift',
      'content-union-drift',
      'alignment-drift',
      'safeguard-drift',
      'defer-loading-drift',
      'breakpoint-ttl-drift',
    ].includes(mode);
    const modelDrift = [
      'model-drift',
      'both-drift',
      'all-drift',
      'min_price-drift',
      'max_price-drift',
      'min_output_price-drift',
      'max_output_price-drift',
      'offset-nullable-drift',
    ].includes(mode);
    const responseDrift = [
      'response-drift',
      'all-drift',
      'legacy-nullable-drift',
      'single-model-drift',
      'metadata-drift',
      'user-list-root-drift',
      'user-array-drift',
    ].includes(mode);
    const countDrift = ['count-query-drift', 'count-response-drift', 'all-drift'].includes(mode);
    const singleDrift = [
      'single-author-drift',
      'single-slug-drift',
      'single-root-drift',
      'single-reference-drift',
      'single-model-drift',
      'response-drift',
      'all-drift',
    ].includes(mode);
    const userDrift = [
      'user-query-drift',
      'user-security-drift',
      'user-identity-drift',
      'user-reference-drift',
      'user-list-root-drift',
      'user-array-drift',
      'response-drift',
      'single-model-drift',
      'all-drift',
    ].includes(mode);
    assert.equal(
      result.stdout,
      `${chatDrift ? '' : 'PASS selected OpenRouter request schema unchanged\n'}${modelDrift ? '' : 'PASS selected OpenRouter model-query schema unchanged\n'}${responseDrift ? '' : 'PASS selected OpenRouter model-response schema unchanged\n'}${countDrift ? '' : 'PASS selected OpenRouter model-count schema unchanged\n'}${singleDrift ? '' : 'PASS selected OpenRouter single-model schema unchanged\n'}${userDrift ? '' : 'PASS selected OpenRouter user-model schema unchanged\n'}`,
    );
    assert.equal(
      result.stderr,
      `${chatDrift ? 'FAIL selected OpenRouter request schema drift; review the pin and contracts\n' : ''}${modelDrift ? 'FAIL selected OpenRouter model-query schema drift; review the pin and contracts\n' : ''}${responseDrift ? 'FAIL selected OpenRouter model-response schema drift; review the pin and contracts\n' : ''}${countDrift ? 'FAIL selected OpenRouter model-count schema drift; review the pin and contracts\n' : ''}${singleDrift ? 'FAIL selected OpenRouter single-model schema drift; review the pin and contracts\n' : ''}${userDrift ? 'FAIL selected OpenRouter user-model schema drift; review the pin and contracts\n' : ''}`,
    );
  });
test('live transport failures expose only the safe fixed diagnostic and do not write pins', async () => {
  const { result } = await controlledLive('transport-error');
  assert.equal(result.status, 1);
  assert.equal(result.stdout, '');
  assert.equal(result.stderr, safeFailure);
});
for (const mode of [
  'invalid-model-pin',
  'stale-model-pin',
  'invalid-chat-pin',
  'invalid-response-pin',
  'stale-chat-pin',
  'stale-response-pin',
  'invalid-count-pin',
  'invalid-single-pin',
  'stale-single-pin',
  'invalid-user-pin',
  'stale-user-pin',
])
  test(`live ${mode} rejects before fetching or reporting success`, async () => {
    const { result, calls } = await controlledLive(mode);
    assert.equal(result.status, 1);
    assert.equal(calls.count, 0);
    assert.equal(result.stdout, '');
    assert.equal(result.stderr, safeFailure);
  });
for (const mode of [
  'invalid-model-source',
  'invalid-response-source',
  'invalid-image-source',
  'invalid-count-source',
  'invalid-count-query-source',
  'invalid-single-source',
  'invalid-single-parameter',
  'invalid-single-inherited',
  'invalid-user-source',
  'invalid-user-security',
  'invalid-user-parameter',
  'invalid-user-inherited',
])
  test(`malformed selected ${mode} withholds all success output and preserves pins`, async () => {
    const { result, calls } = await controlledLive(mode);
    assert.equal(result.status, 1);
    assert.equal(calls.count, 1);
    assert.equal(result.stdout, '');
    assert.equal(result.stderr, safeFailure);
  });
