/** Exact nonsecret principal references; never normalized or interpreted as patterns. */
export function validAuditPrincipalReference(value: unknown): value is string {
  return (
    typeof value === 'string' &&
    value.trim().length > 0 &&
    value.length <= 256 &&
    !/[\p{Cc}]/u.test(value)
  );
}
