import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createCsvDownload } from '../src/management/csv-download.ts';

function fixture() {
  const blobs: Blob[] = [];
  const revoked: string[] = [];
  const anchors: {
    attributes: Map<string, string>;
    connected: boolean;
    clicks: number;
    setAttribute(name: string, value: string): void;
    click(): void;
    remove(): void;
  }[] = [];
  const callbacks: (() => void)[] = [];
  const cancelled: number[] = [];
  const ports = {
    document: {
      createElement(tag: 'a') {
        assert.equal(tag, 'a');
        const anchor = {
          attributes: new Map<string, string>(),
          connected: false,
          clicks: 0,
          setAttribute(name: string, value: string) {
            this.attributes.set(name, value);
          },
          click() {
            assert.equal(this.connected, true);
            this.clicks++;
          },
          remove() {
            this.connected = false;
          },
        };
        anchors.push(anchor);
        return anchor;
      },
      body: {
        append(anchor: { setAttribute(name: string, value: string): void }) {
          const found = anchors.find((a) => a === anchor);
          assert.ok(found);
          found.connected = true;
        },
      },
    },
    urls: {
      createObjectURL(blob: Blob) {
        blobs.push(blob);
        return `blob:fixture/${blobs.length}`;
      },
      revokeObjectURL(url: string) {
        revoked.push(url);
      },
    },
    deferCleanup(callback: () => void) {
      const index = callbacks.push(callback) - 1;
      return () => {
        cancelled.push(index);
      };
    },
  };
  return { ports, blobs, revoked, anchors, callbacks, cancelled };
}
for (const kind of ['usage', 'audit'] as const) {
  test(`${kind}: explicit download preserves UTF-8 bytes and fixed page filename`, async () => {
    const f = fixture();
    const download = createCsvDownload(f.ports);
    assert.equal(f.blobs.length, 0);
    const csv = 'model,note\r\n한글,"\'=SUM(1)"\r\n';
    assert.equal(download.save(kind, csv), 'started');
    assert.equal(f.blobs.length, 1);
    assert.equal(await f.blobs[0]?.text(), csv);
    assert.equal(f.blobs[0]?.type, 'text/csv;charset=utf-8');
    assert.equal(f.anchors[0]?.attributes.get('download'), `opengranter-${kind}-page.csv`);
    assert.equal(f.anchors[0]?.attributes.get('href'), 'blob:fixture/1');
    assert.equal(f.anchors[0]?.clicks, 1);
    assert.equal(f.anchors[0]?.connected, false);
    assert.deepEqual(f.revoked, []);
    f.callbacks[0]?.();
    f.callbacks[0]?.();
    assert.deepEqual(f.revoked, ['blob:fixture/1']);
    download.dispose();
    assert.equal(download.save(kind, csv), 'disposed');
  });
}
test('dispose cancels pending cleanups, revokes URLs and blocks retained save', () => {
  const f = fixture();
  const d = createCsvDownload(f.ports);
  const save = d.save;
  assert.equal(save('usage', ''), 'started');
  assert.equal(save('audit', 'x'), 'started');
  d.dispose();
  d.dispose();
  for (const callback of f.callbacks) callback();
  assert.deepEqual(f.revoked, ['blob:fixture/1', 'blob:fixture/2']);
  assert.deepEqual(f.cancelled, [0, 1]);
  assert.equal(save('usage', 'x'), 'disposed');
  assert.equal(f.blobs.length, 2);
});
test('invalid kind/data and UTF-8 overflow allocate no resources', () => {
  const f = fixture();
  const d = createCsvDownload(f.ports);
  for (const [kind, csv] of [
    ['../private', 'x'],
    ['usage', null],
    ['audit', '한'.repeat(700000)],
  ])
    assert.equal(d.save(kind, csv), 'invalid');
  assert.equal(f.blobs.length, 0);
  assert.equal(d.save('usage', 'x'.repeat(2 * 1024 * 1024)), 'started');
});
test('click failure removes anchor and URL without exposing raw error', () => {
  const f = fixture();
  const original = f.ports.document.createElement;
  f.ports.document.createElement = (tag) => {
    const a = original(tag);
    a.click = () => {
      throw new Error('PRIVATE CSV');
    };
    return a;
  };
  const d = createCsvDownload(f.ports);
  assert.equal(d.save('audit', 'sensitive'), 'unavailable');
  assert.deepEqual(f.revoked, ['blob:fixture/1']);
  assert.equal(f.anchors[0]?.connected, false);
});

for (const stage of ['url', 'create', 'append'] as const) {
  test(`reentrant dispose during ${stage} prevents click and removes late anchor`, () => {
    const f = fixture();
    const d = createCsvDownload(f.ports);
    if (stage === 'url') {
      const original = f.ports.urls.createObjectURL;
      f.ports.urls.createObjectURL = (blob) => {
        d.dispose();
        return original(blob);
      };
    } else if (stage === 'create') {
      const original = f.ports.document.createElement;
      f.ports.document.createElement = (tag) => {
        d.dispose();
        return original(tag);
      };
    } else {
      const original = f.ports.document.body.append;
      f.ports.document.body.append = (anchor) => {
        d.dispose();
        original(anchor);
      };
    }
    assert.equal(d.save('usage', 'private'), 'disposed');
    assert.equal(
      f.anchors.every((a) => a.clicks === 0 && !a.connected),
      true,
    );
    assert.deepEqual(f.revoked, ['blob:fixture/1']);
    assert.equal(f.callbacks.length, 0);
  });
}
test('synchronous deferred cleanup and throwing cancellation/revoke ports cannot break disposal', () => {
  const f = fixture();
  const d = createCsvDownload(f.ports);
  f.ports.deferCleanup = (callback) => {
    callback();
    return () => {
      throw new Error('private');
    };
  };
  assert.equal(d.save('audit', 'x'), 'started');
  assert.deepEqual(f.revoked, ['blob:fixture/1']);
  f.ports.urls.revokeObjectURL = () => {
    throw new Error('private');
  };
  assert.equal(d.save('usage', 'x'), 'started');
  assert.doesNotThrow(() => d.dispose());
  assert.equal(d.save('usage', 'x'), 'disposed');
});
for (const stage of ['url', 'create', 'append', 'schedule'] as const) {
  test(`throwing ${stage} is a safe unavailable result with cleanup`, () => {
    const f = fixture();
    const d = createCsvDownload(f.ports);
    const fail = (): never => {
      throw new Error('private bytes');
    };
    if (stage === 'url') f.ports.urls.createObjectURL = fail;
    else if (stage === 'create') f.ports.document.createElement = fail;
    else if (stage === 'append') f.ports.document.body.append = fail;
    else f.ports.deferCleanup = fail;
    assert.equal(d.save('usage', 'x'), 'unavailable');
    assert.deepEqual(f.revoked, stage === 'url' ? [] : ['blob:fixture/1']);
    assert.equal(
      f.anchors.every((a) => !a.connected),
      true,
    );
    d.dispose();
  });
}
