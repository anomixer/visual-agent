---
name: windows-network-troubleshoot
description: Diagnose and fix Windows network issues. Use when the user reports disconnected internet, high latency, DNS failures, adapter errors, or VPN problems.
license: Proprietary
compatibility: Windows 10/11. Built-in tools (ipconfig, netsh, ping) required; no extra install needed.
metadata:
  author: anomixer
  version: "1.0"
  tags: network internet dns vpn adapter troubleshoot wifi ethernet
---

## Workflow

1. **Classify symptom**: no network / unstable / slow / DNS failure / VPN broken.
2. **Check IP / gateway / DNS / adapter status** using safe read-only commands.
3. **Run diagnostics** before proposing any reset or change.
4. **Propose fixes** ordered from lowest to highest risk.

## Diagnostics (read-only – always safe)

```powershell
ipconfig /all                         # IP, gateway, DNS, adapter info
ping 8.8.8.8 -n 4                    # internet reachability
ping google.com -n 4                 # DNS resolution
Test-NetConnection google.com -Port 80 # TCP connectivity
Get-NetAdapter | Select Name, Status  # adapter list
```

## Common Fixes (require user approval)

| Issue | Fix |
|---|---|
| No IP assigned | `ipconfig /release && ipconfig /renew` |
| DNS failure | Set DNS to `8.8.8.8` or `1.1.1.1` |
| Adapter stuck | `netsh winsock reset` + reboot |
| Network stack corrupt | `netsh int ip reset` + reboot |

## Safety

- **Explain impact before any network stack reset** – it may break VPN clients or custom DNS.
- Never change adapter settings without user approval.
- Prioritise non-destructive read commands first.
