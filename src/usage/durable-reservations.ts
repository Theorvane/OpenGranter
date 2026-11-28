import { randomUUID } from 'node:crypto';
import { type AuditAttribution, validAuditAttribution } from '../audit/attribution.ts';
import { createPostgresGatewayAuditStore } from '../audit/postgres-gateway-audit.ts';
import type { ReservationAuditEvent } from '../audit/reservation-event.ts';
import { evaluate, type Statement } from '../policy/evaluate.ts';
import type { MigrationConnection, MigrationTransaction } from '../storage/postgres-migrations.ts';
import { createPostgresUsageLedger } from './postgres-ledger.ts';
import { buildUsageRecord, type UsageRecord } from './record-usage.ts';
import { parseStoredUsageRecord } from './stored-record.ts';

export interface LiabilityCandidate {
  readonly id: string;
  readonly providerId: string;
  readonly transportProviderId: string;
  readonly upstreamModelId: string;
  readonly liability: string;
  readonly currency: string;
  readonly attestationId: string;
  readonly validUntil: number;
}
/** Trusted server composition only: not an HTTP caller's policy or ceiling. */
export interface ReservationInput extends AuditAttribution {
  readonly requestId: string;
  readonly principalActive: boolean;
  readonly statements: readonly Statement[];
  readonly modelAlias: string;
  readonly routeVersion: string;
  readonly requestBinding: string;
  readonly candidates: readonly LiabilityCandidate[];
  readonly expiresAt: number;
}
interface Binding extends AuditAttribution {
  readonly requestId: string;
  readonly modelAlias: string;
  readonly routeVersion: string;
  readonly requestBinding: string;
  readonly candidates: readonly LiabilityCandidate[];
  readonly expiresAt: number;
}
export interface ReservationHandle {
  readonly requestId: string;
  readonly principalId: string;
  readonly ownerToken: string;
}
export interface SettlementEvidence {
  readonly attemptId: string;
  readonly amount: string;
  readonly currency: string;
  readonly authority: string;
}
export class ReservationFailure extends Error {
  constructor() {
    super('Reservation operation unavailable or conflicts');
    this.name = 'ReservationFailure';
  }
}
function object(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new ReservationFailure();
  return value as Record<string, unknown>;
}
function id(value: unknown): string {
  if (
    typeof value !== 'string' ||
    value.length > 256 ||
    !/^[A-Za-z0-9][A-Za-z0-9._+:/@-]*$/u.test(value)
  )
    throw new ReservationFailure();
  return value;
}
function integer(value: unknown): number {
  const number =
    typeof value === 'string' && /^(?:0|[1-9][0-9]*)$/u.test(value) ? Number(value) : value;
  if (typeof number !== 'number' || !Number.isSafeInteger(number) || number < 0)
    throw new ReservationFailure();
  return number;
}
function currency(value: unknown): string {
  if (typeof value !== 'string' || !/^[A-Z]{3}$/u.test(value)) throw new ReservationFailure();
  return value;
}
/** Fixed internal scale, exact arithmetic; never a pricing or conversion rule. */
function money(value: unknown): bigint {
  if (
    typeof value !== 'string' ||
    value.length > 256 ||
    !/^(?:0|[1-9][0-9]*)(?:\.[0-9]{1,64})?$/u.test(value)
  )
    throw new ReservationFailure();
  const [whole, fraction = ''] = value.split('.');
  return BigInt(`${whole}${fraction.padEnd(64, '0')}`);
}
function candidate(value: unknown): LiabilityCandidate {
  const item = object(value);
  const amount = item.liability;
  money(amount);
  if (typeof amount !== 'string' || amount.length > 128) throw new ReservationFailure();
  return {
    id: id(item.id),
    providerId: id(item.providerId),
    transportProviderId: id(item.transportProviderId),
    upstreamModelId: id(item.upstreamModelId),
    liability: amount,
    currency: currency(item.currency),
    attestationId: id(item.attestationId),
    validUntil: integer(item.validUntil),
  };
}
function binding(value: unknown): Binding {
  const input = object(value);
  if (
    !validAuditAttribution(input) ||
    !Array.isArray(input.candidates) ||
    input.candidates.length < 1 ||
    input.candidates.length > 1024
  )
    throw new ReservationFailure();
  const candidates = Array.from(input.candidates, candidate).sort((a, b) =>
    a.id < b.id ? -1 : a.id > b.id ? 1 : 0,
  );
  if (new Set(candidates.map((c) => c.id)).size !== candidates.length)
    throw new ReservationFailure();
  return {
    requestId: id(input.requestId),
    principalId: id(input.principalId),
    credentialId: id(input.credentialId),
    policyVersions: input.policyVersions.map((p) => ({ id: id(p.id), version: id(p.version) })),
    modelAlias: id(input.modelAlias),
    routeVersion: id(input.routeVersion),
    requestBinding: id(input.requestBinding),
    candidates,
    expiresAt: integer(input.expiresAt),
  };
}
interface SavedReservation {
  readonly data: Binding;
  readonly owner: string | null;
  readonly window: number;
}

/** Empty until explicitly provisioned; no provider, secret, HTTP or Jev port exists. */
export function createDurableReservations(ports: {
  readonly connection: MigrationConnection;
  readonly now: () => number;
  readonly resolveEvidence: (evidenceId: string) => Promise<SettlementEvidence | undefined>;
}) {
  async function transact<T>(work: (tx: MigrationTransaction) => Promise<T>): Promise<T> {
    try {
      return await ports.connection.transaction(work);
    } catch {
      throw new ReservationFailure();
    }
  }
  async function lock(tx: MigrationTransaction, principalId: string) {
    const result = await tx.query(
      `SELECT version, currency, window_ms::text, request_limit::text,
      budget::text, valid_until_ms::text, blocked FROM reservation_principals WHERE principal_id=$1 FOR UPDATE`,
      [principalId],
    );
    return result.rows.length === 0 ? undefined : object(result.rows[0]);
  }
  async function load(
    tx: MigrationTransaction,
    requestId: string,
    principalId: string,
  ): Promise<SavedReservation> {
    const result = await tx.query(
      'SELECT binding, owner_token, window_start_ms::text, expires_at_ms::text FROM routing_reservations WHERE request_id=$1 AND principal_id=$2',
      [requestId, principalId],
    );
    const row = object(result.rows[0]);
    if (row.owner_token !== null) id(row.owner_token);
    const data = binding(row.binding);
    if (
      data.requestId !== requestId ||
      data.principalId !== principalId ||
      data.expiresAt !== integer(row.expires_at_ms)
    )
      throw new ReservationFailure();
    return {
      data,
      owner: row.owner_token as string | null,
      window: integer(row.window_start_ms),
    };
  }
  async function audit(
    tx: MigrationTransaction,
    data: Binding,
    action: ReservationAuditEvent['action'],
    now: number,
    attemptId?: string,
    evidenceId?: string,
  ) {
    await createPostgresGatewayAuditStore(tx, () => now).append({
      kind: 'reservation',
      requestId: data.requestId,
      principalId: data.principalId,
      credentialId: data.credentialId,
      policyVersions: data.policyVersions,
      modelAlias: data.modelAlias,
      action,
      ...(attemptId === undefined ? {} : { attemptId }),
      ...(evidenceId === undefined ? {} : { evidenceId }),
    });
  }
  async function owned(tx: MigrationTransaction, handle: ReservationHandle) {
    if (!(await lock(tx, id(handle.principalId)))) throw new ReservationFailure();
    const saved = await load(tx, id(handle.requestId), handle.principalId);
    const now = integer(ports.now());
    if (saved.owner !== id(handle.ownerToken) || now >= saved.data.expiresAt)
      throw new ReservationFailure();
    return { ...saved, now };
  }
  async function close(
    tx: MigrationTransaction,
    saved: SavedReservation,
    now: number,
    action: 'completed' | 'expired',
  ) {
    await tx.query('UPDATE routing_reservations SET owner_token=NULL WHERE request_id=$1', [
      saved.data.requestId,
    ]);
    await tx.query(
      'UPDATE routing_reservation_attempts SET debit=0 WHERE request_id=$1 AND attempt_id IS NULL AND debit IS NULL',
      [saved.data.requestId],
    );
    await audit(tx, saved.data, action, now);
  }
  return {
    async reserve(
      input: ReservationInput,
    ): Promise<
      | { readonly status: 'denied' | 'existing' }
      | { readonly status: 'admitted'; readonly handle: ReservationHandle }
    > {
      // Capture before the first await. Statements are evaluated now, never retained as mutable authority.
      const data = binding(input);
      const permitted = (action: string, resource: string) =>
        evaluate({
          principalActive: input.principalActive,
          statements: input.statements,
          action,
          resource,
        }).effect === 'Allow';
      const authorized =
        permitted('llm:InvokeModel', `model:${data.modelAlias}`) &&
        data.candidates.every(
          (c) =>
            permitted('llm:UseProvider', `provider:${c.providerId}`) &&
            permitted('llm:UseProvider', `provider:${c.transportProviderId}`),
        );
      return transact(async (tx) => {
        const policy = await lock(tx, data.principalId);
        const now = integer(ports.now());
        const deny = async () => {
          await audit(tx, data, 'denied', now);
          return { status: 'denied' as const };
        };
        if (!authorized || !policy) return deny();
        money(policy.budget);
        const snapshot = {
          version: id(policy.version),
          currency: currency(policy.currency),
          windowMs: integer(policy.window_ms),
          requestLimit: integer(policy.request_limit),
          budget: policy.budget,
          validUntil: integer(policy.valid_until_ms),
        };
        const previous = await tx.query(
          'SELECT binding,policy_version,policy_snapshot FROM routing_reservations WHERE request_id=$1',
          [data.requestId],
        );
        if (previous.rows.length) {
          const original = binding(object(previous.rows[0]).binding);
          if (
            JSON.stringify(original) !== JSON.stringify(data) ||
            object(previous.rows[0]).policy_version !== policy.version ||
            !Object.entries(snapshot).every(
              ([key, value]) => object(object(previous.rows[0]).policy_snapshot)[key] === value,
            )
          )
            throw new ReservationFailure();
          return { status: 'existing' as const };
        }
        const accounted = await tx.query(
          'SELECT attempt_id FROM usage_records WHERE request_id=$1 LIMIT 1',
          [data.requestId],
        );
        if (accounted.rows.length) return deny();
        const windowMs = integer(policy.window_ms);
        const unit = currency(policy.currency);
        id(policy.version);
        if (
          windowMs === 0 ||
          policy.blocked !== false ||
          now >= integer(policy.valid_until_ms) ||
          data.expiresAt <= now ||
          data.expiresAt > integer(policy.valid_until_ms) ||
          data.candidates.some((c) => c.currency !== unit || c.validUntil < data.expiresAt)
        )
          return deny();
        const window = Math.floor(now / windowMs) * windowMs;
        const layout = await tx.query(
          'SELECT currency, window_ms::text FROM routing_reservations WHERE principal_id=$1 LIMIT 1',
          [data.principalId],
        );
        if (
          layout.rows.length &&
          (object(layout.rows[0]).currency !== unit ||
            integer(object(layout.rows[0]).window_ms) !== windowMs)
        )
          return deny();
        const count = await tx.query(
          'SELECT count(*)::text AS count FROM routing_reservations WHERE principal_id=$1 AND window_start_ms=$2',
          [data.principalId, window],
        );
        const exposure = await tx.query(
          `SELECT COALESCE(sum(CASE WHEN a.debit IS NULL THEN a.liability WHEN r.window_start_ms=$2 THEN a.debit ELSE 0 END),0)::text AS amount
          FROM routing_reservation_attempts a JOIN routing_reservations r USING(request_id) WHERE r.principal_id=$1`,
          [data.principalId, window],
        );
        const required = data.candidates.reduce((sum, c) => sum + money(c.liability), 0n);
        if (
          integer(object(count.rows[0]).count) >= integer(policy.request_limit) ||
          money(object(exposure.rows[0]).amount) + required > money(policy.budget)
        )
          return deny();
        const token = randomUUID();
        await tx.query(
          `INSERT INTO routing_reservations(request_id,principal_id,window_start_ms,currency,window_ms,expires_at_ms,owner_token,binding,policy_version,policy_snapshot)
          VALUES($1,$2,$3,$4,$5,$6,$7,$8::jsonb,$9,$10::jsonb)`,
          [
            data.requestId,
            data.principalId,
            window,
            unit,
            windowMs,
            data.expiresAt,
            token,
            JSON.stringify(data),
            policy.version,
            JSON.stringify(snapshot),
          ],
        );
        for (const c of data.candidates)
          await tx.query(
            'INSERT INTO routing_reservation_attempts(request_id,candidate_id,liability) VALUES($1,$2,$3)',
            [data.requestId, c.id, c.liability],
          );
        await audit(tx, data, 'admitted', now);
        return {
          status: 'admitted' as const,
          handle: { requestId: data.requestId, principalId: data.principalId, ownerToken: token },
        };
      });
    },
    async start(handle: ReservationHandle, candidateId: string): Promise<string> {
      const captured = {
        requestId: id(handle.requestId),
        principalId: id(handle.principalId),
        ownerToken: id(handle.ownerToken),
      };
      const selected = id(candidateId);
      return transact(async (tx) => {
        const saved = await owned(tx, captured);
        const now = saved.now;
        const state = await tx.query(
          'SELECT candidate_id,attempt_id,handed_off,allow_fallback FROM routing_reservation_attempts WHERE request_id=$1',
          [captured.requestId],
        );
        const rows = state.rows.map(object);
        const slot = rows.find((r) => r.candidate_id === selected);
        if (
          !slot ||
          slot.attempt_id !== null ||
          rows.some(
            (r) => r.attempt_id !== null && (r.handed_off !== true || r.allow_fallback !== true),
          )
        )
          throw new ReservationFailure();
        const attemptId = `${captured.requestId}/managed/${rows.filter((r) => r.attempt_id !== null).length + 1}`;
        await tx.query(
          'UPDATE routing_reservation_attempts SET attempt_id=$3,started_at_ms=$4 WHERE request_id=$1 AND candidate_id=$2',
          [captured.requestId, selected, attemptId, now],
        );
        await audit(tx, saved.data, 'intent', now, attemptId);
        return attemptId;
      });
    },
    async handoff(
      principalId: string,
      requestId: string,
      usage: UsageRecord,
      retryableBeforeResponse = false,
    ): Promise<void> {
      const principal = id(principalId),
        request = id(requestId);
      const record = parseStoredUsageRecord(usage);
      if (
        typeof retryableBeforeResponse !== 'boolean' ||
        (retryableBeforeResponse && record.outcome !== 'failed')
      )
        throw new ReservationFailure();
      return transact(async (tx) => {
        if (!(await lock(tx, principal))) throw new ReservationFailure();
        const now = integer(ports.now());
        const saved = await load(tx, request, principal);
        const c = saved.data.candidates.find((c) => c.id === record.selectedCandidateId);
        const result = await tx.query(
          'SELECT handed_off,allow_fallback FROM routing_reservation_attempts WHERE request_id=$1 AND attempt_id=$2 AND candidate_id=$3',
          [request, record.attemptId, record.selectedCandidateId],
        );
        const state = object(result.rows[0]);
        if (
          !c ||
          record.requestId !== request ||
          record.principalId !== principal ||
          record.credentialId !== saved.data.credentialId ||
          record.modelAlias !== saved.data.modelAlias ||
          record.routeKind !== 'managed' ||
          record.upstreamModelId !== c.upstreamModelId ||
          record.actualInferenceProviderId !== c.providerId ||
          JSON.stringify(record.policyVersions) !== JSON.stringify(saved.data.policyVersions)
        )
          throw new ReservationFailure();
        if (state.handed_off !== true) {
          const previous = await tx.query(
            'SELECT record FROM usage_records WHERE request_id=$1 AND attempt_id <> $2',
            [request, record.attemptId],
          );
          const possibleDuplicate = previous.rows.some(
            (row) => parseStoredUsageRecord(object(row).record).possiblyBilled,
          );
          if (record.possibleDuplicate !== possibleDuplicate) throw new ReservationFailure();
        }
        await createPostgresUsageLedger(tx)(record);
        if (state.handed_off === true) {
          if (state.allow_fallback !== retryableBeforeResponse) throw new ReservationFailure();
          return;
        }
        await tx.query(
          'UPDATE routing_reservation_attempts SET handed_off=true,allow_fallback=$2 WHERE attempt_id=$1',
          [record.attemptId, retryableBeforeResponse],
        );
        await audit(tx, saved.data, 'handoff', now, record.attemptId);
      });
    },
    async complete(handle: ReservationHandle): Promise<void> {
      const captured = {
        requestId: id(handle.requestId),
        principalId: id(handle.principalId),
        ownerToken: id(handle.ownerToken),
      };
      return transact(async (tx) => {
        if (!(await lock(tx, captured.principalId))) throw new ReservationFailure();
        const now = integer(ports.now());
        const saved = await load(tx, captured.requestId, captured.principalId);
        if (saved.owner === null) return;
        if (saved.owner !== captured.ownerToken) throw new ReservationFailure();
        await close(tx, saved, now, now >= saved.data.expiresAt ? 'expired' : 'completed');
      });
    },
    async recover(principalId: string): Promise<readonly string[]> {
      const principal = id(principalId);
      return transact(async (tx) => {
        if (!(await lock(tx, principal))) throw new ReservationFailure();
        const now = integer(ports.now());
        const expired = await tx.query(
          'SELECT request_id FROM routing_reservations WHERE principal_id=$1 AND expires_at_ms <= $2 AND owner_token IS NOT NULL',
          [principal, now],
        );
        for (const row of expired.rows)
          await close(tx, await load(tx, id(object(row).request_id), principal), now, 'expired');
        const pending = await tx.query(
          `SELECT a.attempt_id FROM routing_reservation_attempts a JOIN routing_reservations r USING(request_id)
          WHERE r.principal_id=$1 AND a.attempt_id IS NOT NULL AND a.debit IS NULL ORDER BY a.attempt_id`,
          [principal],
        );
        return pending.rows.map((row) => id(object(row).attempt_id));
      });
    },
    async reconcile(
      principalId: string,
      requestId: string,
      attemptId: string,
      evidenceId: string,
    ): Promise<void> {
      const principal = id(principalId),
        request = id(requestId),
        attempt = id(attemptId),
        evidenceKey = id(evidenceId);
      // Trusted resolver must attest final authoritative liability for this exact attempt.
      let evidence: SettlementEvidence;
      try {
        const result = await ports.resolveEvidence(evidenceKey);
        if (!result) throw new ReservationFailure();
        evidence = {
          attemptId: id(result.attemptId),
          amount: result.amount,
          currency: currency(result.currency),
          authority: id(result.authority),
        };
        money(evidence.amount);
      } catch {
        throw new ReservationFailure();
      }
      if (evidence.attemptId !== attempt) throw new ReservationFailure();
      return transact(async (tx) => {
        const policy = await lock(tx, principal);
        if (!policy) throw new ReservationFailure();
        const now = integer(ports.now());
        const saved = await load(tx, request, principal);
        const result = await tx.query(
          'SELECT candidate_id,started_at_ms::text,liability::text,handed_off,evidence FROM routing_reservation_attempts WHERE request_id=$1 AND attempt_id=$2',
          [request, attempt],
        );
        const slot = object(result.rows[0]);
        const settlement = { evidenceId: evidenceKey, ...evidence };
        if (evidence.currency !== saved.data.candidates[0]?.currency)
          throw new ReservationFailure();
        if (slot.evidence !== null) {
          // jsonb key ordering is not an identity contract.
          const old = object(slot.evidence);
          if (
            !Object.entries(settlement).every(([key, value]) => old[key] === value) ||
            Object.keys(old).length !== Object.keys(settlement).length
          )
            throw new ReservationFailure();
          return;
        }
        if (slot.handed_off !== true) {
          // Only a fenced execution can be recovered without its original handoff.
          if (saved.owner !== null) throw new ReservationFailure();
          const selected = saved.data.candidates.find((c) => c.id === slot.candidate_id);
          if (!selected) throw new ReservationFailure();
          const previous = await tx.query(
            'SELECT record FROM usage_records WHERE request_id=$1 AND attempt_id <> $2',
            [request, attempt],
          );
          const recovered = buildUsageRecord({
            requestId: request,
            attemptId: attempt,
            principalId: principal,
            credentialId: saved.data.credentialId,
            policyVersions: saved.data.policyVersions,
            modelAlias: saved.data.modelAlias,
            routeKind: 'managed',
            upstreamModelId: selected.upstreamModelId,
            selectedCandidateId: selected.id,
            occurredAt: integer(slot.started_at_ms),
            latencyMs: null,
            outcome: 'unknown',
            possiblyBilled: true,
            possibleDuplicate: previous.rows.some(
              (row) => parseStoredUsageRecord(object(row).record).possiblyBilled,
            ),
          });
          await createPostgresUsageLedger(tx)(recovered);
          await tx.query(
            'UPDATE routing_reservation_attempts SET handed_off=true,allow_fallback=false WHERE attempt_id=$1',
            [attempt],
          );
          await audit(tx, saved.data, 'handoff', now, attempt);
        }
        await tx.query(
          'UPDATE routing_reservation_attempts SET debit=$2,evidence=$3::jsonb WHERE attempt_id=$1',
          [attempt, evidence.amount, JSON.stringify(settlement)],
        );
        const overrun = money(evidence.amount) > money(slot.liability);
        if (overrun)
          await tx.query('UPDATE reservation_principals SET blocked=true WHERE principal_id=$1', [
            principal,
          ]);
        await audit(tx, saved.data, overrun ? 'overrun' : 'reconciled', now, attempt, evidenceKey);
      });
    },
  };
}
