---
name: winget-store
description: Recommend Windows software from the winget catalog and generate install SOPs. Use when the user asks for recommended Windows apps and the existing SOP library does not already cover the need.
license: Proprietary
compatibility: Windows 10/11 with winget (App Installer) installed.
metadata:
  author: anomixer
  version: "1.0"
  tags: winget software install recommend sop catalog windows-apps
---

## When to Use

1. The user asks for recommended Windows software for a specific use case.
2. The user wants a tool that is not already in the SOP library.
3. The user explicitly asks to create a SOP for a package found in the winget catalog.

## Core Rules

1. **Prefer existing SOPs** when they already match the request – do not duplicate.
2. Recommend **3–5 packages** with name and one-line use case. Do not dump raw winget output.
3. Focus on the package name and practical purpose; include the winget ID.
4. Generate a SOP **only when the user explicitly asks**.

## Action Protocol

- Recommend apps: reply with a formatted Markdown list.
- Generate a SOP: `[ACTION:CREATE_WINGET_SOP package_id="<winget-id>" package_name="Display Name"]`
- Add and execute: `[ACTION:ADD_TASK sop_id="<id>"]` → `[ACTION:EXECUTE_TASK task_id="<id>"]`

## SOP Generation Rules

- Base install flow: `winget install --id <id> --exact --silent --accept-package-agreements --accept-source-agreements`.
- Include `Check` (is it installed?), `Install`, `Verify` (launch or version check), `Uninstall`.
- Category label: `winget store`.
- **Do not auto-generate a SOP** unless the user asks.
