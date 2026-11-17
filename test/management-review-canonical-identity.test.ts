import assert from 'node:assert/strict';
import test from 'node:test';
import * as legacyAudit from '../src/audit/gateway-event.ts';
import * as sharedAudit from '../src/shared/audit/event-projection.ts';
import { parseStoredUsageRecord as sharedUsage } from '../src/shared/usage/stored-row.ts';
import { parseStoredUsageRecord as legacyUsage } from '../src/usage/stored-record.ts';

test('legacy audit extraction uses canonical projection and exception identity', () => {
  assert.equal(legacyAudit.InvalidGatewayAuditEvent, sharedAudit.InvalidGatewayAuditEvent);
  assert.equal(legacyAudit.projectGatewayAuditEvent, sharedAudit.projectGatewayAuditEvent);
  assert.throws(
    () => legacyAudit.projectGatewayAuditEvent(null, 0),
    sharedAudit.InvalidGatewayAuditEvent,
  );
});

test('legacy stored usage extraction uses canonical validation identity', () => {
  assert.equal(legacyUsage, sharedUsage);
  assert.throws(() => legacyUsage(null));
});
