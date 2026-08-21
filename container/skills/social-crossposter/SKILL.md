---
name: social-crossposter
description: Prepare, review, schedule, and publish personal LinkedIn-derived X and Bluesky posts using the configured social policy and API-only publisher adapters.
---

# Social Crossposter

Use this skill for the personal social publishing workflow. It is deliberately review-first: never publish or schedule a draft unless its owner has explicitly approved that platform-specific draft.

## Required companion skills

Use the configured `linkedin-post-source`, `x-publishing`, and `bluesky-publishing` skills for platform-specific rules. They must be exposed from a pinned external skill root; do not substitute browser automation, cookies, or an unofficial API.

## Workflow

1. Retrieve only new LinkedIn posts through authorised official API access. On first connection, present discovered posts for selection; never import historical posts automatically.
2. Save the selected source and content revision. Generate independent X and Bluesky drafts rather than copying the text verbatim.
3. Validate text, hashtags, media, alt text, links, and duplicate-copy risk against the personal policy profile. Unsupported LinkedIn content becomes a review notice, not a degraded automatic post.
4. Present each platform’s draft for owner review. The owner may edit, approve, skip, reschedule, or cancel each one independently.
5. Only an approved draft may be scheduled. At publish time, use the API-only publisher, record the idempotency key and normalised platform result, and treat ambiguous timeouts as review-required rather than retrying blindly.

## Personal profile defaults

- X: zero to two relevant hashtags.
- Bluesky: zero to three relevant tags; use none when none materially help.
- No trend chasing, engagement bait, automated replies, unsolicited mentions, or automatic duplicate reposts.
- Every image requires specific descriptive alt text.
- Keep personal sources, credentials, approvals, schedules, and analytics separate from company material.

## Safety boundary

This skill is disabled until the group has approved source and publisher credentials. Never log credentials. If authorisation, an asset, a policy check, or a publish outcome is unclear, stop at review and report the reason.
