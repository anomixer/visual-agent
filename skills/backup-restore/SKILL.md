---
name: backup-restore
description: Plan and execute file backup or restore operations on Windows. Use when the user asks about backup strategy, data migration between disks or NAS, cloud sync setup, or restore verification.
license: Proprietary
compatibility: Windows 10/11. robocopy is built-in; cloud sync tools vary.
metadata:
  author: anomixer
  version: "1.0"
  tags: backup restore robocopy migration data-recovery
---

## Workflow

1. Classify backup target: documents, projects, photos, app data, or full system image.
2. Confirm destination path and retention/overwrite policy with the user.
3. Use an existing SOP (e.g. `backup-user-files`, `restore-user-files`) if available.
4. Verify backup integrity: file count, spot-check sample open, or hash comparison.
5. Provide restore drill instructions so the user can validate the backup.

## Preferred Tools

- **`robocopy`** – local/USB/NAS mirror backups (`/MIR /Z /LOG`).
- **Windows Backup / System Image** – full OS-level rollback.
- **`xcopy`** – lightweight copy for simple folder trees.

## Action Protocol

- Add SOP task: `[ACTION:ADD_TASK sop_id="backup-user-files"]`
- Add SOP task: `[ACTION:ADD_TASK sop_id="restore-user-files"]`

## Safety

- **Never overwrite source data** without explicit approval.
- Recommend a restore test before deleting the original data.
- Warn before any `/MIR` operation – it deletes destination files not in source.
