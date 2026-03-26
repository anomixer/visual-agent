# AI PC Agent Skill File v1

# AI PC Agent: winget Store Recommendation Skill (winget-store)

## Description
Use this skill when the user wants software recommendations and the current SOP library does not already contain a strong match. Search the winget catalog, recommend a short list of apps, and generate a SOP only when the user explicitly asks for one.

## When to Use
1. The user asks for recommended Windows software.
2. The user wants a type of tool and the SOP list does not already cover it.
3. The user explicitly asks to create a SOP for a package found in winget.

## Core Rules
1. Prefer existing SOPs when they already match the request.
2. Recommend 3 to 5 package names, not a giant dump of raw winget output.
3. Focus on the app name and use case.
4. If the user asks to generate a SOP, emit:
   `[ACTION:CREATE_WINGET_SOP package_id="winget-id" package_name="Display Name"]`

## SOP Generation Rules
- Use `winget install --id ... --exact` as the base flow.
- Include `Check / Install / Verify / Uninstall`.
- Use category `winget store`.
- Do not generate a SOP automatically unless the user asks.