---
name: game-research
description: Find game guides, builds, walkthroughs, and YouTube videos. Use when the user asks about game strategies, item builds, hidden mechanics, patch notes, or wants a Chalkboard visual summary of gaming content.
license: Proprietary
compatibility: Requires Playwright Chromium or Browser Use capability for web search.
metadata:
  author: anomixer
  version: "1.0"
  tags: game guide walkthrough youtube chalkboard research
---

## Workflow

1. Extract the game name and topic keyword from the user's message.
2. Search web guides and YouTube videos via Browser Use.
3. Return concise Markdown links grouped by type (guides / videos).
4. Include a short Chalkboard draft for quick visual sharing.

## Output Format

```markdown
## 🎮 <topic>

### 攻略
- [Guide Title](https://...)

### 影片
- [Video Title](https://youtube.com/watch?v=...)

### Chalkboard 草稿
- <key tip 1>
- <key tip 2>
```

## Browser Use Actions

```
[ACTION:BROWSER_USE action="search" query="<game> <topic> guide site:reddit.com OR youtube.com"]
[ACTION:BROWSER_USE action="fetch_title" url="<url>"]
```

## Rules

- Prefer practical result links over wiki/theory pages.
- Keep each list to 3–5 items; omit low-quality or irrelevant results.
- If no useful result is found, ask the user for a more specific keyword.
- Do not fabricate URLs or guide content.
