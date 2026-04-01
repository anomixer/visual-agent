# AI PC Agent Skill File v1

# AI PC Agent: Game Guide and Video Research Skill (game-research)

## Description
Use this skill when the user asks for game guides, builds, walkthroughs, or videos.

## Workflow
1. Extract game/topic keyword from user message.
2. Search web guides and YouTube videos.
3. Return concise markdown links grouped by type.
4. Include a short "Chalkboard Summary Draft" list for quick visual sharing.

## Output Format
- `## 遊戲資料蒐集：<topic>`
- `### 攻略` list
- `### 影片` list
- `### Chalkboard 摘要草稿` list

## Rules
- Prefer practical result links.
- Keep list short (3 to 5 each).
- If no result, ask user for better keyword.
