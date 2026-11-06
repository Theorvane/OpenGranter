/** Principal-scoped history responses must never be stored, including failures. */
export function isHistoryPath(pathname: string): boolean {
  return pathname === '/v1/audit' || pathname === '/v1/usage';
}
