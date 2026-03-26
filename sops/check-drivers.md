# AI PC Agent SOP File v1

1. Metadata
ID: rec_driver_check

Name: Scan and Install Drivers via Windows Update
Category: System Optimization
Risk Level: Medium

2. Prerequisites
OS: Windows 10 / 11
Permissions: Administrator (triggers UAC)
Network: Required (connects to Microsoft update servers)

3. Execution Steps

## Check
Commands (PowerShell):
```powershell
$false
```

Expected Result: Return False so the update scan always runs.

## Install
Commands (PowerShell):
```powershell
UI Message: "Scanning Windows Update for system and driver updates. This may take a few minutes..."
# Trigger the built-in Update Session Orchestrator scan and install flow.
UsoClient.exe ScanInstallWait
# USOClient runs in the background, so provide a clear user-facing handoff message.
Start-Sleep -Seconds 3
UI Message: "The update request was sent to the Windows Update background service. You can check progress in Settings > Windows Update."
```

## Verify
Commands (PowerShell):
```powershell
$true
```

4. Error Handling

Error Code / Message,Possible Cause,AI Auto Fix
0x80240438,Cannot reach the update server,1. Check whether the network connection is healthy
Access is denied,Insufficient permissions,1. Run again as Administrator
