import { createHash } from 'node:crypto';
import { constants } from 'node:fs';
import { open } from 'node:fs/promises';
import { isAbsolute } from 'node:path';
import {
  type PostgresSsoCanonicalReviewRuntimePorts,
  type PostgresSsoManagementRuntimePorts,
  startPostgresSsoCanonicalReviewGateway,
  startPostgresSsoManagementGateway,
} from './postgres-gateway-runtime.ts';

export interface PostgresSsoBrowserBootstrapPorts
  extends Omit<PostgresSsoManagementRuntimePorts, 'browserJavascript'> {
  /** Explicit trusted PUBLIC build output. Never selected by an HTTP request. */
  readonly browserArtifactPath: string;
  /** Optional reviewed SHA-256 of the exact public artifact bytes. */
  readonly browserArtifactSha256?: string;
}

export class ManagementBrowserArtifactUnavailable extends Error {
  constructor() {
    super('Management browser artifact unavailable');
    this.name = 'ManagementBrowserArtifactUnavailable';
  }
}

const maximumBytes = 8 * 1024 * 1024;

export function validBrowserArtifactSha256(value: unknown): value is string {
  return typeof value === 'string' && value.length === 64 && /^[a-f0-9]+$/u.test(value);
}

async function readArtifact(path: string, expectedSha256: unknown): Promise<string> {
  try {
    if (expectedSha256 !== undefined && !validBrowserArtifactSha256(expectedSha256))
      throw new Error();
    if (typeof path !== 'string' || !isAbsolute(path)) throw new Error();
    const file = await open(path, constants.O_RDONLY | constants.O_NONBLOCK);
    try {
      const stat = await file.stat();
      if (!stat.isFile() || stat.size === 0 || stat.size > maximumBytes) throw new Error();
      const hash = createHash('sha256');
      const decoder = new TextDecoder('utf-8', { fatal: true });
      const chunk = Buffer.alloc(65536);
      let bytes = 0;
      let javascript = '';
      while (true) {
        const { bytesRead } = await file.read(
          chunk,
          0,
          Math.min(chunk.length, maximumBytes + 1 - bytes),
        );
        if (!bytesRead) break;
        bytes += bytesRead;
        if (bytes > maximumBytes) throw new Error();
        hash.update(chunk.subarray(0, bytesRead));
        javascript += decoder.decode(chunk.subarray(0, bytesRead), { stream: true });
      }
      if (expectedSha256 !== undefined && hash.digest('hex') !== expectedSha256) throw new Error();
      javascript += decoder.decode();
      if (!javascript.trim() || javascript.includes('\0')) throw new Error();
      return javascript;
    } finally {
      await file.close();
    }
  } catch {
    // Neither filesystem paths nor contents belong in startup diagnostics.
    throw new ManagementBrowserArtifactUnavailable();
  }
}

/** Explicit optional bootstrap, not artifact verification or authentication.
 * Build separately; no runtime compiler, default activation or new IAM authority.
 */
export async function startPostgresSsoBrowserGateway(ports: PostgresSsoBrowserBootstrapPorts) {
  const { browserArtifactPath, browserArtifactSha256, ...runtime } = ports;
  const browserJavascript = await readArtifact(browserArtifactPath, browserArtifactSha256);
  return startPostgresSsoManagementGateway({ ...runtime, browserJavascript });
}

/** Explicit public artifact + canonical read-only APIs; never a session grant. */
export interface PostgresSsoCanonicalReviewBrowserBootstrapPorts
  extends Omit<PostgresSsoCanonicalReviewRuntimePorts, 'javascript'> {
  readonly browserArtifactPath: string;
  /** Required reviewed SHA-256 for this separate integration boundary. */
  readonly browserArtifactSha256: string;
}

export async function startPostgresSsoCanonicalReviewBrowserGateway(
  ports: PostgresSsoCanonicalReviewBrowserBootstrapPorts,
) {
  if (!validBrowserArtifactSha256(ports.browserArtifactSha256))
    throw new ManagementBrowserArtifactUnavailable();
  const javascript = await readArtifact(ports.browserArtifactPath, ports.browserArtifactSha256);
  // Enumerate trusted runtime inputs: no caller shell, reader or audit overrides.
  const {
    openConnection,
    host,
    port,
    migrationDirectory,
    now,
    issuer,
    audience,
    jwks,
    newRequestId,
  } = ports;
  return startPostgresSsoCanonicalReviewGateway({
    openConnection,
    host,
    port,
    ...(migrationDirectory === undefined ? {} : { migrationDirectory }),
    now,
    issuer,
    audience,
    jwks,
    newRequestId,
    javascript,
  });
}
