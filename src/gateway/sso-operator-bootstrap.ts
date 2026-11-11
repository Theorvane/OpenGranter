import { constants } from 'node:fs';
import { open } from 'node:fs/promises';
import { isAbsolute } from 'node:path';
import { createRfc9068SsoAccessTokenVerifier } from '../identity/rfc9068-sso-access-tokens.ts';
import type { PostgresConnection } from '../storage/postgres-connection.ts';
import { validBrowserArtifactSha256 } from './postgres-sso-browser-bootstrap.ts';
import type { SsoBrowserBootstrapPorts } from './sso-browser-service.ts';

export class SsoOperatorBootstrapUnavailable extends Error {
  constructor() {
    super('SSO operator bootstrap unavailable');
    this.name = 'SsoOperatorBootstrapUnavailable';
  }
}

function required(env: NodeJS.ProcessEnv, key: string): string {
  const value = env[key];
  if (!value || value.includes('\0')) throw new SsoOperatorBootstrapUnavailable();
  return value;
}

function path(env: NodeJS.ProcessEnv, key: string): string {
  const value = required(env, key);
  if (!isAbsolute(value)) throw new SsoOperatorBootstrapUnavailable();
  return value;
}

/** Read a bounded public administrator trust snapshot, never a request-selected URL. */
async function publicJwks(path: string): Promise<unknown> {
  const maximum = 65536;
  const file = await open(path, constants.O_RDONLY | constants.O_NONBLOCK | constants.O_NOFOLLOW);
  try {
    const stat = await file.stat();
    if (!stat.isFile() || stat.size < 1 || stat.size > maximum)
      throw new SsoOperatorBootstrapUnavailable();
    // Read maximum+1 even if the file grows after stat; never unbounded readFile.
    const buffer = Buffer.alloc(maximum + 1);
    let bytes = 0;
    while (bytes < buffer.length) {
      const result = await file.read(buffer, bytes, buffer.length - bytes);
      if (!result.bytesRead) break;
      bytes += result.bytesRead;
    }
    if (bytes < 1 || bytes > maximum) throw new SsoOperatorBootstrapUnavailable();
    const text = new TextDecoder('utf-8', { fatal: true }).decode(buffer.subarray(0, bytes));
    return JSON.parse(text) as unknown;
  } finally {
    await file.close();
  }
}

/** Configuration only: validation does not open the database, listen or provision identities. */
export async function loadSsoBrowserBootstrap(
  env: NodeJS.ProcessEnv,
  openConnection: () => PostgresConnection | Promise<PostgresConnection>,
): Promise<SsoBrowserBootstrapPorts> {
  try {
    const history = env.OPENGRANTER_SSO_HISTORY_READS;
    if (history !== undefined && history !== 'true' && history !== 'false') {
      throw new SsoOperatorBootstrapUnavailable();
    }
    const pin = env.OPENGRANTER_BROWSER_ARTIFACT_SHA256;
    if (pin !== undefined && !validBrowserArtifactSha256(pin))
      throw new SsoOperatorBootstrapUnavailable();
    const issuer = required(env, 'OPENGRANTER_SSO_ISSUER');
    const audience = required(env, 'OPENGRANTER_SSO_AUDIENCE');
    const jwksPath = path(env, 'OPENGRANTER_SSO_JWKS_PATH');
    const browserArtifactPath = path(env, 'OPENGRANTER_BROWSER_ARTIFACT_PATH');
    const jwks = await publicJwks(jwksPath);
    // Reuse the existing complete public-key/issuer/audience rules before DB ownership.
    createRfc9068SsoAccessTokenVerifier({ issuer, audience, jwks, now: Date.now });
    return {
      issuer,
      audience,
      jwks,
      browserArtifactPath,
      openConnection,
      ...(history === undefined ? {} : { enableHistoryReads: history === 'true' }),
      ...(pin === undefined ? {} : { browserArtifactSha256: pin }),
    };
  } catch {
    // Errors may contain filesystem paths, JSON source, or operator configuration.
    throw new SsoOperatorBootstrapUnavailable();
  }
}
