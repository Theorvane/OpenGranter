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
          ? { code: status, message: messages[code], metadata: { opengranter_code: code } }
          : { code, message: messages[code] },
      ...(requestId === undefined ? {} : { request_id: requestId }),
    },
    { status, ...(requestId === undefined ? {} : { headers: { 'x-request-id': requestId } }) },
  );
}
