# AI PC Agent Skill File v1

# Application Install and Repair Skill

## Use When
- User requests install/update/uninstall/repair any desktop application.
- User reports app launch failure, dependency missing, version conflict.

## Workflow
1. Check if matching SOP exists.
2. If SOP exists: add task, explain risk, wait for approval, execute.
3. If SOP missing: search trusted source (winget/msstore/github release).
4. Create SOP when user confirms repeated use.
5. Verify executable/service/version after install.

## Notes
- Prefer silent install when safe.
- Uninstall path should include residual cleanup only with consent.
