---
name: windows-printer-troubleshoot
description: Diagnose and fix Windows printer issues. Use when the user cannot print, the printer shows as offline, the print queue is stuck, or there is a driver mismatch.
license: Proprietary
compatibility: Windows 10/11. Print Spooler service must be accessible.
metadata:
  author: anomixer
  version: "1.0"
  tags: printer spooler driver offline queue usb network troubleshoot
---

## Workflow

1. **Identify printer type**: USB / network (IP) / Bluetooth / virtual (PDF/XPS).
2. **Check spooler service** and queue state.
3. **Validate driver** and port mapping.
4. **Propose fix** from least to most invasive.

## Diagnostics

```powershell
Get-Service Spooler                          # spooler status
Get-Printer | Select Name, PrinterStatus     # online/offline
Get-PrintJob -PrinterName "<name>"          # queue contents
```

## Common Fixes (require user approval)

| Issue | Fix |
|---|---|
| Spooler stopped | `Restart-Service Spooler` |
| Queue stuck | Stop spooler → delete `C:\Windows\System32\spool\PRINTERS\*` → start spooler |
| Wrong port | Printer Properties → Ports tab → correct IP/USB port |
| Driver corrupt | Device Manager → uninstall driver → reinstall from manufacturer |
| Offline shown | Printers settings → uncheck "Use Printer Offline" |

## Safety

- **Confirm before deleting queued jobs** – in-progress jobs will be lost.
- Recommend saving documents before cancelling a large print queue.
