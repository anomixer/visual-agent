# Current Context

- Browser tab now uses Playwright Chromium on demand instead of bundling Chromium into EXE / MSI.
- When Browser is unavailable, the UI shows a one-click action that runs `install-playwright-chromium`.
- The install workflow is SOP-based, so both npm and EXE users can repair Browser runtime after installation.
- This keeps the installer smaller and avoids long packaging times.
