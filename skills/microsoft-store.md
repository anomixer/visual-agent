# AI PC Agent Skill File v1

# AI PC Agent: Microsoft Store / UWP Recommendation Skill (microsoft-store)

## Description
Use this skill when the user explicitly wants Microsoft Store, UWP, or Store-style apps. Search `msstore`, recommend suitable apps, and generate a SOP only when requested.

## When to Use
1. The user mentions Microsoft Store, Windows Store, msstore, UWP, or Store apps.
2. The user wants apps that fit a Store-first installation flow.
3. The existing SOP library does not already contain a good match.

## Core Rules
1. Prefer existing SOPs if they already solve the request.
2. Search through `winget --source msstore` instead of the default winget source.
3. Recommend 3 to 5 clear candidates.
4. If the user asks to generate a SOP, emit:
   `[ACTION:CREATE_MSSTORE_SOP package_id="msstore-id" package_name="Display Name"]`