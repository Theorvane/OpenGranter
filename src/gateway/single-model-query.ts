/** Resolve only a bounded exact published alias; never follow a metadata target or URL. */
export function parseSingleModelAlias(url: URL): string | undefined {
  if (url.search) return undefined;
  const match = /^\/api\/v1\/model\/([^/]+)\/([^/]+)$/u.exec(url.pathname);
  if (!match?.[1] || !match[2]) return undefined;
  try {
    const author = decodeURIComponent(match[1]);
    const slug = decodeURIComponent(match[2]);
    if (author.length > 128 || slug.length > 256) return undefined;
    for (const segment of [author, slug])
      if (
        !segment ||
        segment === '.' ||
        segment === '..' ||
        /[/%\\?#\s]/u.test(segment) ||
        Array.from(segment).some((character) => {
          const code = character.charCodeAt(0);
          return code < 32 || (code >= 127 && code <= 159);
        })
      )
        return undefined;
    return `${author}/${slug}`;
  } catch {
    return undefined;
  }
}
