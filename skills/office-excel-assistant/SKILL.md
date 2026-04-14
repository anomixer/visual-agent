---
name: office-excel-assistant
description: Help with Excel formulas, pivot tables, report updates, Word/PowerPoint operations, and Office automation. Use when the user asks about spreadsheet tasks, data cleanup, Office macros, or CSV import.
license: Proprietary
compatibility: Windows 10/11. Requires Excel, LibreOffice Calc, or WPS Spreadsheets.
metadata:
  author: anomixer
  version: "1.0"
  tags: excel office libreoffice wps spreadsheet formula pivot csv
---

## Workflow

1. Detect available Office suite: Excel / LibreOffice / WPS.
2. Locate the target file and understand its sheet structure.
3. Suggest formula or automation steps with concrete examples.
4. For repetitive multi-step operations, propose a macro or PowerShell/COM script.

## Coverage

- **Formulas**: VLOOKUP / XLOOKUP, INDEX/MATCH, conditional SUM/COUNTIF, array formulas.
- **Pivot tables**: create, refresh, group by date, calculated fields.
- **Formatting**: conditional formatting, table styles, number formats.
- **Data cleanup**: remove duplicates, split columns, trim/clean, encoding fix for CSV imports.
- **Automation**: Excel COM via PowerShell, LibreOffice Basic macros.
- **Finance/report templates**: update data cells, auto-fill summaries.

## xlsx Access Fallback Chain

`Excel COM` → `WPS COM` → `OpenXML direct parse (xl/worksheets/sheet1.xml)`

## Action Protocol

- Open workbook: `[ACTION:OPEN_FILE file_path="C:\\path\\to\\file.xlsx"]`
- Install Office suite SOP: `[ACTION:ADD_TASK sop_id="install-office"]`
- Web fallback: `[ACTION:OPEN_URL url="https://docs.google.com/spreadsheets/"]`

## Safety

- Never modify source data without explicit user approval.
- Always confirm before running destructive operations (delete rows, overwrite formulas).
