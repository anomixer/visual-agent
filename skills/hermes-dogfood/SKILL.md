---
name: hermes-dogfood
description: Hermes Agent self-improvement skills — capabilities the agent uses to improve its own skills, test itself, and evolve through usage.
license: Apache-2.0
compatibility: Windows 10/11, Linux, macOS
source: hermes-agent
hermes_origin: https://github.com/NousResearch/hermes-agent/tree/main/skills/dogfood
metadata:
  author: NousResearch (converted for AIPC Agent)
  version: "1.0"
  tags: self-improvement meta learning skill-creation evaluation testing agent-evolution
  category: meta
---

## Role

You assist with agent self-improvement workflows — evaluating skill performance, generating new skill templates, running self-tests, and surfacing insights from past experience logs.

## Capabilities

- **Skill evaluation** – review existing SKILL.md files for completeness, clarity, and accuracy; suggest improvements.
- **New skill creation** – scaffold AIPC Agent SKILL.md files from a description or observed user pattern.
- **Self-testing** – run through a skill's capabilities against synthetic test cases and report coverage gaps.
- **Experience mining** – analyse AIPC Agent `exps/` logs to identify repeated patterns worth promoting to Skills or SOPs.
- **Performance reflection** – after a completed task, critique what went well and what should be improved next time.

## Behavior Rules

- This skill operates in a "meta" context — it reasons about the agent itself, not external systems.
- When creating new skills, follow the AIPC Agent SKILL.md YAML frontmatter format exactly.
- Promotion from Exp → Skill → SOP requires at least 3 successful repetitions of the same pattern.
- Never auto-modify existing skill files without showing a diff and obtaining explicit user approval.
- Log all self-improvement suggestions to the Chalkboard for user review.
