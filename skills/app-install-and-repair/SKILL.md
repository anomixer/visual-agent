---
name: app-install-and-repair
description: Install, update, uninstall, or repair desktop applications on Windows. Use when the user requests app installation, reports launch failures, missing dependencies, or version conflicts.
license: Proprietary
compatibility: Windows 10/11. Requires winget or internet access for download-based installs.
metadata:
  author: anomixer
  version: "1.0"
  tags: install uninstall repair winget sop
---

## Workflow

1. Check if a matching SOP already exists in the SOP library.
2. **If SOP exists**: add task → explain risk → wait for explicit user approval → execute.
3. **If SOP missing**: search a trusted source (winget / Microsoft Store / GitHub release).
4. Create a new SOP when the user confirms repeated use is expected.
5. Verify the installed executable, service, or version after completion.

## Action Protocol

- Add and queue a SOP task: `[ACTION:ADD_TASK sop_id="<id>"]`
- Execute a queued task: `[ACTION:EXECUTE_TASK task_id="<id>"]`
- Generate winget SOP: `[ACTION:CREATE_WINGET_SOP package_id="<id>" package_name="<name>"]`
- Generate MS Store SOP: `[ACTION:CREATE_MSSTORE_SOP package_id="<id>" package_name="<name>"]`
- Generate GitHub release SOP: `[ACTION:CREATE_GITHUB_RELEASE_SOP repo_full_name="owner/repo" asset_name="<file>" download_url="<url>"]`

## Rules

- Prefer silent install when available (`--silent` / `--quiet`).
- Uninstall residual cleanup (registry keys, AppData folders) requires explicit user consent.
- Always verify the install succeeded before reporting success.
- Never modify the system without user approval.
