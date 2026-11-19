/** Compatibility names for stacked callers; one shared routing implementation. */
export {
  createPostgresSsoOperationsHandler as createPostgresSsoCanonicalOperationsHandler,
  createPostgresSsoOperationsServer as createPostgresSsoCanonicalOperationsServer,
  type PostgresSsoOperationsPorts as PostgresSsoCanonicalOperationsPorts,
} from './postgres-sso-operations-http.ts';
