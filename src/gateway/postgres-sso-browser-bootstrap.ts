import { createHash } from 'node:crypto';
import { constants } from 'node:fs';
import { open } from 'node:fs/promises';
import { isAbsolute } from 'node:path';
import {
  type PostgresSsoManagementRuntimePorts,
  startPostgresSsoManagementGateway,
} from './postgres-gateway-runtime.ts';

export interface PostgresSsoBrowserBootstrapPorts
  extends Omit<PostgresSsoManagementRuntimePorts, 'browserJavascript'> {
  /** Explicit trusted PUBLIC build output. Never selected by an HTTP request. */
  readonly browserArtifactPath: string;
  /** Optional SHA-256 from the trusted reviewed release record, not the file itself. */
  readonly browserArtifactSha256?: string;
}

export class ManagementBrowserArtifactUnavailable extends Error {
  constructor() {
    super('Management browser artifact unavailable');
    this.name = 'ManagementBrowserArtifactUnavailable';
  }
}

const maximumBytes = 8 * 1024 * 1024;

async function readArtifact(path: string, expectedSha256: string | undefined): Promise<string> {
  try {
    if (typeof path !== 'string' || !isAbsolute(path)) throw new Error();
    if (
      expectedSha256 !== undefined &&
      (typeof expectedSha256 !== 'string' || !/^[a-f0-9]{64}$/u.test(expectedSha256))
    )
      throw new Error();
    const file = await open(path, constants.O_RDONLY | constants.O_NONBLOCK);
    try {
      const stat = await file.stat();
      if (!stat.isFile() || stat.size === 0 || stat.size > maximumBytes) throw new Error();
      const hash = expectedSha256 === undefined ? undefined : createHash('sha256');
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
        hash?.update(chunk.subarray(0, bytesRead));
        javascript += decoder.decode(chunk.subarray(0, bytesRead), { stream: true });
      }
      javascript += decoder.decode();
      if (hash && hash.digest('hex') !== expectedSha256) throw new Error();
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
