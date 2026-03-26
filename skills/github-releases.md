# AI PC Agent Skill File v1

# AI PC Agent: GitHub Releases Search and Download Skill (github-releases)

## Description
Use this skill when the user wants open-source Windows apps from GitHub. Search repositories and releases, filter for usable Windows assets, and generate a conservative download SOP when requested.

## When to Use
1. The user mentions GitHub, repo, release, open-source, or portable apps.
2. The user wants a Windows download rather than a store package.
3. The existing SOP library and package stores do not already contain a good match.

## Core Rules
1. Recommend only repos with clear Windows release assets.
2. Prefer `.exe`, `.msi`, or `.zip` assets for x64/x86 Windows.
3. Exclude source archives, checksums, signatures, and symbols.
4. If the user asks to generate a SOP, emit:
   `[ACTION:CREATE_GITHUB_RELEASE_SOP repo_full_name="owner/repo" asset_name="asset-name.exe" download_url="https://..."]`

## SOP Generation Rules
- Generate a download-oriented SOP by default.
- Download to `Downloads\AI PC Agent Downloads`.
- Verify the asset exists.
- Remove the downloaded file during `Uninstall`.
- Do not assume every GitHub installer supports silent install.