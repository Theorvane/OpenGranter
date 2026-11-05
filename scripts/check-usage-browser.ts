/** Explicit disposable loopback acceptance; NEVER expose this fixture via ingress. */
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { PGlite } from '@electric-sql/pglite';
import { build } from 'esbuild';
import { createNodeRequestServer } from '../src/gateway/node-request-server.ts';
import { createPostgresSsoUsageHistoryHandler } from '../src/gateway/postgres-sso-usage-history-http.ts';
import { loadPostgresMigrationSources } from '../src/storage/postgres-migration-sources.ts';
import { createPostgresUsageLedger } from '../src/usage/postgres-ledger.ts';
import { buildUsageRecord } from '../src/usage/record-usage.ts';
import { createSsoAccessTokenFixture } from '../test/sso-access-token-fixture.ts';

async function until<T>(read: () => Promise<T>, accept: (value: T) => boolean): Promise<T> {
  const deadline = Date.now() + 15_000;
  while (Date.now() < deadline) {
    const value = await read();
    if (accept(value)) return value;
    await delay(50);
  }
  throw Error('Browser acceptance condition timed out');
}
class Cdp {
  private id = 0;
  private pending = new Map<
    number,
    {
      resolve: (value: Record<string, unknown>) => void;
      reject: (error: Error) => void;
      timer: ReturnType<typeof setTimeout>;
    }
  >();
  private socket: WebSocket;
  constructor(socket: WebSocket) {
    this.socket = socket;
    socket.addEventListener('message', (event) => {
      const message = JSON.parse(String(event.data)) as {
        id?: number;
        result?: Record<string, unknown>;
        error?: unknown;
      };
      if (message.id === undefined) return;
      const callback = this.pending.get(message.id);
      if (!callback) return;
      clearTimeout(callback.timer);
      this.pending.delete(message.id);
      if (message.error) callback.reject(Error('CDP command failed'));
      else callback.resolve(message.result ?? {});
    });
    socket.addEventListener('close', () => this.close());
  }
  static async connect(url: string) {
    const socket = new WebSocket(url);
    await new Promise<void>((resolve, reject) => {
      const timer = setTimeout(() => {
        socket.close();
        reject(Error('CDP connection timeout'));
      }, 15_000);
      socket.addEventListener(
        'open',
        () => {
          clearTimeout(timer);
          resolve();
        },
        { once: true },
      );
      socket.addEventListener(
        'error',
        () => {
          clearTimeout(timer);
          reject(Error('CDP unavailable'));
        },
        { once: true },
      );
    });
    return new Cdp(socket);
  }
  send(method: string, params: Record<string, unknown> = {}): Promise<Record<string, unknown>> {
    const id = ++this.id;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(Error('CDP command timeout'));
      }, 15_000);
      this.pending.set(id, { resolve, reject, timer });
      this.socket.send(JSON.stringify({ id, method, params }));
    });
  }
  async evaluate(expression: string) {
    const result = await this.send('Runtime.evaluate', {
      expression,
      awaitPromise: true,
      returnByValue: true,
    });
    if (result.exceptionDetails) throw Error('Browser evaluation failed');
    return (result.result as { value?: unknown } | undefined)?.value;
  }
  close() {
    for (const callback of this.pending.values()) {
      clearTimeout(callback.timer);
      callback.reject(Error('CDP closed'));
    }
    this.pending.clear();
    this.socket.close();
  }
}

const db = new PGlite();
const jwt = await createSsoAccessTokenFixture();
let token = await jwt.token();
let requestId = 0;
let release: (() => void) | undefined;
let gate: Promise<void> | undefined;
const client = { query: (text: string, values: readonly unknown[]) => db.query(text, [...values]) };
const usage = createPostgresSsoUsageHistoryHandler({
  ...jwt.config,
  client,
  newRequestId: () => `browser-${++requestId}`,
});
const bundle = await build({
  stdin: {
    contents: `import { mountManagementUsage } from './src/management/usage-app.ts';
      window.usage = mountManagementUsage(document.querySelector('#root'));
      window.connectUsage = () => window.usage.connect((path, init) => fetch(path, init));`,
    resolveDir: process.cwd(),
  },
  bundle: true,
  platform: 'browser',
  format: 'iife',
  write: false,
});
const javascript = bundle.outputFiles[0]?.text;
assert.ok(javascript);
const html =
  '<!doctype html><html lang="en"><meta charset="utf-8"><title>Local signed-SSO usage acceptance</title><main id="root"></main><script src="/app.js"></script></html>';
const server = createNodeRequestServer(
  async (request) => {
    const url = new URL(request.url);
    if (url.pathname === '/' && request.method === 'GET')
      return new Response(html, {
        headers: { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store' },
      });
    if (url.pathname === '/app.js' && request.method === 'GET')
      return new Response(javascript, {
        headers: { 'content-type': 'text/javascript', 'cache-control': 'no-store' },
      });
    if (url.pathname !== '/management/v1/usage' || request.method !== 'GET')
      return new Response(null, { status: 404 });
    await gate;
    // TEST ONLY server-memory credential injection, no browser session or token endpoint.
    return usage(
      new Request(request.url, { method: 'GET', headers: { authorization: `Bearer ${token}` } }),
    );
  },
  () => new Response(null, { status: 503 }),
);
const profile = await mkdtemp(join(tmpdir(), 'og-usage-browser-'));
let cdp: Cdp | undefined;
let browser: ReturnType<typeof spawn> | undefined;
try {
  for (const source of await loadPostgresMigrationSources()) await db.exec(source.sql);
  // Candidate schema applied ONLY in this isolated disposable database.
  await db.exec(
    await readFile(new URL('../contracts/sso-usage-audit-schema.sql', import.meta.url), 'utf8'),
  );
  await db.exec(`INSERT INTO iam_principals VALUES ('human','human',true),('other','human',true);
    INSERT INTO iam_policies VALUES ('p','v1','[{"effect":"Allow","actions":["usage:ReadSelf"],"resources":["principal:human"]}]');
    INSERT INTO iam_principal_policies VALUES ('human','p');`);
  await db.query('INSERT INTO iam_sso_identity_bindings VALUES ($1,$2,$3)', [
    jwt.issuer,
    jwt.subject,
    'human',
  ]);
  const ledger = createPostgresUsageLedger(client);
  for (const [attemptId, principalId, occurredAt, modelAlias] of [
    ['older', 'human', 1, 'chat-old'],
    ['newer', 'human', 2, 'chat-new'],
    ['private-other', 'other', 3, 'private-other-model'],
  ] as const) {
    await ledger(
      buildUsageRecord({
        principalId,
        credentialId: 'credential',
        policyVersions: [],
        requestId: attemptId,
        attemptId,
        modelAlias,
        routeKind: 'managed',
        upstreamModelId: 'model',
        selectedCandidateId: 'candidate',
        occurredAt,
        latencyMs: 2,
        outcome: 'succeeded',
        possiblyBilled: true,
        possibleDuplicate: false,
      }),
    );
  }
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  const address = server.address();
  assert.ok(address && typeof address !== 'string');
  const url = `http://127.0.0.1:${address.port}/`;
  browser = spawn(
    process.env.CHROMIUM_PATH ?? '/usr/bin/chromium',
    [
      '--headless=new',
      '--no-sandbox',
      '--disable-dev-shm-usage',
      '--disable-background-networking',
      '--no-first-run',
      '--no-default-browser-check',
      '--remote-debugging-address=127.0.0.1',
      '--remote-debugging-port=0',
      `--user-data-dir=${profile}`,
      'about:blank',
    ],
    { stdio: 'ignore' },
  );
  let launchFailed = false;
  browser.once('error', () => {
    launchFailed = true;
  });
  const portText = await until(
    async () => {
      if (launchFailed || browser?.exitCode !== null) throw Error('Chromium launch failed');
      return readFile(join(profile, 'DevToolsActivePort'), 'utf8').catch(() => '');
    },
    (value) => value.includes('\n'),
  );
  const debugPort = Number(portText.split('\n')[0]);
  assert.ok(Number.isInteger(debugPort) && debugPort > 0);
  const targets = (await (await fetch(`http://127.0.0.1:${debugPort}/json/list`)).json()) as {
    type: string;
    webSocketDebuggerUrl: string;
  }[];
  const target = targets.find((value) => value.type === 'page');
  assert.ok(target);
  cdp = await Cdp.connect(target.webSocketDebuggerUrl);
  await cdp.send('Page.enable');
  await cdp.send('Page.navigate', { url });
  const evaluate = (expression: string) => {
    assert.ok(cdp);
    return cdp.evaluate(expression);
  };
  const text = async () => String(await evaluate('document.body.innerText'));
  const waitText = (value: string) => until(text, (body) => body.includes(value));
  const click = async (label: string) => {
    assert.equal(
      await evaluate(
        `(() => { const b = [...document.querySelectorAll('button')].find(b => b.textContent === ${JSON.stringify(label)}); if (!b) return false; b.click(); return true; })()`,
      ),
      true,
    );
  };
  const filter = async (label: string, value: string) => {
    assert.equal(
      await evaluate(
        `(() => { const l = [...document.querySelectorAll('label')].find(l => l.textContent === ${JSON.stringify(label)}); if (!l) return false; l.querySelector('input').value = ${JSON.stringify(value)}; return true; })()`,
      ),
      true,
    );
  };
  await waitText('Sign-in required.');
  await evaluate('window.connectUsage()');
  await waitText('chat-new');
  assert.ok((await text()).includes('Unknown'));
  assert.ok(!(await text()).includes('private-other-model'));
  assert.ok(
    !((await evaluate('document.documentElement.outerHTML')) as string).includes(token),
    'Credential never reaches browser DOM',
  );
  assert.equal(await evaluate('localStorage.length + sessionStorage.length'), 0);
  if (process.env.USAGE_BROWSER_SCREENSHOT) {
    const screenshot = await cdp.send('Page.captureScreenshot', { format: 'png' });
    assert.equal(typeof screenshot.data, 'string');
    await writeFile(
      process.env.USAGE_BROWSER_SCREENSHOT,
      Buffer.from(String(screenshot.data), 'base64'),
    );
  }
  await filter('Page size (1–100)', '1');
  await click('Apply filters');
  await waitText('Next page');
  assert.ok(!(await text()).includes('chat-old'));
  await click('Export current page CSV');
  await waitText('Download usage.csv');
  const csv = await evaluate(
    `fetch(document.querySelector('a[download]').href).then(r => r.text())`,
  );
  assert.equal(typeof csv, 'string');
  assert.ok(String(csv).includes('chat-new') && !String(csv).includes('chat-old'));
  assert.ok(!String(csv).includes('private-other-model'));
  await click('Next page');
  await waitText('chat-old');
  assert.ok(!(await text()).includes('chat-new'));
  assert.equal(await evaluate('Boolean(document.querySelector("a[download]"))'), false);
  await filter('Model', 'absent');
  await click('Apply filters');
  await waitText('No usage records.');
  await filter('Model', '');
  await filter('Principal ID', 'other');
  await click('Apply filters');
  await waitText('Access denied.');
  assert.equal(await evaluate('document.querySelectorAll("tbody tr").length'), 0);
  await evaluate('window.connectUsage()');
  await waitText('chat-new');
  await db.exec('DELETE FROM iam_principal_policies');
  await click('Retry / first page');
  await waitText('Access denied.');
  await db.exec("INSERT INTO iam_principal_policies VALUES ('human','p')");
  token = await jwt.token({ exp: Math.floor(jwt.config.now() / 1000) - 3600 });
  await evaluate('window.connectUsage()');
  await waitText('Sign-in required.');
  const audit = await db.query<{ outcome: string }>(
    'SELECT outcome FROM sso_usage_audit_events ORDER BY event_id',
  );
  assert.ok(audit.rows.some((row) => row.outcome === 'forbidden'));
  assert.ok(audit.rows.some((row) => row.outcome === 'unauthenticated'));
  assert.ok(audit.rows.some((row) => row.outcome === 'ready'));
  token = await jwt.token();
  await db.exec('DROP TABLE sso_usage_audit_events');
  await evaluate('window.connectUsage()');
  await waitText('Usage unavailable. Try again later.');
  assert.equal(await evaluate('document.querySelectorAll("tbody tr").length'), 0);
  await db.exec(
    await readFile(new URL('../contracts/sso-usage-audit-schema.sql', import.meta.url), 'utf8'),
  );
  gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  await evaluate('void window.connectUsage()');
  await waitText('Loading usage…');
  await evaluate('window.usage.clear("expired")');
  release?.();
  gate = undefined;
  await waitText('Session expired. Sign in again.');
  await delay(200);
  assert.equal(await evaluate('document.querySelectorAll("tbody tr,input,a[download]").length'), 0);
  await evaluate('window.usage.dispose()');
  assert.equal(await evaluate('document.querySelector("#root").childElementCount'), 0);
  console.log(
    `PASS real Chromium usage screen: signed SSO, self-scope, Unknown, filters/empty, paging, CSV, denial, IAM revocation, expiry, audit failure and stale-clear; ${requestId} HTTP reads`,
  );
  console.log(
    `PASS local PGlite metadata audit: ${audit.rows.length} events before deliberate DROP; NOT installed PostgreSQL/company SSO/provider E2E`,
  );
} finally {
  release?.();
  if (cdp) {
    await cdp.send('Browser.close').catch(() => {});
    cdp.close();
  }
  if (browser && browser.exitCode === null) {
    await Promise.race([once(browser, 'exit'), delay(5_000)]);
  }
  server.closeAllConnections();
  if (server.listening) await new Promise<void>((resolve) => server.close(() => resolve()));
  await db.close();
  // Do not touch any shared browser profile or desktop process.
  if (!browser || browser.exitCode !== null) await rm(profile, { recursive: true, force: true });
}
