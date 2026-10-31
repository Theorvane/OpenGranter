import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { test } from 'node:test';

const read = (path: string) => readFile(new URL(`../${path}`, import.meta.url), 'utf8');

test('container installs locked production dependencies without lifecycle scripts', async () => {
  const image = await read('Dockerfile');
  for (const line of [
    'FROM node:22-bookworm-slim AS dependencies',
    'COPY package.json package-lock.json ./',
    'RUN npm ci --omit=dev --ignore-scripts',
    'COPY --from=dependencies /app/node_modules ./node_modules',
  ])
    assert.ok(image.includes(line));
});

test('container keeps runtime root-owned, non-root and direct signal ownership', async () => {
  const image = await read('Dockerfile');
  for (const path of ['src', 'migrations']) assert.ok(image.includes(`COPY ${path}/ ./${path}/`));
  assert.ok(image.includes('COPY scripts/start-gateway.ts ./scripts/start-gateway.ts'));
  assert.ok(image.includes('COPY package.json ./package.json'));
  assert.ok(image.includes('USER node\n'));
  assert.ok(image.includes('STOPSIGNAL SIGTERM'));
  assert.ok(
    image.includes('ENTRYPOINT ["node", "--experimental-strip-types", "scripts/start-gateway.ts"]'),
  );
  assert.doesNotMatch(image, /COPY \.|--chown|OPENGRANTER_HOST=|HEALTHCHECK|ARG .*SECRET/iu);
});

test('container context allows runtime files only and never local configuration', async () => {
  const lines = (await read('.dockerignore'))
    .split('\n')
    .filter((line) => line && !line.startsWith('#'));
  assert.deepEqual(lines, [
    '**',
    '!Dockerfile',
    '!package.json',
    '!package-lock.json',
    '!src/',
    '!src/**',
    '!migrations/',
    '!migrations/**',
    '!scripts/',
    '!scripts/start-gateway.ts',
  ]);
});
