# AI PC Agent Skill File v1

# File Backup and Restore Skill

## Use When
- User asks backup strategy, backup execution, restore verification.
- User needs migration between disks, NAS, external drives, or cloud sync.

## Workflow
1. Classify backup target: documents, projects, photos, app data, full system.
2. Confirm destination and retention policy.
3. Use SOP for multi-step backup/restore execution if available.
4. Verify backup integrity (file count/hash/sample open).
5. Provide restore drill instructions.

## Preferred Tools
- `robocopy` for local/USB/NAS mirror backups.
- Restore point/system image for OS-level rollback.

## Safety
- Never overwrite source without explicit approval.
- Recommend restore test before deleting original data.
