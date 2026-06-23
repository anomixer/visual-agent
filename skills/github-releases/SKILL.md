---
name: github-releases
description: Search GitHub repositories for Windows release assets and generate a download SOP. Use when the user wants open-source Windows apps from GitHub, mentions a repo, or asks for portable/installer downloads not available in winget/MS Store.
license: Proprietary
compatibility: Requires internet access and Browser Use capability.
metadata:
  author: anomixer
  version: "1.0"
  tags: github releases download portable exe msi open-source
---

## When to Use

1. The user mentions GitHub, a specific repo, "release", "open-source", or "portable app".
2. The user wants a Windows download not available in winget or Microsoft Store.
3. The existing SOP library does not already cover the request.

## Core Rules

1. **Only recommend repos with clear Windows release assets** (`.exe`, `.msi`, `.zip` for x64/x86).
2. Exclude source code archives, checksums (`.sha256`), signatures (`.sig`), and symbol files.
3. Prefer the **latest stable release** over pre-releases unless the user requests otherwise.
4. Check the repo's `README` for Windows compatibility before recommending.

## Browser Use Actions

```
[ACTION:BROWSER_USE action="search" query="<app> github release windows exe"]
[ACTION:BROWSER_USE action="open" url="https://github.com/<owner>/<repo>/releases/latest"]
```

## SOP Generation

When the user wants a repeatable download workflow, emit:
```
[ACTION:CREATE_GITHUB_RELEASE_SOP repo_full_name="owner/repo" asset_name="asset.exe" download_url="https://github.com/.../releases/download/..."]
```

## SOP Generation Rules

- Default download destination: `Downloads\Visual Agent Downloads`.
- Include `Check` (asset exists), `Install` (download), `Verify` (file hash or launch), `Uninstall` (delete downloaded file).
- **Do not assume silent install support** – many GitHub releases are interactive installers.
