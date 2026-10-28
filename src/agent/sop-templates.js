/**
 * SOP markdown builders and GitHub release asset ranking.
 * Pure string/scoring helpers only — filesystem writes stay in server.js.
 */
'use strict';

const { slugifyWingetPackage, escapeRegExp } = require('../pure');

function buildWingetSopMarkdown(packageInfo = {}) {
    return buildStoreSopMarkdown(packageInfo, {
        source: 'winget',
        category: 'winget store',
        titleVerb: 'Install',
    });
}

function pickBestGitHubAsset(releases = []) {
    const candidates = [];
    releases.forEach((release) => {
        const releaseTag = release?.tag_name || '';
        const assets = Array.isArray(release?.assets) ? release.assets : [];
        assets.filter(isUsefulGitHubAsset).forEach((asset) => {
            candidates.push({
                tagName: releaseTag,
                assetName: asset.name,
                downloadUrl: asset.browser_download_url,
                size: asset.size,
                score: scoreGitHubAsset(asset),
            });
        });
    });
    return candidates.sort((a, b) => b.score - a.score)[0] || null;
}

function scoreGitHubAsset(asset = {}) {
    const name = String(asset?.name || '').toLowerCase();
    let score = 0;
    if (/\.(msi|exe|zip)$/.test(name)) score += 10;
    if (/(win(dows)?|x64|amd64|x86|portable)/.test(name)) score += 8;
    if (/arm64/.test(name)) score -= 6;
    if (/setup|installer/.test(name)) score += 3;
    if (/portable/.test(name)) score += 2;
    if (/source[\s._-]*code|sha|checksum|sig|symbols|debug/.test(name)) score -= 10;
    return score;
}

function buildGitHubReleaseSopMarkdown(packageInfo = {}) {
    const repoFullName = String(packageInfo.fullName || packageInfo.repoFullName || '').trim();
    const repoName = String(packageInfo.name || repoFullName.split('/').pop() || 'GitHub App').trim();
    const assetName = String(packageInfo.assetName || 'release.zip').trim();
    const downloadUrl = String(packageInfo.downloadUrl || '').trim();
    const tagName = String(packageInfo.tagName || '').trim();
    const slug = slugifyWingetPackage(repoFullName || repoName);
    const assetSlug = slugifyWingetPackage(assetName);
    const sopId = `github_${slug}_${assetSlug}`;
    const escapedUrl = downloadUrl.replace(/'/g, "''");
    const escapedAssetName = assetName.replace(/'/g, "''");
    const extractDirName = assetSlug || 'app';
    return `# Visual Agent SOP File v1
1. Metadata
ID: ${sopId}

Name: Download ${repoName} from GitHub
Category: github releases
Risk Level: Medium
2. Prerequisites
OS: Windows 10 / 11
Permissions: Standard User
Network: Required (download from GitHub Releases)
3. Execution Steps
## Check
Expected Result: Return True when the release asset already exists in the managed download folder.
\`\`\`powershell
try {
    $baseDir = Join-Path $env:USERPROFILE 'Downloads\\Visual Agent Downloads'
    $assetPath = Join-Path $baseDir '${escapedAssetName}'
    if (Test-Path $assetPath) { $true } else { $false }

} catch {
    $false
}


\`\`\`
## Install
\`\`\`powershell
Write-Host "Downloading ${repoName} from GitHub Releases. Please wait..."
$baseDir = Join-Path $env:USERPROFILE 'Downloads\\Visual Agent Downloads'
if (-not (Test-Path $baseDir)) {
    New-Item -ItemType Directory -Path $baseDir -Force | Out-Null
}


$assetPath = Join-Path $baseDir '${escapedAssetName}'
Invoke-WebRequest -Uri '${escapedUrl}' -OutFile $assetPath -UseBasicParsing
if (-not (Test-Path $assetPath)) {
    throw "Download failed: ${assetName}"
}


if ($assetPath -like '*.zip') {
    $extractDir = Join-Path $baseDir '${extractDirName}'
    if (Test-Path $extractDir) {
        Remove-Item -Path $extractDir -Recurse -Force -ErrorAction SilentlyContinue
    }


    Expand-Archive -Path $assetPath -DestinationPath $extractDir -Force
}


\`\`\`
## Verify
\`\`\`powershell
try {
    $baseDir = Join-Path $env:USERPROFILE 'Downloads\\Visual Agent Downloads'
    $assetPath = Join-Path $baseDir '${escapedAssetName}'
    if (-not (Test-Path $assetPath)) {
        throw "Downloaded asset not found: ${assetName}"
    }


    $true
} catch {
    $false
}


\`\`\`
## Uninstall
\`\`\`powershell
Write-Host "Removing downloaded ${repoName} release asset..."
$baseDir = Join-Path $env:USERPROFILE 'Downloads\\Visual Agent Downloads'
$assetPath = Join-Path $baseDir '${escapedAssetName}'
$extractDir = Join-Path $baseDir '${extractDirName}'
if (Test-Path $assetPath) {
    Remove-Item -Path $assetPath -Force -ErrorAction Stop
}


if (Test-Path $extractDir) {
    Remove-Item -Path $extractDir -Recurse -Force -ErrorAction SilentlyContinue
}


\`\`\`
4. Error Handling
Error Code / Message,Possible Cause,AI Auto Fix
404 / Not Found,GitHub release asset no longer exists,1. Search repository releases again 2. Regenerate SOP with a newer asset
Invoke-WebRequest failed,Network or GitHub rate limit issue,1. Retry later 2. Verify network access to github.com
5. Notes
- Repo: ${repoFullName}

- Tag: ${tagName || 'latest'}

- Asset: ${assetName}

- URL: ${downloadUrl}

`;
}

function buildStoreSopMarkdown(packageInfo = {}, options = {}) {
    const packageName = String(packageInfo.name || packageInfo.id || 'Unknown Package').trim();
    const packageId = String(packageInfo.id || '').trim();
    const source = String(options.source || packageInfo.source || 'winget').trim() || 'winget';
    const category = String(options.category || source).trim() || 'winget store';
    const titleVerb = String(options.titleVerb || 'Install').trim() || 'Install';
    const sopId = `${slugifyWingetPackage(source)}_${slugifyWingetPackage(packageId || packageName)}`;
    const packageIdRegex = escapeRegExp(packageId);
    const packageNameRegex = escapeRegExp(packageName);
    const uninstallSourceFlag = source === 'winget' ? '' : ` --source ${source}`;
    const installSourceFlag = source === 'winget' ? '' : ` --source ${source}`;
    return `# Visual Agent SOP File v1
1. Metadata
ID: ${sopId}

Name: ${titleVerb} ${packageName}

Category: ${category}

Risk Level: Low
2. Prerequisites
OS: Windows 10 / 11
Permissions: Standard User
Network: Required (download via winget)
3. Execution Steps
## Check
Expected Result: Return True when the package is already installed.
\`\`\`powershell
try {
    $result = (& winget list --id ${packageId} --exact --accept-source-agreements 2>&1 | Out-String)
    if ($LASTEXITCODE -eq 0 -and ($result -match "${packageIdRegex}" -or $result -match "${packageNameRegex}")) {
        $true
    } else {
        $false
    }


} catch {
    $false
}


\`\`\`
## Install
\`\`\`powershell
Write-Host "Installing ${packageName} via winget. Please wait..."
if (-not (Get-Command winget -ErrorAction Ignore)) {
    throw "winget is not available. Please install or update Microsoft App Installer first."
}


& winget install --id ${packageId} --exact${installSourceFlag} --silent --accept-package-agreements --accept-source-agreements --disable-interactivity
if ($LASTEXITCODE -ne 0) {
    Write-Host "winget install returned a non-zero exit code: $LASTEXITCODE. Verifying actual install state..."
}


$installed = $false
for ($i = 0; $i -lt 30; $i++) {
    Start-Sleep -Seconds 2
    $result = (& winget list --id ${packageId} --exact --accept-source-agreements 2>&1 | Out-String)
    if ($LASTEXITCODE -eq 0 -and ($result -match "${packageIdRegex}" -or $result -match "${packageNameRegex}")) {
        $installed = $true
        break
    }


}


if (-not $installed) {
    throw "winget finished but ${packageName} still cannot be detected. Check the source, network, or interactive installer behavior."
}


\`\`\`
## Verify
\`\`\`powershell
try {
    $result = (& winget list --id ${packageId} --exact --accept-source-agreements 2>&1 | Out-String)
    if ($LASTEXITCODE -eq 0 -and ($result -match "${packageIdRegex}" -or $result -match "${packageNameRegex}")) {
        $true
    } else {
        throw "${packageName} verification failed."
    }


} catch {
    $false
}


\`\`\`
## Uninstall
\`\`\`powershell
Write-Host "Uninstalling ${packageName} via winget. Please wait..."
if (-not (Get-Command winget -ErrorAction Ignore)) {
    throw "winget is not available. Please install or update Microsoft App Installer first."
}


& winget uninstall --id ${packageId} --exact${uninstallSourceFlag} --silent --accept-source-agreements --disable-interactivity
if ($LASTEXITCODE -ne 0) {
    Write-Host "winget uninstall returned a non-zero exit code: $LASTEXITCODE. Verifying actual uninstall state..."
}


$removed = $false
for ($i = 0; $i -lt 30; $i++) {
    Start-Sleep -Seconds 2
    $result = (& winget list --id ${packageId} --exact --accept-source-agreements 2>&1 | Out-String)
    if (-not ($result -match "${packageIdRegex}") -and -not ($result -match "${packageNameRegex}")) {
        $removed = $true
        break
    }


}


if (-not $removed) {
    throw "winget finished but ${packageName} is still detected. Check whether an interactive uninstaller is still pending."
}


\`\`\`
4. Error Handling
Error Code / Message,Possible Cause,AI Auto Fix
No package found,winget cannot find the requested package,1. Verify the package id 2. Search winget again
winget is not available,Microsoft App Installer is missing,1. Install or update Microsoft App Installer
`;
}

function buildMicrosoftStoreSopMarkdown(packageInfo = {}) {
    return buildStoreSopMarkdown(packageInfo, {
        source: 'msstore',
        category: 'microsoft store',
        titleVerb: 'Install',
    });
}

function isUsefulGitHubAsset(asset = {}) {
    const name = String(asset?.name || '').toLowerCase();
    if (!name) return false;
    if (!/\.(exe|msi|zip)$/.test(name)) return false;
    if (/sha|checksum|checksums|sig|asc|symbols|debug|source[\s._-]*code/.test(name)) return false;
    return true;
}


module.exports = {
    buildWingetSopMarkdown,
    buildStoreSopMarkdown,
    buildMicrosoftStoreSopMarkdown,
    buildGitHubReleaseSopMarkdown,
    pickBestGitHubAsset,
    scoreGitHubAsset,
    isUsefulGitHubAsset,
};
