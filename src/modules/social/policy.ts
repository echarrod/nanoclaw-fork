import { Buffer } from 'buffer';

import type { DraftValidation, PlatformDraft, SocialPlatform } from './types.js';

export const platformLimits: Record<SocialPlatform, { text: number; hashtags: number }> = {
  x: { text: 280, hashtags: 2 },
  bluesky: { text: 300, hashtags: 3 },
};

const hashtagPattern = /(^|\s)#([\p{L}\p{N}_]+)/gu;

export function validateDraft(draft: PlatformDraft): DraftValidation {
  const errors: string[] = [];
  const warnings: string[] = [];
  const limits = platformLimits[draft.platform];
  const textLength = draft.platform === 'bluesky' ? graphemeCount(draft.text) : [...draft.text].length;

  if (!draft.text.trim()) errors.push('Post text is required');
  if (textLength > limits.text) errors.push(`Post exceeds the ${limits.text}-character platform limit`);
  if (draft.platform === 'bluesky' && Buffer.byteLength(draft.text, 'utf8') > 3000) {
    errors.push("Post exceeds Bluesky's 3,000-byte limit");
  }

  const hashtags = extractHashtags(draft.text);
  if (hashtags.length > limits.hashtags) errors.push(`Post contains more than ${limits.hashtags} hashtags`);
  if (new Set(hashtags.map((tag) => tag.toLocaleLowerCase())).size !== hashtags.length) {
    warnings.push('Post repeats one or more hashtags');
  }
  if (draft.hashtags.some((tag) => !hashtags.includes(tag.replace(/^#/, '')))) {
    warnings.push('Declared hashtags do not match post text');
  }
  for (const asset of draft.assets) {
    if (asset.kind === 'image' && !asset.altText?.trim()) errors.push(`Image ${asset.url} is missing alt text`);
  }
  return { valid: errors.length === 0, errors, warnings };
}

export function extractHashtags(text: string): string[] {
  return [...text.matchAll(hashtagPattern)].map((match) => match[2]);
}

export function graphemeCount(text: string): number {
  return [...new Intl.Segmenter(undefined, { granularity: 'grapheme' }).segment(text)].length;
}

/** A conservative comparison for preventing accidental duplicate automated posts. */
export function isSubstantiallySimilar(left: string, right: string): boolean {
  const normalise = (value: string) =>
    value
      .toLocaleLowerCase()
      .replace(/https?:\/\/\S+/g, '')
      .replace(/[^\p{L}\p{N}\s]/gu, '')
      .replace(/\s+/g, ' ')
      .trim();
  return normalise(left) === normalise(right);
}
