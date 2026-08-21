import { describe, expect, it, vi } from 'vitest';

import { listLinkedInPosts, publishBskyPost, publishXPost } from './index.js';

describe('social API clients', () => {
  it('creates an X post through an injected authorised transport', async () => {
    const fetcher = vi.fn().mockResolvedValue(new Response(JSON.stringify({ data: { id: '123' } }), { status: 201 }));
    await expect(publishXPost(fetcher, { text: 'Hello', assets: [] })).resolves.toMatchObject({
      platform: 'x',
      externalId: '123',
    });
    expect(fetcher).toHaveBeenCalledWith('https://api.x.com/2/tweets', expect.objectContaining({ method: 'POST' }));
  });

  it('creates a Bluesky record with facets and native alt text', async () => {
    const fetcher = vi
      .fn()
      .mockResolvedValue(
        new Response(JSON.stringify({ uri: 'at://did:plc:test/app.bsky.feed.post/abc' }), { status: 200 }),
      );
    await publishBskyPost(fetcher, {
      did: 'did:plc:test',
      text: 'Hello #test',
      assets: [{ kind: 'image', url: 'https://example.com/image.png', altText: 'A descriptive image' }],
      blobs: [{ $type: 'blob' }],
    });
    const request = JSON.parse(fetcher.mock.calls[0][1].body as string) as {
      record: { facets: unknown[]; embed: { images: Array<{ alt: string }> } };
    };
    expect(request.record.facets).toHaveLength(1);
    expect(request.record.embed.images[0].alt).toBe('A descriptive image');
  });

  it('maps official LinkedIn post fields without scraping', async () => {
    const fetcher = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({
          elements: [{ id: 'urn:li:share:1', author: 'urn:li:person:ed', publishedAt: 1, commentary: 'Source post' }],
        }),
        { status: 200 },
      ),
    );
    await expect(
      listLinkedInPosts(fetcher, { author: 'urn:li:person:ed', linkedinVersion: '202604' }),
    ).resolves.toMatchObject([{ externalId: 'urn:li:share:1', text: 'Source post' }]);
    expect(fetcher.mock.calls[0][0].toString()).toContain('author=urn%3Ali%3Aperson%3Aed');
    expect(fetcher.mock.calls[0][0].toString()).toContain('q=author');
    expect(fetcher.mock.calls[0][1].headers).toMatchObject({ 'X-RestLi-Method': 'FINDER' });
  });
});
