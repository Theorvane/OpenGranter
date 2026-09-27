import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';
import type { CredentialIdentity } from './attachment-authenticator.ts';

const TOKEN_FORMAT = /^og1_([A-Za-z0-9_-]{22})_([A-Za-z0-9_-]{43})$/u;
const DIGEST_FORMAT = /^[a-f0-9]{64}$/u;

export interface StoredProxyCredential {
  readonly credentialId: string;
  readonly principalId: string;
  readonly tokenDigest: string;
  readonly expiresAt: number;
  readonly revokedAt: number | null;
}

export interface ProxyCredentialStore {
  readonly insertIssued: (input: {
    readonly credentialId: string;
    readonly principalId: string;
    readonly tokenDigest: string;
    readonly createdAt: number;
    readonly expiresAt: number;
    readonly actorId: string;
    readonly requestId: string;
  }) => Promise<void>;
  readonly findById: (credentialId: string) => Promise<StoredProxyCredential | undefined>;
  readonly revoke: (input: {
    readonly credentialId: string;
    readonly actorId: string;
    readonly requestId: string;
    readonly revokedAt: number;
  }) => Promise<boolean>;
}

export class InvalidProxyCredentialInput extends Error {
  constructor() {
    super('Invalid proxy credential input');
    this.name = 'InvalidProxyCredentialInput';
  }
}

export class ProxyCredentialUnavailable extends Error {
  constructor() {
    super('Proxy credential store unavailable');
    this.name = 'ProxyCredentialUnavailable';
  }
}

function validId(value: unknown): value is string {
  return typeof value === 'string' && value.length > 0 && value.length <= 256;
}

function safeTime(value: unknown): value is number {
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0;
}

function digest(token: string): Buffer {
  return createHash('sha256').update(token, 'utf8').digest();
}

/** Trusted management primitive; callers must authenticate and authorize the actor first. */
export function createProxyTokenService(ports: {
  readonly store: ProxyCredentialStore;
  readonly now: () => number;
  readonly random?: (bytes: number) => Buffer;
}): {
  readonly issue: (input: {
    readonly principalId: string;
    readonly actorId: string;
    readonly requestId: string;
    readonly expiresAt: number;
  }) => Promise<{ readonly credentialId: string; readonly token: string }>;
  readonly verifyCredential: (token: string) => Promise<CredentialIdentity | undefined>;
  readonly revoke: (input: {
    readonly credentialId: string;
    readonly actorId: string;
    readonly requestId: string;
  }) => Promise<boolean>;
} {
  const random = ports.random ?? randomBytes;
  return {
    async issue(input) {
      const createdAt = ports.now();
      if (
        !validId(input.principalId) ||
        !validId(input.actorId) ||
        !validId(input.requestId) ||
        !safeTime(createdAt) ||
        !safeTime(input.expiresAt) ||
        input.expiresAt <= createdAt
      ) {
        throw new InvalidProxyCredentialInput();
      }
      const credentialId = random(16).toString('base64url');
      const secret = random(32).toString('base64url');
      if (credentialId.length !== 22 || secret.length !== 43) {
        throw new ProxyCredentialUnavailable();
      }
      const token = `og1_${credentialId}_${secret}`;
      try {
        await ports.store.insertIssued({
          credentialId,
          principalId: input.principalId,
          tokenDigest: digest(token).toString('hex'),
          createdAt,
          expiresAt: input.expiresAt,
          actorId: input.actorId,
          requestId: input.requestId,
        });
      } catch {
        throw new ProxyCredentialUnavailable();
      }
      return { credentialId, token };
    },
    async verifyCredential(token) {
      if (typeof token !== 'string') return undefined;
      const match = TOKEN_FORMAT.exec(token);
      if (!match) return undefined;
      const credentialId = match[1];
      if (!credentialId) return undefined;
      let credential: StoredProxyCredential | undefined;
      try {
        credential = await ports.store.findById(credentialId);
      } catch {
        throw new ProxyCredentialUnavailable();
      }
      if (!credential) return undefined;
      if (
        credential.credentialId !== credentialId ||
        !validId(credential.principalId) ||
        !DIGEST_FORMAT.test(credential.tokenDigest) ||
        !safeTime(credential.expiresAt) ||
        (credential.revokedAt !== null && !safeTime(credential.revokedAt))
      ) {
        throw new ProxyCredentialUnavailable();
      }
      const presentedDigest = digest(token);
      const storedDigest = Buffer.from(credential.tokenDigest, 'hex');
      const matches = timingSafeEqual(presentedDigest, storedDigest);
      const now = ports.now();
      if (!safeTime(now)) throw new ProxyCredentialUnavailable();
      if (!matches || credential.revokedAt !== null || now >= credential.expiresAt)
        return undefined;
      return { credentialId, principalId: credential.principalId, active: true };
    },
    async revoke(input) {
      const revokedAt = ports.now();
      if (
        !validId(input.credentialId) ||
        !validId(input.actorId) ||
        !validId(input.requestId) ||
        !safeTime(revokedAt)
      ) {
        throw new InvalidProxyCredentialInput();
      }
      try {
        return await ports.store.revoke({ ...input, revokedAt });
      } catch {
        throw new ProxyCredentialUnavailable();
      }
    },
  };
}
