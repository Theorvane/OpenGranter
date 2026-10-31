import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { test } from 'node:test';

const read = (path: string) => readFile(new URL(`../${path}`, import.meta.url), 'utf8');

test('systemd directly owns non-root gateway with required external configuration', async () => {
  const unit = await read('deploy/systemd/opengranter.service');
  for (const line of [
    'Type=simple',
    'User=opengranter',
    'Group=opengranter',
    'WorkingDirectory=/opt/opengranter',
    'EnvironmentFile=/etc/opengranter/gateway.env',
    'ExecStart=/usr/bin/node --experimental-strip-types /opt/opengranter/scripts/start-gateway.ts',
  ])
    assert.ok(unit.split('\n').includes(line), line);
  assert.doesNotMatch(unit, /EnvironmentFile=-|ExecStart=.*(?:npm|sh -c)|DynamicUser=yes/u);
});

test('systemd keeps safe defaults, bounded stop and no automatic replay', async () => {
  const unit = await read('deploy/systemd/opengranter.service');
  for (const line of [
    'Environment=OPENGRANTER_BOOTSTRAP_MODULE=/etc/opengranter/bootstrap.mjs',
    'Environment=OPENGRANTER_HOST=127.0.0.1',
    'Environment=OPENGRANTER_PORT=8080',
    'Environment=OPENGRANTER_SHUTDOWN_MS=30000',
    'TimeoutStopSec=40s',
    'KillSignal=SIGTERM',
    'KillMode=control-group',
    'Restart=no',
  ])
    assert.ok(unit.split('\n').includes(line), line);
  assert.doesNotMatch(unit, /ExecStartPost=|ExecStop=|WatchdogSec=|OPENGRANTER_HOST=0.0.0.0/u);
});

test('systemd restricts privileges and writes without a Node-incompatible sandbox', async () => {
  const unit = await read('deploy/systemd/opengranter.service');
  for (const line of [
    'NoNewPrivileges=yes',
    'ProtectSystem=strict',
    'ProtectHome=yes',
    'PrivateTmp=yes',
    'PrivateDevices=yes',
    'CapabilityBoundingSet=',
    'AmbientCapabilities=',
    'RestrictSUIDSGID=yes',
    'UMask=0077',
  ])
    assert.ok(unit.split('\n').includes(line), line);
  assert.doesNotMatch(unit, /ReadWritePaths=|MemoryDenyWriteExecute=yes|PrivateNetwork=yes/u);
  const workflow = await read('.github/workflows/check.yml');
  assert.ok(workflow.includes('systemd-analyze verify deploy/systemd/opengranter.service'));
});
