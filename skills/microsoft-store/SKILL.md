---
name: microsoft-store
description: Recommend and install Windows UWP / Microsoft Store apps. Use when the user explicitly mentions Microsoft Store, UWP, Store apps, or wants apps distributed through the Store channel.
license: Proprietary
compatibility: Windows 10/11. Requires Microsoft Store access and winget with msstore source.
metadata:
  author: anomixer
  version: "1.0"
  tags: microsoft-store uwp winget msstore windows-apps
---

## When to Use

1. The user mentions "Microsoft Store", "Windows Store", "UWP", "msstore", or "Store app".
2. The user wants apps that fit a Store-first installation flow.
3. The existing SOP library does not already contain a strong match.

## Core Rules

1. **Prefer existing SOPs** if they already solve the request – do not recreate.
2. Search via `winget search --source msstore <app>` rather than the default winget source.
3. Recommend **3–5 clear candidates** with app name and use case; avoid raw output dumps.
4. Generate a SOP only when the user explicitly asks.

## Action Protocol

- Recommend Store apps (no SOP needed): reply with a Markdown list.
- Generate a msstore SOP: `[ACTION:CREATE_MSSTORE_SOP package_id="<msstore-id>" package_name="Display Name"]`
- Add and execute: `[ACTION:ADD_TASK sop_id="<id>"]` → `[ACTION:EXECUTE_TASK task_id="<id>"]`

## Rules

- Confirm the package ID in `winget search --source msstore` before generating a SOP.
- Note any Store app that requires sign-in or has regional restrictions.
