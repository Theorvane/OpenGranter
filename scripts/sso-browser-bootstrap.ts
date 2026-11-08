import { loadSsoBrowserBootstrap } from '../src/gateway/sso-operator-bootstrap.ts';
import { createPostgresConnection } from '../src/storage/postgres-connection.ts';

/** Explicit operator-selected module; pg owns its standard process environment configuration. */
export async function createSsoBrowserPorts() {
  return loadSsoBrowserBootstrap(process.env, () => createPostgresConnection({}));
}
