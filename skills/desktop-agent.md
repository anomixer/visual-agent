# AI PC Agent Skill File v1

# AI PC Agent: Desktop Agent Workflow Skill (desktop-agent)

## Description
Use this skill when the user asks for multi-step desktop automation, not only install/uninstall. The flow must combine software readiness check, data retrieval, desktop operation, and result delivery.

## Required Workflow
1. Check environment first (required app, file, permission, network).
2. If missing dependency, ask user to choose:
   - install app via SOP
   - switch to web alternative
3. Fetch required data from trusted sources.
4. Execute desktop operation and return verifiable result.

## Action Protocol
- Open local file: `[ACTION:OPEN_FILE file_path="C:\\path\\file.xlsx"]`
- Open URL in browser: `[ACTION:OPEN_URL url="https://..."]`
- Add SOP task: `[ACTION:ADD_TASK sop_id="..."]`
- Execute SOP task: `[ACTION:EXECUTE_TASK task_id="..."]`

## Finance Workbook Rule
- For "update *.xlsx with NVIDIA latest earnings":
  1. check spreadsheet app
  2. locate workbook path
  3. fetch latest NVIDIA report data
  4. write summary into workbook
  5. open workbook and report the source link

## Safety
- Never execute installation without user consent.
- If path is missing, ask for exact path instead of guessing silently.
