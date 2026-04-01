# AI PC Agent Skill File v1

# VM Sandbox Orchestration Skill

## Use When
- Task should run isolated from host environment.
- User asks to test unknown installer, risky script, or compatibility matrix.

## Workflow
1. Check whether VirtualBox (or equivalent) is available.
2. If missing, suggest install via SOP.
3. Prepare VM sandbox before Computer Use actions.
4. Run workload in VM, collect outcome summary for host.

## Policy
- VM-first for high-risk or untrusted software tasks.
