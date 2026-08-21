import { Buffer } from 'buffer';

import type { BskyFacet, PublicationResult, SocialAsset } from './types.js';

export type AuthorisedFetch = (input: string | URL, init?: RequestInit) => Promise<Response>;

export function buildBskyFacets(text: string): BskyFacet[] {
  const facets: BskyFacet[] = [];
  const matcher = /https?:\/\/[^\s]+|(^|\s)#([\p{L}\p{N}_]+)/gu;
  for (const match of text.matchAll(matcher)) {
    const full = match[0];
    const start = match.index ?? 0;
    const token = full.trim();
    const tokenStart = start + full.indexOf(token);
    const index = {
      byteStart: Buffer.byteLength(text.slice(0, tokenStart), 'utf8'),
      byteEnd: Buffer.byteLength(text.slice(0, tokenStart + token.length), 'utf8'),
    };
    if (token.startsWith('http')) {
      facets.push({ index, features: [{ $type: 'app.bsky.richtext.facet#link', uri: token }] });
    } else {
      facets.push({ index, features: [{ $type: 'app.bsky.richtext.facet#tag', tag: token.slice(1) }] });
    }
  }
  return facets;
}

export async function publishBskyPost(
  fetcher: AuthorisedFetch,
  input: { did: string; text: string; assets: SocialAsset[]; blobs?: unknown[] },
): Promise<PublicationResult> {
  const imageAssets = input.assets.filter((asset) => asset.kind === 'image');
  if (imageAssets.length !== (input.blobs?.length ?? 0))
    throw new Error('Every Bluesky image requires an uploaded blob');
  const record: Record<string, unknown> = {
    $type: 'app.bsky.feed.post',
    text: input.text,
    facets: buildBskyFacets(input.text),
    createdAt: new Date().toISOString(),
  };
  if (imageAssets.length > 0) {
    record.embed = {
      $type: 'app.bsky.embed.images',
      images: imageAssets.map((asset, index) => ({ image: input.blobs?.[index], alt: asset.altText ?? '' })),
    };
  }
  const response = await fetcher('https://bsky.social/xrpc/com.atproto.repo.createRecord', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ repo: input.did, collection: 'app.bsky.feed.post', record }),
  });
  if (!response.ok) throw new Error(`Bluesky publish failed: ${response.status}`);
  const body = (await response.json()) as { uri?: string };
  if (!body.uri) throw new Error('Bluesky publish response omitted its URI');
  return {
    platform: 'bluesky',
    externalId: body.uri,
    url: `https://bsky.app/profile/${input.did}/post/${body.uri.split('/').at(-1)}`,
  };
}
