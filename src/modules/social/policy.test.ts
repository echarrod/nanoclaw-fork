import { describe, expect, it } from 'vitest';

import { buildBskyFacets, extractHashtags, graphemeCount, isSubstantiallySimilar, validateDraft } from './index.js';

const baseDraft = {
  id: 'draft-1',
  sourceExternalId: 'urn:li:share:1',
  platform: 'x' as const,
  text: 'A useful update #social',
  hashtags: ['social'],
  assets: [],
  state: 'awaiting_review' as const,
  sourceRevision: '1',
};

describe('social draft policy', () => {
  it('enforces the personal X hashtag ceiling and image alt text', () => {
    const validation = validateDraft({
      ...baseDraft,
      text: 'Update #one #two #three',
      assets: [{ kind: 'image', url: 'https://example.com/image.png' }],
    });

    expect(validation.valid).toBe(false);
    expect(validation.errors).toContain('Post contains more than 2 hashtags');
    expect(validation.errors).toContain('Image https://example.com/image.png is missing alt text');
  });

  it('counts Bluesky post text as graphemes and bytes', () => {
    expect(graphemeCount('e\u0301')).toBe(1);
    const validation = validateDraft({ ...baseDraft, platform: 'bluesky', text: '🙂'.repeat(301), hashtags: [] });
    expect(validation.errors).toContain('Post exceeds the 300-character platform limit');
  });

  it('normalises duplicate copy without treating links as distinct content', () => {
    expect(isSubstantiallySimilar('Read this: https://example.com/a', 'Read this https://elsewhere.test/b')).toBe(true);
    expect(extractHashtags('A #one and #two')).toEqual(['one', 'two']);
  });
});

describe('Bluesky facets', () => {
  it('uses UTF-8 byte offsets for links and hashtags', () => {
    const text = 'é https://example.com #test';
    const facets = buildBskyFacets(text);
    expect(facets).toEqual([
      {
        index: { byteStart: 3, byteEnd: 22 },
        features: [{ $type: 'app.bsky.richtext.facet#link', uri: 'https://example.com' }],
      },
      {
        index: { byteStart: 23, byteEnd: 28 },
        features: [{ $type: 'app.bsky.richtext.facet#tag', tag: 'test' }],
      },
    ]);
  });
});
