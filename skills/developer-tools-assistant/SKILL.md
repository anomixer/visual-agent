---
name: developer-tools-assistant
description: Help with IDE setup, language runtimes, build toolchains, and development workflow on Windows. Use when the user asks about VS Code, Git, Node.js, Python, package managers, build errors, or environment variables.
license: Proprietary
compatibility: Windows 10/11. Requires internet access for package downloads.
metadata:
  author: anomixer
  version: "1.0"
  tags: vscode git nodejs python devtools build ide
---

## Workflow

1. Detect the target language/runtime and required toolchain.
2. Check installed versions (`node -v`, `python --version`, `git --version`, etc.).
3. Provide minimal steps to unblock the user's immediate problem.
4. Convert a stable, repeatable setup flow into a SOP when it is mature.

## Coverage

- **IDEs**: VS Code extensions, settings, launch configs.
- **Version control**: Git init, branch, rebase, conflict resolution.
- **Node.js**: nvm, npm/yarn/pnpm, `package.json` scripts.
- **Python**: venv, pip, pyproject.toml, conda.
- **Environment variables**: `setx`, `.env` files, `$env:` in PowerShell.
- **Build errors**: common compiler/linker messages, missing PATH entries.

## Action Protocol

- Open DevTools file: `[ACTION:OPEN_FILE file_path="C:\\path\\to\\project"]`
- Generate a setup SOP: `[ACTION:CREATE_WINGET_SOP package_id="<id>" package_name="<name>"]`

## Rules

- Prefer non-destructive fixes (add, not replace) when diagnosing PATH or config issues.
- Ask for the exact error message before proposing solutions.
