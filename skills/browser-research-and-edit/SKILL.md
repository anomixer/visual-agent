---
name: browser-research-and-edit
description: Search the web, open URLs, extract page content, and summarise findings. Use when the user asks for web research, price/spec lookups, news queries, or wants results displayed on the Chalkboard.
license: Proprietary
compatibility: Requires Playwright Chromium installed via the install-playwright-chromium SOP.
metadata:
  author: anomixer
  version: "1.0"
  tags: browser research web search playwright chalkboard
---

## Workflow

1. **Clarify intent** – identify keywords, scope (depth/breadth), and desired output format.
2. **Check existing knowledge** – if the answer is already in context, skip Browser Use.
3. **Use Browser Use** – invoke `search → open/navigate → fetch_title/extract_text → summarise`.
4. **Synthesise results** – collect 3–6 sources; include Markdown links with titles.
5. **Deliver output** – reply in Markdown; optionally draft a Chalkboard summary.

## Browser Use Actions (LLM-emitted tags)

```
[ACTION:BROWSER_USE action="search" query="<query>"]
[ACTION:BROWSER_USE action="open" url="<url>"]
[ACTION:BROWSER_USE action="fetch_title" url="<url>"]
[ACTION:BROWSER_USE action="extract_text" url="<url>"]
```

## Chalkboard Template (optional)

```
##CHALKBOARD##
Title: <topic>
- <key point 1>
- <key point 2>
- <key point 3>
##ENDCHALKBOARD##
```

## Rules

- Only use Browser Use when web data is genuinely needed.
- Cite sources with Markdown links; do not fabricate URLs.
- If Playwright Chromium is missing, prompt the user to run the `install-playwright-chromium` SOP first.
- Prefer concise output; long raw dumps hurt readability.
