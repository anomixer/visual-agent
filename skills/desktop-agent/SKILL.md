---
name: desktop-agent
description: Orchestrate multi-step desktop automation on Windows beyond install/uninstall. Use when the user requests complex workflows combining app readiness checks, data retrieval, file operations, and result delivery.
license: Proprietary
compatibility: Windows 10/11. May require Office/LibreOffice/WPS for spreadsheet tasks, and webアクセス for data fetch.
metadata:
  author: anomixer
  version: "1.0"
  tags: desktop automation computer-use xlsx office workflow
---

## Required Workflow

1. **Environment check** – verify required apps, files, permissions, and network.
2. **Handle missing dependencies** – offer the user a choice:
   - Install via existing SOP, or
   - Switch to a web-based alternative.
3. **Fetch required data** from trusted sources.
4. **Execute desktop operation** and return a verifiable result (file path, summary, screenshot ref).

## Action Protocol

```
[ACTION:OPEN_FILE file_path="C:\\path\\to\\file.xlsx"]
[ACTION:OPEN_URL url="https://..."]
[ACTION:ADD_TASK sop_id="<id>"]
[ACTION:EXECUTE_TASK task_id="<id>"]
[ACTION:COMPUTER_USE action="open_file" path="..."]
[ACTION:COMPUTER_USE action="open_url" url="..."]
[ACTION:COMPUTER_USE action="install_sop" sop_id="..."]
```

## Finance Workbook Example

For "update *.xlsx with NVIDIA latest earnings":
1. Check if Excel / LibreOffice / WPS is installed.
2. Locate the workbook (Desktop / Documents / Downloads).
3. Fetch latest NVIDIA report via SEC Company Facts API or Browser Use.
4. Write summary into the workbook via COM / OpenXML fallback.
5. Open the workbook and report the data source link.

### xlsx Access Fallback Chain
`Excel COM` → `WPS COM` → `OpenXML direct (xl/worksheets/sheet1.xml)`

## Chalkboard Output (optional)

After research or data operations, offer a Chalkboard draft:
```
##CHALKBOARD##
Title: <topic>
- <key finding 1>
- <key finding 2>
##ENDCHALKBOARD##
```

## Safety

- Never execute installation or file writes without explicit user consent.
- If the target path is missing, ask the user for the exact path; do not guess.
