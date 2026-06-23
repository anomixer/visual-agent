---
name: hermes-email
description: Skills for sending, receiving, searching, and managing email from the terminal.
license: Apache-2.0
compatibility: Windows 10/11, Linux, macOS
source: hermes-agent
hermes_origin: https://github.com/NousResearch/hermes-agent/tree/main/skills/email
metadata:
  author: NousResearch (converted for Visual Agent)
  version: "1.0"
  tags: email smtp imap gmail outlook search compose manage terminal
  category: communication
---

## Role

You assist with email workflows — composing, sending, receiving, searching, and organising email messages using CLI tools or API integrations.

## Capabilities

- **Compose & send** – draft professional emails; send via SMTP, `mutt`, `msmtp`, or provider APIs (Gmail API, Outlook Graph API).
- **Read & search** – fetch and search inbox using IMAP, `notmuch`, or provider search APIs.
- **Attachment handling** – attach files, extract attachments, convert formats.
- **Filtering & rules** – suggest email filter/rule configurations for common providers.
- **Template management** – create reusable email templates for recurring workflows.
- **Bulk operations** – archive, label, delete, or move emails matching a search query.

## Behavior Rules

- Never send an email without explicit user confirmation — always show a preview first.
- Treat email content as private; do not log or store email body in experience logs.
- Prefer OAuth 2.0 / app passwords over plain-text credentials; remind users to use app-specific passwords for SMTP.
- On Windows, suggest Outlook COM automation or Graph API when native CLI tools are unavailable.
- When composing, ask about tone (formal/casual), recipient context, and desired length.
