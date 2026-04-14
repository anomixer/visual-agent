---
name: windows-storage-recovery
description: Diagnose low disk space, locate large files, and guide safe storage cleanup or file recovery on Windows. Use when the user reports disk full, missing files, or corrupted drive behaviour.
license: Proprietary
compatibility: Windows 10/11. chkdsk and DISM are built-in; third-party recovery tools may be needed for advanced cases.
metadata:
  author: anomixer
  version: "1.0"
  tags: storage disk cleanup recovery space chkdsk robocopy backup
---

## Workflow

1. **Check disk usage** and free space per volume (`Get-PSDrive`, `Disk Management`).
2. **Identify large folders** and safe cleanup targets (Temp, Downloads, WinSxS, Recycle Bin).
3. **Recommend backup** before any risky operation (format, chkdsk /f, partition resize).
4. **For file recovery requests**: prioritise read-only copy-out first; avoid writes to the affected drive.

## Diagnostics

```powershell
Get-PSDrive -PSProvider FileSystem         # volume free space
Get-ChildItem "C:\" -Recurse -ErrorAction SilentlyContinue |
  Sort-Object Length -Descending | Select-Object -First 20 FullName, Length
# Find top 20 largest files
```

## Common Cleanup Targets (safe, user approval needed)

| Target | Path |
|---|---|
| Temp files | `%TEMP%`, `C:\Windows\Temp` |
| Recycle Bin | `Clear-RecycleBin` |
| Windows Update cache | `C:\Windows\SoftwareDistribution\Download` |
| Delivery Optimisation | `C:\Windows\ServiceProfiles\NetworkService\AppData\Local\Microsoft\Windows\DeliveryOptimization` |

```powershell
# Disk Cleanup (GUI)
cleanmgr /sagerun:1

# chkdsk (schedule for next boot)
chkdsk C: /f /r
```

## Safety

- **Never delete source data** without explicit user consent.
- **Avoid destructive deletes** unless user confirms after being shown what will be removed.
- For file recovery: use read-only mode; do not install recovery tools on the affected drive.
