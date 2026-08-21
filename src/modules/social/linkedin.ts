import type { AuthorisedFetch } from './bluesky.js';
import type { SourcePost } from './types.js';

export async function listLinkedInPosts(
  fetcher: AuthorisedFetch,
  input: { author: string; linkedinVersion: string; start?: number; count?: number },
): Promise<SourcePost[]> {
  if (input.count !== undefined && (!Number.isInteger(input.count) || input.count < 1 || input.count > 100)) {
    throw new Error('LinkedIn source discovery count must be an integer from 1 to 100');
  }
  const url = new URL('https://api.linkedin.com/rest/posts');
  url.searchParams.set('author', input.author);
  url.searchParams.set('q', 'author');
  url.searchParams.set('viewContext', 'AUTHOR');
  url.searchParams.set('start', String(input.start ?? 0));
  url.searchParams.set('count', String(input.count ?? 100));
  url.searchParams.set('sortBy', 'LAST_MODIFIED');
  const response = await fetcher(url, {
    headers: {
      'Linkedin-Version': input.linkedinVersion,
      'X-Restli-Protocol-Version': '2.0.0',
      'X-RestLi-Method': 'FINDER',
    },
  });
  if (!response.ok) throw new Error(`LinkedIn source discovery failed: ${response.status}`);
  const body = (await response.json()) as { elements?: Array<Record<string, unknown>> };
  return (body.elements ?? []).map((post) => {
    const content = (post.content ?? {}) as Record<string, unknown>;
    const article = content.article as Record<string, unknown> | undefined;
    const assets = typeof article?.source === 'string' ? [{ kind: 'link' as const, url: article.source }] : [];
    const unsupportedContent = Object.keys(content).filter((key) => key !== 'article');
    return {
      source: 'linkedin',
      externalId: String(post.id),
      author: String(post.author ?? input.author),
      publishedAt: new Date(Number(post.publishedAt ?? Date.now())).toISOString(),
      updatedAt: post.lastModifiedAt ? new Date(Number(post.lastModifiedAt)).toISOString() : undefined,
      text: String(post.commentary ?? ''),
      assets,
      ...(unsupportedContent.length ? { unsupportedContent } : {}),
    };
  });
}
