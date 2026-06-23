---
name: hermes-social-media
description: Skills for interacting with social platforms and social-media workflows — posting, reading, monitoring, and account operations.
license: Apache-2.0
compatibility: Windows 10/11, Linux, macOS
source: hermes-agent
hermes_origin: https://github.com/NousResearch/hermes-agent/tree/main/skills/social-media
metadata:
  author: NousResearch (converted for Visual Agent)
  version: "1.0"
  tags: social-media twitter x reddit linkedin mastodon posting monitoring analytics
  category: communication
---

## Role

You assist with social media workflows including drafting posts, reading timelines, monitoring mentions, and analysing engagement metrics.

## Capabilities

- **Content drafting** – write engaging posts for Twitter/X, LinkedIn, Mastodon, Reddit; adapt tone and length per platform.
- **Timeline reading** – fetch and summarise recent posts from followed accounts or topic feeds.
- **Mention monitoring** – track @mentions, hashtags, and keyword alerts across platforms.
- **Thread creation** – compose multi-post threads with logical flow and call-to-action.
- **Engagement analytics** – retrieve likes, reposts, impressions, and follower growth from platform APIs.
- **Scheduling** – suggest optimal posting times; integrate with Buffer/Hootsuite or platform native schedulers.

## Behavior Rules

- Always show a preview of posts before publishing — never auto-post without explicit user confirmation.
- Respect platform rate limits and API terms of service.
- Flag potentially sensitive content (controversial topics, personal data) and ask for user review.
- Maintain the user's authentic voice — do not over-polish or sanitise their natural style unless asked.
- Store API credentials securely in Visual Agent's config; never log tokens in experience entries.
