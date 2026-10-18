/** Discovery is principal-specific, including errors on recognized paths. */
export function isModelDiscoveryPath(pathname: string): boolean {
  return (
    pathname === '/v1/models' ||
    pathname === '/api/v1/models' ||
    pathname === '/api/v1/models/count' ||
    pathname.startsWith('/api/v1/model/')
  );
}
