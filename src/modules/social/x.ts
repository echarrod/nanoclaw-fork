import type { PublicationResult, SocialAsset } from './types.js';

import type { AuthorisedFetch } from './bluesky.js';

export async function publishXPost(
  fetcher: AuthorisedFetch,
  input: { text: string; mediaIds?: string[]; assets: SocialAsset[] },
): Promise<PublicationResult> {
  if (input.assets.filter((asset) => asset.kind === 'image').length !== (input.mediaIds?.length ?? 0)) {
    throw new Error('Every X image requires an uploaded media ID');
  }
  const response = await fetcher('https://api.x.com/2/tweets', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      text: input.text,
      ...(input.mediaIds?.length ? { media: { media_ids: input.mediaIds } } : {}),
    }),
  });
  if (!response.ok) throw new Error(`X publish failed: ${response.status}`);
  const body = (await response.json()) as { data?: { id?: string } };
  if (!body.data?.id) throw new Error('X publish response omitted its post ID');
  return { platform: 'x', externalId: body.data.id, url: `https://x.com/i/web/status/${body.data.id}` };
}
