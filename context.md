# Current Context

- Browser tab now uses Playwright Chromium on demand instead of bundling Chromium into EXE / MSI.
- When Browser is unavailable, the UI shows a one-click action that runs `install-playwright-chromium`.
- The install workflow is SOP-based, so both npm and EXE users can repair Browser runtime after installation.
- This keeps the installer smaller and avoids long packaging times.

- Browser tab is hidden until Playwright Chromium is installed; the View menu shows Browser (»Ý¦w¸Ë) and can trigger the install SOP.

- Browser status now depends on the actual chrome-headless-shell.exe existing in the Playwright browser cache. If it is present, the Browser tab should appear without restarting.

- Agent flow is now Planner -> Builder -> Learn.
- Exp is the memory layer for self-improvement; use it to record outcomes and upgrade recurring patterns into Skills / SOPs.
- Skills and SOPs should be loaded on demand only, not fully preloaded into context.
