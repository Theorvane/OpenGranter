const messages = {
  not_found: 'Requested endpoint was not found.',
  unauthorized: 'Authentication is required.',
  authentication_unavailable: 'Authentication is temporarily unavailable.',
  invalid_request: 'Invalid request.',
  forbidden: 'Access is denied.',
  audit_history_unavailable: 'Audit history is temporarily unavailable.',
  usage_unavailable: 'Usage data is temporarily unavailable.',
  catalog_unavailable: 'Model catalog is temporarily unavailable.',
  route_unavailable: 'Model routing is temporarily unavailable.',
  unknown_model: 'Requested model was not found.',
  limit_exceeded: 'Request limit exceeded.',
  credential_unavailable: 'Upstream credentials are temporarily unavailable.',
  upstream_failed: 'Upstream model request failed.',
  audit_unavailable: 'Required audit recording is temporarily unavailable.',
  internal_error: 'Internal server error.',
} as const;

export type ClientErrorCode = keyof typeof messages;
export type ClientErrorFormat = 'opengranter' | 'openrouter';

type CompatibleErrorType =
  | 'not_found'
  | 'authentication'
  | 'invalid_request'
  | 'permission_denied'
  | 'rate_limit_exceeded'
  | 'server'
  | 'unmapped';

const errorTypes = {
  not_found: 'not_found',
  unauthorized: 'authentication',
  authentication_unavailable: 'server',
  invalid_request: 'invalid_request',
  forbidden: 'permission_denied',
  audit_history_unavailable: 'server',
  usage_unavailable: 'server',
  catalog_unavailable: 'server',
  route_unavailable: 'server',
  unknown_model: 'not_found',
  limit_exceeded: 'rate_limit_exceeded',
  credential_unavailable: 'server',
  upstream_failed: 'unmapped',
  audit_unavailable: 'server',
  internal_error: 'server',
} as const satisfies Record<ClientErrorCode, CompatibleErrorType>;

export function clientErrorFormat(pathname: string): ClientErrorFormat {
  return pathname.startsWith('/api/v1/') ? 'openrouter' : 'opengranter';
}

/** Fixed messages only: never accept upstream or caller content as error text. */
export function createClientErrorResponse(
  status: number,
  code: ClientErrorCode,
  requestId?: string,
  format: ClientErrorFormat = 'opengranter',
): Response {
  return Response.json(
    {
      error:
        format === 'openrouter'
          ? {
              code: status,
              message: messages[code],
              metadata: { opengranter_code: code, error_type: errorTypes[code] },
            }
          : { code, message: messages[code] },
      ...(requestId === undefined ? {} : { request_id: requestId }),
    },
    { status, ...(requestId === undefined ? {} : { headers: { 'x-request-id': requestId } }) },
  );
}
