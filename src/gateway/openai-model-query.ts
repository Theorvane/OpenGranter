/** A single encoded OpenAI model parameter, excluding the existing collection route. */
export function isOpenAIModelPath(pathname: string): boolean {
  return (
    pathname !== '/api/v1/models/count' &&
    pathname !== '/api/v1/models/user' &&
    /^\/(?:api\/)?v1\/models\/[^/]+$/u.test(pathname)
  );
}

/** Decode an exact catalog key once; embedded slashes never become routing authority. */
export function parseOpenAIModelAlias(url: URL): string | undefined {
  if (url.search || !isOpenAIModelPath(url.pathname)) return undefined;
  const encoded = url.pathname.slice(url.pathname.lastIndexOf('/') + 1);
  if (encoded.length > 4608) return undefined;
  try {
    const alias = decodeURIComponent(encoded);
    if (
      alias.length > 512 ||
      (url.pathname.startsWith('/api/v1/') && (alias === 'count' || alias === 'user')) ||
      /[%\\?#\s]/u.test(alias) ||
      alias.split('/').some((segment) => !segment || segment === '.' || segment === '..') ||
      Array.from(alias).some((character) => {
        const code = character.charCodeAt(0);
        return code < 32 || (code >= 127 && code <= 159);
      })
    )
      return undefined;
    return alias;
  } catch {
    return undefined;
  }
}
