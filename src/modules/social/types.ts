export type SocialPlatform = 'x' | 'bluesky';
export type SourceKind = 'linkedin';
export type AssetKind = 'image' | 'link';
export type DraftState = 'awaiting_review' | 'scheduled' | 'publishing' | 'published' | 'failed' | 'cancelled';

export interface SocialAsset {
  kind: AssetKind;
  url: string;
  altText?: string;
  mimeType?: string;
}

export interface SourcePost {
  source: SourceKind;
  externalId: string;
  author: string;
  publishedAt: string;
  updatedAt?: string;
  text: string;
  assets: SocialAsset[];
  /** LinkedIn content the personal workflow must present for manual handling. */
  unsupportedContent?: string[];
  sourceUrl?: string;
}

export interface PlatformDraft {
  id: string;
  sourceExternalId: string;
  platform: SocialPlatform;
  text: string;
  hashtags: string[];
  assets: SocialAsset[];
  state: DraftState;
  scheduledFor?: string;
  sourceRevision: string;
}

export interface PublicationResult {
  platform: SocialPlatform;
  externalId: string;
  url?: string;
}

export interface DraftValidation {
  valid: boolean;
  errors: string[];
  warnings: string[];
}

export interface BskyFacet {
  index: { byteStart: number; byteEnd: number };
  features: Array<
    { $type: 'app.bsky.richtext.facet#link'; uri: string } | { $type: 'app.bsky.richtext.facet#tag'; tag: string }
  >;
}
