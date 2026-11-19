import assert from 'node:assert/strict';
import test from 'node:test';
import type { CatalogElement } from '../src/management/catalog-view.ts';
import { mountHistoryWorkspace } from '../src/management/history-app.ts';
import type { AuditHistoryEvent } from '../src/shared/audit/history-types.ts';
import { buildUsageRecord } from '../src/usage/record-usage.ts';

class Element implements CatalogElement {
  textContent: string | null = null;
  value = '';
  children: Element[] = [];
  attributes: Record<string, string> = {};
  listeners: Record<string, () => void> = {};
  ownerDocument = { createElement: (tag: string) => new Element(tag) };
  readonly tag: string;
  constructor(tag = 'div') {
    this.tag = tag;
  }
  append(...nodes: Element[]) {
    this.children.push(...nodes);
  }
  replaceChildren(...nodes: Element[]) {
    this.children = nodes;
  }
  setAttribute(name: string, value: string) {
    this.attributes[name] = value;
  }
  addEventListener(type: string, listener: () => void) {
    this.listeners[type] = listener;
  }
  focus() {}
}
const nodes = (root: Element): Element[] => [root, ...root.children.flatMap(nodes)];
const text = (root: Element) =>
  nodes(root)
    .map((n) => n.textContent ?? '')
    .join(' ');
function click(root: Element, label: string) {
  const node = nodes(root).find((n) => n.tag === 'button' && n.textContent === label);
  assert.ok(node, label);
  node.listeners.click?.();
}
function input(root: Element, name: string, value: string) {
  const node = nodes(root).find((n) => n.attributes['aria-label'] === name);
  assert.ok(node, name);
  node.value = value;
}
const tick = () => new Promise((resolve) => setTimeout(resolve, 0));
function page(audit = false, more = false) {
  const row = audit
    ? {
        eventId: '1',
        occurredAt: 100,
        kind: 'models-listed',
        requestId: 'req',
        principalId: 'human',
        credentialId: 'cred',
        policyVersions: [],
        details: { count: 1, prompt: 'PRIVATE' },
      }
    : buildUsageRecord({
        principalId: 'human',
        credentialId: 'cred',
        policyVersions: [],
        requestId: 'req',
        attemptId: 'a',
        occurredAt: 100,
        modelAlias: '<script>chat</script>',
        routeKind: 'managed',
        upstreamModelId: 'upstream',
        selectedCandidateId: 'candidate',
        latencyMs: 1,
        outcome: 'succeeded',
        possiblyBilled: true,
        possibleDuplicate: true,
        estimatedCost: {
          amountDecimal: '9007199254740993.0000000001',
          currency: 'USD',
          priceVersion: 'v1',
        },
      });
  return Response.json({
    object: 'list',
    data: [row],
    has_more: more,
    next_cursor: more ? Buffer.from(JSON.stringify([100, 'a'])).toString('base64url') : null,
  });
}
function downloads() {
  const saved: [string, string][] = [];
  let disposed = 0;
  return {
    saved,
    get disposed() {
      return disposed;
    },
    save(kind: 'usage' | 'audit', csv: string) {
      saved.push([kind, csv]);
      return 'started' as const;
    },
    dispose() {
      disposed++;
    },
  };
}
test('history mount connects actual clients to filters, tabs and exact usage metadata', async () => {
  const root = new Element();
  const paths: string[] = [];
  const download = downloads();
  const app = mountHistoryWorkspace(
    root,
    async (path) => {
      paths.push(path);
      return page(path.includes('/audit?'));
    },
    download,
  );
  assert.match(text(root), /Loading/);
  await tick();
  assert.match(text(root), /9007199254740993.0000000001 USD/);
  assert.match(text(root), /Reported cost: Unknown/);
  assert.match(text(root), /Possible duplicate/);
  assert.match(text(root), /Usage: missing/);
  assert.equal(
    nodes(root).some((n) => n.tag === 'script'),
    false,
  );
  input(root, 'Principal', 'alice');
  input(root, 'Model', 'chat');
  input(root, 'From (Unix ms, inclusive)', '10');
  input(root, 'To (Unix ms, exclusive)', '20');
  click(root, 'Apply filters');
  await tick();
  const url = new URL(paths.at(-1) ?? '', 'https://local.invalid');
  assert.equal(url.searchParams.get('principal_id'), 'alice');
  assert.equal(url.searchParams.get('model'), 'chat');
  assert.equal(url.searchParams.get('from_ms'), '10');
  assert.equal(url.searchParams.get('to_ms'), '20');
  click(root, 'Audit');
  await tick();
  assert.match(text(root), /models-listed/);
  assert.equal(nodes(root).filter((n) => n.tag === 'details').length, 1);
  assert.match(text(root), /Event ID/);
  assert.match(text(root), /Credential ID/);
  assert.match(text(root), /count/);
  assert.doesNotMatch(text(root), /PRIVATE/);
  input(root, 'Request ID', 'req');
  click(root, 'Apply filters');
  await tick();
  assert.match(paths.at(-1) ?? '', /request_id=req/);
  app.dispose();
  assert.equal(root.children.length, 0);
  assert.equal(download.disposed, 1);
});
test('next/previous and one-page CSV use existing authorized boundaries', async () => {
  const root = new Element();
  const paths: string[] = [];
  const download = downloads();
  const app = mountHistoryWorkspace(
    root,
    async (path) => {
      paths.push(path);
      return path.includes('format=csv')
        ? new Response('header\nrow\n', {
            headers: { 'content-type': 'text/csv', 'x-has-more': 'false' },
          })
        : path.includes('cursor=')
          ? Response.json({ object: 'list', data: [], has_more: false, next_cursor: null })
          : page(false, true);
    },
    download,
  );
  await tick();
  click(root, 'Next page');
  await tick();
  assert.match(paths.at(-1) ?? '', /cursor=/);
  click(root, 'Previous page');
  await tick();
  assert.doesNotMatch(paths.at(-1) ?? '', /cursor=/);
  click(root, 'Download current page CSV');
  await tick();
  assert.deepEqual(download.saved, [['usage', 'header\nrow\n']]);
  app.dispose();
});
test('invalid time filters never issue a request; fresh search recovers', async () => {
  const root = new Element();
  let calls = 0;
  const app = mountHistoryWorkspace(
    root,
    async () => {
      calls++;
      return page();
    },
    downloads(),
  );
  await tick();
  input(root, 'From (Unix ms, inclusive)', '1e2');
  click(root, 'Apply filters');
  await tick();
  assert.equal(calls, 1);
  assert.match(text(root), /Invalid filters/);
  assert.equal(
    nodes(root).find((n) => n.attributes['aria-label'] === 'From (Unix ms, inclusive)')?.value,
    '1e2',
  );
  input(root, 'From (Unix ms, inclusive)', '10');
  click(root, 'Apply filters');
  await tick();
  assert.equal(calls, 2);
  app.dispose();
});
for (const status of [401, 403])
  test(`${status} clears rows, download leases and retained DOM controls`, async () => {
    const root = new Element();
    let calls = 0;
    let denied = false;
    const download = downloads();
    const app = mountHistoryWorkspace(
      root,
      async () => {
        calls++;
        return denied ? new Response('PRIVATE', { status }) : page();
      },
      download,
    );
    await tick();
    const stale = nodes(root).find((n) => n.textContent === 'Apply filters')?.listeners.click;
    denied = true;
    click(root, 'Audit');
    await tick();
    assert.match(text(root), status === 401 ? /Sign-in required/ : /Access denied/);
    assert.doesNotMatch(text(root), /9007199254740993|PRIVATE|chat/);
    stale?.();
    await tick();
    assert.equal(calls, 2);
    assert.equal(download.disposed, 1);
    app.dispose();
    assert.equal(download.disposed, 1);
  });
test('dispose before late CSV response prevents save and retained handlers', async () => {
  const root = new Element();
  const download = downloads();
  let finish!: (r: Response) => void;
  const pending = new Promise<Response>((resolve) => {
    finish = resolve;
  });
  let calls = 0;
  const app = mountHistoryWorkspace(
    root,
    async (path) => {
      calls++;
      return path.includes('format=csv') ? pending : page();
    },
    download,
  );
  await tick();
  const stale = nodes(root).find((n) => n.textContent === 'Audit')?.listeners.click;
  click(root, 'Download current page CSV');
  app.dispose();
  stale?.();
  finish(new Response('header\nrow\n', { headers: { 'content-type': 'text/csv' } }));
  await tick();
  assert.equal(calls, 2);
  assert.equal(download.saved.length, 0);
  assert.equal(root.children.length, 0);
});

test('empty, unavailable and retry are visible and native paging stays disabled', async () => {
  const root = new Element();
  let calls = 0;
  const app = mountHistoryWorkspace(
    root,
    async () => {
      calls++;
      return calls === 1
        ? new Response(null, { status: 503 })
        : Response.json({ object: 'list', data: [], has_more: false, next_cursor: null });
    },
    downloads(),
  );
  await tick();
  assert.match(text(root), /History unavailable/);
  click(root, 'Next page');
  await tick();
  assert.equal(calls, 1);
  click(root, 'Retry');
  await tick();
  assert.equal(calls, 2);
  assert.match(text(root), /No history matches/);
  app.dispose();
});
test('CSV failure remains recoverable without rendering private server diagnostics', async () => {
  const root = new Element();
  const download = downloads();
  const app = mountHistoryWorkspace(
    root,
    async (path) =>
      path.includes('format=csv') ? new Response('PRIVATE', { status: 503 }) : page(),
    download,
  );
  await tick();
  click(root, 'Download current page CSV');
  await tick();
  assert.match(text(root), /CSV unavailable/);
  assert.doesNotMatch(text(root), /PRIVATE/);
  assert.equal(download.saved.length, 0);
  assert.equal(download.disposed, 0);
  app.dispose();
});
test('denial during pending usage export revokes both tabs and cannot save late bytes', async () => {
  const root = new Element();
  const download = downloads();
  let finish!: (r: Response) => void;
  const pending = new Promise<Response>((resolve) => {
    finish = resolve;
  });
  const app = mountHistoryWorkspace(
    root,
    async (path) => {
      if (path.includes('/audit?')) return new Response(null, { status: 403 });
      return path.includes('format=csv') ? pending : page();
    },
    download,
  );
  await tick();
  click(root, 'Download current page CSV');
  click(root, 'Audit');
  await tick();
  finish(
    new Response('PRIVATE', { headers: { 'content-type': 'text/csv', 'x-has-more': 'false' } }),
  );
  await tick();
  assert.match(text(root), /Access denied/);
  assert.equal(download.saved.length, 0);
  assert.equal(download.disposed, 1);
  app.dispose();
});
test('retained handlers from a replaced screen cannot issue stale filter requests', async () => {
  const root = new Element();
  let calls = 0;
  const app = mountHistoryWorkspace(
    root,
    async (path) => {
      calls++;
      return page(path.includes('/audit?'));
    },
    downloads(),
  );
  await tick();
  const stale = nodes(root).find((n) => n.textContent === 'Apply filters')?.listeners.click;
  click(root, 'Audit');
  await tick();
  stale?.();
  await tick();
  assert.equal(calls, 2);
  app.dispose();
});

for (const failure of ['unavailable', 'invalid', 'disposed', 'throw'] as const)
  test(`browser CSV ${failure} is generic, tab-scoped and retryable`, async () => {
    const root = new Element();
    let attempts = 0;
    const app = mountHistoryWorkspace(
      root,
      async (path) =>
        path.includes('format=csv')
          ? new Response('header\nrow\n', {
              headers: { 'content-type': 'text/csv', 'x-has-more': 'false' },
            })
          : page(path.includes('/audit?')),
      {
        save() {
          if (++attempts > 1) return 'started' as const;
          if (failure === 'throw') throw new Error('PRIVATE browser diagnostic');
          return failure;
        },
        dispose() {},
      },
    );
    await tick();
    click(root, 'Download current page CSV');
    await tick();
    assert.match(text(root), /CSV unavailable/);
    assert.ok(
      nodes(root).some(
        (n) => n.attributes.role === 'alert' && n.textContent?.includes('CSV unavailable'),
      ),
    );
    assert.doesNotMatch(text(root), /PRIVATE|browser diagnostic/);
    click(root, 'Audit');
    await tick();
    assert.doesNotMatch(text(root), /CSV unavailable/);
    click(root, 'Usage');
    assert.match(text(root), /CSV unavailable/);
    await tick();
    click(root, 'Download current page CSV');
    assert.doesNotMatch(text(root), /CSV unavailable/);
    await tick();
    assert.equal(attempts, 2);
    assert.doesNotMatch(text(root), /CSV unavailable/);
    app.dispose();
  });

test('reentrant download disposal cannot restore private DOM or error', async () => {
  const root = new Element();
  const app = mountHistoryWorkspace(
    root,
    async (path) =>
      path.includes('format=csv')
        ? new Response('header\nrow\n', {
            headers: { 'content-type': 'text/csv', 'x-has-more': 'false' },
          })
        : page(),
    {
      save() {
        app.dispose();
        throw new Error('PRIVATE');
      },
      dispose() {},
    },
  );
  await tick();
  click(root, 'Download current page CSV');
  await tick();
  assert.equal(root.children.length, 0);
});

test('audit details expose projected metadata only, with policy versions and no second fetch', async () => {
  const root = new Element();
  let calls = 0;
  const app = mountHistoryWorkspace(
    root,
    async (path) => {
      calls++;
      if (!path.includes('/audit?')) return page();
      const response = (await page(true).json()) as {
        data: {
          policyVersions: { id: string; version: string }[];
          details: Record<string, unknown>;
        }[];
      };
      const row = response.data[0] as {
        policyVersions: { id: string; version: string }[];
        details: Record<string, unknown>;
      };
      row.policyVersions = [{ id: 'policy-a', version: 'v3' }];
      row.details.authorization = 'PRIVATE-BEARER';
      return Response.json(response);
    },
    downloads(),
  );
  await tick();
  click(root, 'Audit');
  await tick();
  const detail = nodes(root).find((n) => n.tag === 'details');
  assert.ok(detail);
  assert.equal(detail.attributes.open, undefined);
  assert.match(text(detail), /Event ID.*1/);
  assert.match(text(detail), /policy-a.*v3/);
  assert.match(text(detail), /"count": 1/);
  assert.doesNotMatch(text(detail), /PRIVATE|prompt|authorization/);
  assert.equal(calls, 2);
  click(root, 'Usage');
  assert.equal(nodes(root).filter((n) => n.tag === 'details').length, 0);
  click(root, 'Audit');
  assert.doesNotMatch(text(root), /policy-a/);
  await tick();
  assert.match(text(root), /policy-a/);
  app.dispose();
  assert.equal(root.children.length, 0);
});

for (const status of [401, 403, 503])
  test(`audit details clear immediately on filter reload and remain absent after ${status}`, async () => {
    const root = new Element();
    let fail = false;
    const app = mountHistoryWorkspace(
      root,
      async (path) => (fail ? new Response(null, { status }) : page(path.includes('/audit?'))),
      downloads(),
    );
    await tick();
    click(root, 'Audit');
    await tick();
    assert.equal(nodes(root).filter((n) => n.tag === 'details').length, 1);
    assert.match(text(root), /No policy versions recorded/);
    const old = nodes(root).find((n) => n.textContent === 'Apply filters')?.listeners.click;
    fail = true;
    click(root, 'Apply filters');
    assert.equal(nodes(root).filter((n) => n.tag === 'details').length, 0);
    await tick();
    assert.doesNotMatch(text(root), /Event ID|Credential ID|models-listed/);
    app.dispose();
    old?.();
    await tick();
    assert.equal(root.children.length, 0);
  });

test('standalone audit renderer never stringifies raw or unsupported metadata', async () => {
  const { renderAuditRecord } = await import('../src/management/audit-record-view.ts');
  const root = new Element();
  const valid = ((await page(true).json()) as { data: AuditHistoryEvent[] }).data[0];
  assert.ok(valid);
  for (const row of [
    { ...valid, eventId: '<script>PRIVATE</script>' },
    { ...valid, kind: 'unknown', details: { token: 'PRIVATE' } },
    { ...valid, details: { count: -1, prompt: 'PRIVATE' } },
  ]) {
    const item = renderAuditRecord(root, row) as Element;
    assert.match(text(item), /Audit record unavailable/);
    assert.doesNotMatch(text(item), /PRIVATE|script|token/);
    assert.equal(
      nodes(item).some((n) => n.tag === 'script'),
      false,
    );
  }
});

for (const status of [401, 403]) {
  test(`tab return immediately clears stale rows and rechecks authority ${status}`, async () => {
    const root = new Element();
    const paths: string[] = [];
    let finish!: (response: Response) => void;
    let revoke = false;
    const download = downloads();
    const app = mountHistoryWorkspace(
      root,
      async (path) => {
        paths.push(path);
        if (revoke)
          return new Promise<Response>((resolve) => {
            finish = resolve;
          });
        return page(path.includes('/audit?'));
      },
      download,
    );
    await tick();
    click(root, 'Audit');
    await tick();
    assert.match(text(root), /Event ID/);
    click(root, 'Usage');
    await tick();
    revoke = true;
    const before = paths.length;
    click(root, 'Audit');
    assert.equal(paths.length, before + 1);
    assert.match(text(root), /Loading history/);
    assert.doesNotMatch(text(root), /Event ID|Credential ID|models-listed/);
    finish(new Response(null, { status }));
    await tick();
    assert.match(text(root), status === 401 ? /Sign-in required/ : /Access denied/);
    assert.doesNotMatch(text(root), /Usage and audit history|human|Download/);
    assert.equal(download.disposed, 1);
    app.dispose();
  });
}

test('explicit refresh preserves the current page and applied filters, not drafts', async () => {
  const root = new Element();
  const paths: string[] = [];
  let finish!: (response: Response) => void;
  let pause = false;
  const app = mountHistoryWorkspace(
    root,
    async (path) => {
      paths.push(path);
      if (pause)
        return new Promise<Response>((resolve) => {
          finish = resolve;
        });
      if (new URL(path, 'https://local.invalid').searchParams.has('cursor'))
        return Response.json({ object: 'list', data: [], has_more: false, next_cursor: null });
      return page(false, true);
    },
    downloads(),
  );
  await tick();
  input(root, 'Principal', 'human');
  click(root, 'Apply filters');
  await tick();
  click(root, 'Next page');
  await tick();
  const applied = paths.at(-1);
  input(root, 'Principal', 'unsubmitted');
  pause = true;
  click(root, 'Refresh current page');
  assert.equal(paths.at(-1), applied);
  assert.match(applied ?? '', /principal_id=human/);
  assert.match(applied ?? '', /cursor=/);
  assert.match(text(root), /Loading history/);
  assert.doesNotMatch(text(root), /Possible duplicate/);
  const count = paths.length;
  click(root, 'Refresh current page');
  assert.equal(paths.length, count);
  finish(Response.json({ object: 'list', data: [], has_more: false, next_cursor: null }));
  await tick();
  assert.match(text(root), /No history matches/);
  app.dispose();
});

test('usage row request drilldown reloads exact principal intersection and retains bounds for CSV', async () => {
  const root = new Element();
  const paths: string[] = [];
  const download = downloads();
  const app = mountHistoryWorkspace(
    root,
    async (path) => {
      paths.push(path);
      if (path.includes('format=csv'))
        return new Response('request_id\r\nreq\r\n', {
          headers: { 'content-type': 'text/csv', 'x-has-more': 'false' },
        });
      return page();
    },
    download,
  );
  await tick();
  input(root, 'Model', '<script>chat</script>');
  input(root, 'From (Unix ms, inclusive)', '0');
  input(root, 'To (Unix ms, exclusive)', '200');
  click(root, 'Apply filters');
  await tick();
  const stale = nodes(root).find((n) => n.textContent === 'View attempts for this request');
  click(root, 'View attempts for this request');
  assert.match(text(root), /Loading history/);
  assert.doesNotMatch(text(root), /Possibly billed/);
  await tick();
  const q = new URL(paths.at(-1) ?? '', 'https://local.invalid').searchParams;
  assert.equal(q.get('principal_id'), null);
  assert.equal(q.get('request_id'), 'req');
  assert.equal(q.get('model'), '<script>chat</script>');
  assert.equal(q.get('from_ms'), '0');
  assert.equal(q.get('to_ms'), '200');
  assert.equal(q.has('cursor'), false);
  click(root, 'Download current page CSV');
  await tick();
  assert.equal(
    new URL(paths.at(-1) ?? '', 'https://local.invalid').searchParams.get('request_id'),
    'req',
  );
  assert.equal(download.saved.length, 1);
  app.dispose();
  const count = paths.length;
  stale?.listeners.click?.();
  await tick();
  assert.equal(paths.length, count);
  assert.equal(text(root), '');
});
test('manual usage request filter has empty, invalid and unavailable states without stale rows', async () => {
  const root = new Element();
  const paths: string[] = [];
  const app = mountHistoryWorkspace(
    root,
    async (path) => {
      paths.push(path);
      const id = new URL(path, 'https://local.invalid').searchParams.get('request_id');
      return id === 'absent'
        ? Response.json({ object: 'list', data: [], has_more: false, next_cursor: null })
        : id === 'failed'
          ? new Response('PRIVATE', { status: 503 })
          : page();
    },
    downloads(),
  );
  await tick();
  input(root, 'Request ID', 'absent');
  click(root, 'Apply filters');
  await tick();
  assert.match(text(root), /No history matches/);
  input(root, 'Request ID', 'bad&value');
  click(root, 'Apply filters');
  await tick();
  assert.match(text(root), /Invalid filters/);
  assert.equal(paths.length, 2);
  input(root, 'Request ID', 'failed');
  click(root, 'Apply filters');
  await tick();
  assert.match(text(root), /History unavailable/);
  assert.doesNotMatch(text(root), /PRIVATE|Possibly billed/);
  app.dispose();
});

test('returning to a pending tab coalesces its read and active-tab clicks do not refresh', async () => {
  const root = new Element();
  const paths: string[] = [];
  let finish!: (response: Response) => void;
  const app = mountHistoryWorkspace(
    root,
    async (path) => {
      paths.push(path);
      if (path.includes('/audit?'))
        return new Promise<Response>((resolve) => {
          finish = resolve;
        });
      return page();
    },
    downloads(),
  );
  try {
    await tick();
    click(root, 'Usage');
    assert.equal(paths.length, 1);
    click(root, 'Audit');
    assert.match(text(root), /Loading history/);
    const refresh = nodes(root).find((node) => node.textContent === 'Refresh current page');
    assert.ok(refresh);
    assert.equal(refresh.attributes.disabled, '');
    click(root, 'Usage');
    await tick();
    click(root, 'Audit');
    assert.match(text(root), /Loading history/);
    assert.equal(paths.filter((path) => path.includes('/audit?')).length, 1);
    click(root, 'Audit');
    assert.equal(paths.filter((path) => path.includes('/audit?')).length, 1);
    finish(page(true));
    await tick();
    assert.match(text(root), /Event ID/);
    const count = paths.length;
    click(root, 'Audit');
    assert.equal(paths.length, count);
  } finally {
    app.dispose();
  }
});
