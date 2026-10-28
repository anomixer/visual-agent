# Visual Agent Beta

> Current version: **2026.8.7** · Website: https://anomixer.github.io/visual-agent/

> [!NOTE]
> **This program is currently recommended as a public preview release candidate.** It already handles the main local Agent workflow, but it can still fail because of the model, Browser runtime, Windows permissions, or network state. Please confirm the task details before making system changes.

> A visual, sketchable, collaborative AI assistant
> by [anomixer](https://github.com/anomixer)

[![Node.js](https://img.shields.io/badge/Node.js-18%2B-brightgreen)](https://nodejs.org/)
[![Ollama](https://img.shields.io/badge/Ollama-0.17%2B-blue)](https://ollama.com/)
[![Platform](https://img.shields.io/badge/Platform-Windows%2010%2F11-0078D4)](https://www.microsoft.com/windows)

中文版本: [README.md](./README.md)

---

## What is this?

**Visual Agent** is a Windows system automation assistant that runs locally and combines safety awareness with self-improvement. We replaced the high-risk operations and plain interface of traditional command-line (CLI) Agents with a **pure GUI** visual control center instead.

It does not just automate setup, monitoring, and repair for your PC through intuitive conversation and Standard Operating Procedures (SOPs); it also offers the following advantages:

- **🌐 Double Agent Mode**: Connect two physical PCs through a dedicated communication protocol, with the local AI answering first and the remote AI adding follow-up context, making multi-machine collaboration and management easy. Or ask a remote friend and AI to help you solve computer problems together.
- **🎨 Interactive Chalkboard sharing**: Built-in chalk canvas with multimodal visual understanding. During remote connections, live chalkboard snapshots can be shared immediately, and drawings, images, and annotations can help the AI understand and provide precise suggestions.
- **📊 Circular Gauge hardware monitoring**: Real-time detection of CPU, GPU, RAM, and Disk, plus plugin-based precise monitoring of NVIDIA GPU temperature, VRAM, and live load.
- **🔍 Browser Use for live web research**: When local knowledge is insufficient, the AI can automatically call Browser Use to search, extract source page text, and organize the answer, supporting current information such as weather, news, and the latest stock prices.
- **⚡ Two-way automated software management**: Integrates winget, Microsoft Store, and GitHub Releases to build a fault-tolerant SOP pipeline for common tools such as Chrome, Steam, and Office.
- **⚗️ Integrated 19 Hermes Agent domain knowledge packs**: Combines 19 domain-specific Skills from the professional Hermes Agent by NousResearch. They are injected dynamically during AI conversations, covering deep background such as Data Science, DevOps, Red Teaming, and autonomous agents, so answers are more informed.
- **🛡️ Consent-before-action safety guard**: Before the AI performs any system changes such as installs or setting modifications, it first adds the action to the pending task list and waits for the user to confirm it manually, preventing unattended automatic changes and potential risk.
- **🧠 Experience learning and self-improvement**: Every task outcome is stored in the local experience base (Exp). The AI reads it automatically, masks sensitive information, and proactively avoids the same pitfalls in similar future tasks, enabling continuous software-level improvement.

```text
You say: “Remove Copilot for me”
It becomes: create a task -> show a suggested action button -> you confirm -> elevate and run the SOP -> modify system settings -> verify the result -> write to the experience base
```

---

## Feature overview

| Feature | Description |
|------|------|
| Recommendation list | Common system optimization and installation items; supports search, add task, and immediate execution |
| SOP list | Switch the left panel to view all SOPs; supports search by name, ID, category, and direct execution |
| Work list | Shows task status, progress, and results; supports JSON export/import |
| AI chat | Supports Ollama, local OpenAI-compatible API, and cloud providers |
| Provider settings | Configure Provider, Base URL, API Key, OAuth 2.0, and model name |
| Safe interaction | Uses consent-before-action; suggest first, execute only after user confirmation |
| Work log | Shows SOP execution output in real time; progress messages update in place |
| Experience base | Automatically accumulates task experience summaries; supports search, SOP filtering, and veteran notes |
| Chalkboard | The center board supports chalk drawing, local erasing, shapes, image placement, text boxes, and PNG export |
| Hardware monitoring | Displays CPU, GPU, RAM, Disk, and NVIDIA GPU temperature information |
| Plugin system | Extend system monitoring with `.js` files |
| Auto initialization | First run can automatically install Ollama and the default model |
| Tauri packaging | Can be packaged into a standalone Windows EXE with the Node backend bundled as a sidecar |

---

## Security and data-operation behavior

- **The local API is locked to this machine**: the HTTP API binds only to `127.0.0.1` and checks Host, Origin, and a random per-process local API token. A cross-origin web page cannot directly call local SOP / PowerShell APIs.
- **AI-proposed system changes require exact confirmation**: the backend retains the original ACTION. Approval is bound to that action, its resolved SOP operation, and the chat session; it expires after five minutes and can be consumed only once. Safety is not merely a frontend-hidden button. The confirmation shows the full command and the install/uninstall target, and the approved action cannot be replaced by confirmation text or a later loop turn.
- **Every Agent Loop turn passes through consent**: system-changing actions discovered in later tool turns become pending approvals instead of executing automatically. Unknown or prefixed commands such as `BROWSER_USE_EXTRA` never reach a real execution branch.
- **External content is untrusted by default**: Markdown from the AI, remote peers, and the experience base passes through a shared sanitizer. If sanitization is unavailable or fails, the UI falls back to escaped text. Server-side text fetching also restricts public URLs, revalidates DNS / redirects, and enforces time and size limits.
- **Chat and Agent Loop share one budget and can be stopped**: each chat request shares 8 turns, 12 tool calls, and a 180-second deadline covering first-turn ACTIONs, automatic current-info search / extraction, loop tools, and LLM calls; duplicate actions do not rerun, and actions awaiting confirmation do not spend tool calls. Stopping chat aborts the LLM / streaming request, searches, extraction, and further tools; a Playwright navigation already in flight may still wait for its own timeout. Early-return specialized workflows (manual Browser Use, finance workbook, game research) also stop, but still use their own timeouts.
- **Local chats stay isolated**: when you switch local chat tabs, in-flight replies, errors, and confirmation results are written back only to the originating tab. Pending confirmation buttons are stored with their messages, reappear after switching back, and cannot be submitted twice before the request settles.
- **Backup and restore are repeatable**: they use non-destructive copying rather than `/MIR`, so extra destination files are not deleted. Verification checks each relative path and file size. These SOPs do not offer an “uninstall” action that deletes backup or restored data.
- **Task data has basic safeguards**: task IDs use UUIDs, the list is persisted with a temporary file plus rename, running tasks cannot be deleted, and the list cannot be replaced by a bulk import while work is running. While another task is running, pending, succeeded, or failed tasks can still be removed; clearing the whole list is refused whenever any task is running.

> This is still a preview: process-tree timeout after UAC elevation, two-PC Chalkboard ordering / reconnection, Vision Models, whether early-return specialized workflows join the shared budget, aborting a Playwright navigation already in flight, and the latest build on a clean Windows installation each require separate real-machine validation or further work. Unit tests alone do not prove those scenarios pass.

---

## Requirements

| Item | Requirement |
|------|------|
| OS | Windows 10 / 11 |
| Node.js | 18 or later |
| Ollama | Optional, if you want local LLM chat |
| Permissions | Some SOPs require administrator rights and will trigger UAC |

> If you only use the recommendation list and task manager, you do not necessarily need Ollama installed first.

---

## Quick start

If you only want to try it quickly, use the release build:

1. Download the latest Windows `setup.exe` from GitHub Releases.
2. Run the installer to complete setup.
3. Double-click the `Visual Agent` executable.
4. The first launch will automatically complete environment checks and initialization.

If you want to run from source:

### 1. Clone the project

```bash
git clone https://github.com/anomixer/visual-agent.git
cd visual-agent
```

### 2. Install dependencies

```powershell
npm install
```

If PowerShell blocks script execution:

```powershell
powershell -ExecutionPolicy Bypass -Command "npm install"
```

If `npm audit` or `npm install` returns `ENOTCACHED` / `only-if-cached`:

```powershell
setx npm_config_offline false
```

### 3. Start the dev server

```powershell
npm start
```

### 4. Open the UI

```text
http://localhost:3210
```

---

## Interface guide

After the first launch, start here:

- Use the bottom-right corner to switch languages.
- Use the top-right area to set the AI provider and model.
- Once that is done, you can chat with the AI in the panel on the right.
- The center Chalkboard lets you sketch and attach photos for AI recognition.
- If you need Browser research, go to `View -> Browser -> Install`.
- If you need to install or maintain a PC, check the recommendation list and SOP list on the left. Click `+` to add a task, or `Play` to execute it directly.
- If you want to connect with a friend, click Remote AI in the top-right corner, then enter the other side’s IP address.
- After connecting, you can tag your own AI or the remote AI and ask it to help or reply.
- There are many more interesting features, so feel free to explore.

---

## AI chat and providers

### Local Ollama

The system can automatically detect whether Ollama exists. If it is missing, it can be installed through the built-in SOP, and the default model `gemma4:e2b-it-qat` will be downloaded. When the UI shows `AI ready`, you can start typing requests directly in the chat area on the right.

### Other providers

- OpenAI, Groq, DeepSeek, Mistral, Together AI, and Gemini use the OpenAI-compatible flow.
- Gemini can use Google’s OpenAI-compatible entry point.
- Anthropic Claude uses native authentication and native `/v1/messages`.
- Customer Provider supports API Key and OAuth 2.0 Client Credentials.

### Browser runtime

- The Browser tab uses Playwright Chromium.
- Browser runtime readiness is verified by `/api/meta.browserExecutable`, which accepts `chrome-headless-shell.exe` or `chrome.exe` from the Playwright cache.
- If Browser is unavailable on first launch, run the `install-playwright-chromium` SOP to install it.
- This avoids bundling Chromium into the MSI / EXE and keeps the installer smaller.

---

## Package as EXE

Developers can run [build.bat](./build.bat) directly:

```cmd
build.bat
```

This script installs the required environment and builds the Tauri desktop app. The output is located at:

```text
src-tauri\target\release\bundle\nsis\
```

- The Tauri bundle version matches `package.json`, with an incremental CSP that remains compatible with the existing inline resources.
- The Node sidecar's `pkg.assets` includes SOPs, Skills, Plugins, and public files; Chromium is still excluded from the installer.
- After changing release settings, rebuild and validate on clean Windows. `npm test` alone does not prove that the EXE works.

### Browser plugin install

- When the “Browser” tab shows “Browser unavailable,” click the button to run the `install-playwright-chromium` single-purpose SOP.
- Before Chromium is installed, the “Browser” tab stays hidden in the center area and appears only after installation completes.
- After installation, the application only accepts the self-managed Visual Agent browser runtime under `%APPDATA%\visual-agent\playwright-browsers`, and then automatically shows the “Browser” tab. This avoids confusing it with browsers from the system-wide Playwright cache, such as `%LOCALAPPDATA%\ms-playwright`.

---

## Built-in SOPs

| SOP | Description | Requires admin |
|-----|------|-----------|
| `install-ollama` | Silently download and install Ollama | Yes |
| `pull-llm-model` | Download the default LLM model | No |
| `install-chrome` | Silently install the latest Google Chrome | Yes |
| `remove-copilot` | Disable and remove Windows Copilot | Yes |
| `backup-system` | Create a Windows restore point | Yes |
| `backup-user-files` | Back up user files with repeatable, non-destructive copying | Yes |
| `restore-user-files` | Restore user files with per-file verification | Yes |
| `install-office` | Install LibreOffice through Winget | Yes |
| `install-steam` | Silently install Steam | Yes |
| `install-winhance` | Install the WinHance Windows optimization utility | Yes |
| `check-drivers` | Trigger Windows Update and driver scanning | Yes |
| `install-language-en-us` | Install the English language pack while keeping the existing language list | Yes |
| `install-language-zh-tw` | Install the Traditional Chinese language pack while keeping the existing language list | Yes |
| `install-language-zh-cn` | Install the Simplified Chinese language pack while keeping the existing language list | Yes |
| `install-language-ja` | Install the Japanese language pack while keeping the existing language list | Yes |

---

## File format specification

- `skills/<slug>/SKILL.md`
  The first line must be `---`, followed by `name: <slug>`, and the file should follow the [agentskills.io](https://agentskills.io) format.
- `sops/<slug>/SOP.md`
  The first line must be `# Visual Agent SOP File v1`
- `exps/exp-yyyymmdd.md`
  The first line must be `# Visual Agent Experience Log - yyyymmdd`
- `plugins/*.js`
  The first line must be `// Visual Agent Plugin File v1`

---

## Custom SOPs

Put `SOP.md` into the development directory `sops/<slug>/`, or into the runtime directory `%APPDATA%\visual-agent\sops\<slug>\`. Example:

````markdown
# Visual Agent SOP File v1

1. Basic information (Metadata)
ID: my_sop_id
Name: My custom SOP
Category: Tools
Risk level: Low

2. Prerequisites
OS: Windows 10 / 11
Permissions: Standard user
Network: No

3. Execution steps

First phase: environment check (Check)
Instruction (PowerShell):
```powershell
$false
```

Second phase: install (Install)
Instruction (PowerShell):
```powershell
Write-Host "Running..."
```

Third phase: verify (Verify)
Instruction (PowerShell):
```powershell
$true
```
````

After refreshing the page, the system rescans and loads the new SOP.

---

## winget store recommendations

When the user asks for software recommendations and no existing SOP directly matches, the AI first queries winget store candidates and then lists the recommended names.

- If the user only wants recommendations, the AI replies with the recommendation list directly.
- If the user specifies a particular piece of software, the AI can generate the corresponding SOP directly.
- Newly generated SOPs are written to `%APPDATA%\visual-agent\sops\`
- After generation, the left-side `SOP list` refreshes automatically

### Microsoft Store / UWP

- If the user explicitly mentions `Microsoft Store`, `UWP`, or `store version`, the AI prioritizes the `msstore` source for search.
- A corresponding SOP can be created from the result, and installation / removal uses `winget --source msstore`.

### GitHub Releases

- If the user explicitly wants to find a Windows app on `GitHub`, the AI searches the repository and release assets.
- Only candidates with explicit Windows `.exe` / `.msi` / `.zip` release assets are selected.
- If an SOP is created, the default is a “download SOP”: download to `Downloads\Visual Agent Downloads`, with support for verification and cleanup of the downloaded file.

---

## Project structure

```text
visual-agent/
├── public/
│   ├── index.html
│   ├── style.css
│   ├── app.js
│   └── ui-security.js
├── src/
│   ├── agent/
│   │   ├── actions.js
│   │   ├── consent.js
│   │   ├── loop-budget.js
│   │   ├── prompts.js
│   │   └── sop-templates.js
│   ├── llm/
│   │   └── protocol.js
│   ├── index.js
│   ├── llm.js
│   ├── local-api-security.js
│   ├── native-dialogs.js
│   ├── oauth-token-cache.js
│   ├── pure.js
│   ├── remote-agent.js
│   ├── safe-fetch.js
│   ├── server.js
│   ├── sop-executor.js
│   ├── sop-parser.js
│   └── system.js
├── plugins/
│   ├── hardware-info.js
│   └── temperature-monitor.js
├── skills/
│   ├── [Visual Agent Native × 18]
│   │   ├── app-install-and-repair/SKILL.md
│   │   ├── backup-restore/SKILL.md
│   │   ├── browser-research-and-edit/SKILL.md
│   │   ├── desktop-agent/SKILL.md
│   │   ├── developer-tools-assistant/SKILL.md
│   │   ├── game-research/SKILL.md
│   │   ├── github-releases/SKILL.md
│   │   ├── manager/SKILL.md
│   │   ├── media-editing-assistant/SKILL.md
│   │   ├── microsoft-store/SKILL.md
│   │   ├── office-excel-assistant/SKILL.md
│   │   ├── ollama/SKILL.md
│   │   ├── photoshop-workflow/SKILL.md
│   │   ├── virtualization-sandbox/SKILL.md
│   │   ├── windows-network-troubleshoot/SKILL.md
│   │   ├── windows-printer-troubleshoot/SKILL.md
│   │   ├── windows-storage-recovery/SKILL.md
│   │   └── winget-store/SKILL.md
│   └── [From Hermes Agent × 19]
│       ├── hermes-apple/SKILL.md
│       ├── hermes-autonomous-ai-agents/SKILL.md
│       ├── hermes-creative/SKILL.md
│       ├── hermes-data-science/SKILL.md
│       ├── hermes-devops/SKILL.md
│       ├── hermes-dogfood/SKILL.md
│       ├── hermes-email/SKILL.md
│       ├── hermes-github/SKILL.md
│       ├── hermes-index-cache/SKILL.md
│       ├── hermes-media/SKILL.md
│       ├── hermes-mlops/SKILL.md
│       ├── hermes-note-taking/SKILL.md
│       ├── hermes-productivity/SKILL.md
│       ├── hermes-red-teaming/SKILL.md
│       ├── hermes-research/SKILL.md
│       ├── hermes-smart-home/SKILL.md
│       ├── hermes-social-media/SKILL.md
│       ├── hermes-software-development/SKILL.md
│       └── hermes-yuanbao/SKILL.md
├── sops/
│   ├── backup-system/SOP.md
│   ├── backup-user-files/SOP.md
│   ├── check-drivers/SOP.md
│   ├── install-chrome/SOP.md
│   ├── install-language-en-us/SOP.md
│   ├── install-language-ja/SOP.md
│   ├── install-language-zh-cn/SOP.md
│   ├── install-language-zh-tw/SOP.md
│   ├── install-office/SOP.md
│   ├── install-ollama/SOP.md
│   ├── install-playwright-chromium/SOP.md
│   ├── install-steam/SOP.md
│   ├── pull-llm-model/SOP.md
│   ├── remove-copilot/SOP.md
│   └── restore-user-files/SOP.md
├── src-tauri/
├── agents.md
├── spec.md
├── build.bat
├── package.json
└── verify-remove-copilot.ps1
```

---

## Development log

The complete version history and development record are centralized in [agents.md](./agents.md). The README keeps installation, usage, and project structure notes so the main document is not diluted by a history log.

---

## FAQ

**Q: PowerShell says `scripts is disabled`?**

```powershell
powershell -ExecutionPolicy Bypass -Command "npm install"
powershell -ExecutionPolicy Bypass -Command "npm run start"
```

**Q: Why do some SOPs trigger a UAC window?**
Because those SOPs require administrator privileges. The install stage now uses a shared elevation flow automatically; if the user cancels UAC, the task fails immediately.

**Q: Why didn’t the new SOP appear after I added it?**
Make sure the file is placed at `sops/<slug>/SOP.md` or `%APPDATA%\visual-agent\sops\<slug>\SOP.md`, then refresh the page.

**Q: Why is the AI indicator red or yellow?**
It usually means Ollama is not installed, not started, or the model download has not finished.

**Q: The AI can’t understand the attached Chalkboard image?**
The Chalkboard attachment is sent as a cropped PNG. If the current text model cannot recognize images, the system will explicitly say “image received.” Please choose a Vision Model that supports images in settings and send it again; if it still fails, add the key text or use clearer handwriting / screenshots.

**Q: `npm start` immediately returns to the prompt?**
Usually `3210` or `19168` is already occupied by another Visual Agent process. The startup flow now shows the occupied PID. Close the old process first, or just use the already running `http://localhost:3210`.

**Q: How do I report an issue?**
Open “Help → Diagnostics” in the title bar, copy the diagnostic summary, and include it together with the steps you took and the tail of the debug log.

**Q: Can another LAN device or a malicious web page call the local API directly?**
Other LAN devices cannot reach an API bound only to `127.0.0.1`. Local malicious web pages are additionally blocked by Host / Origin checks and the per-process token. Double Agent Mode uses a separate peer-to-peer TCP protocol with connection approval, not this HTTP API.

**Q: Can AI or remote-peer content execute web markup in the UI?**
Content passes through a shared DOMPurify safety boundary that removes scripts, event handlers, and dangerous URIs. If the sanitizer is missing or fails, the UI renders escaped text instead of inserting the original HTML.

**Q: How do I run tests and dependency audits?**
Run `npm test` for syntax checks, `test/*.test.js` unit / Windows behavior tests, and the server smoke test (`/api/meta`, `/api/diagnostics`, token enforcement, and cross-origin rejection). Run `npm audit --omit=dev` for production dependencies. These do not replace UAC, two-PC, Vision, or clean-EXE validation.

---

## Contribute

Everyone is welcome to contribute ideas, fixes, and new feature proposals.

This project is intentionally experimental, and many of its design choices explore new collaboration styles and interaction patterns, such as:

- Two-person collaboration / Double Agent Mode
- Chalkboard collaboration
- SOP / Skills automation flows
- Live queries, Agent Loop, Browser Use
- Any UI / workflow you think would feel smoother or more fun

If you have a better approach, feel free to open an issue, submit a PR, or share your idea for discussion first. We welcome help pushing this project toward something more interesting and more practical.

---

## Development notes

- Development log: [agents.md](./agents.md)
- Product spec: [spec.md](./spec.md)
- Current package version: `2026.8.7`
