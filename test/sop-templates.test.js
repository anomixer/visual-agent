'use strict';

const assert = require('node:assert/strict');
const { test } = require('node:test');
const {
    buildWingetSopMarkdown,
    buildStoreSopMarkdown,
    buildMicrosoftStoreSopMarkdown,
    buildGitHubReleaseSopMarkdown,
    pickBestGitHubAsset,
    scoreGitHubAsset,
    isUsefulGitHubAsset,
} = require('../src/agent/sop-templates');

test('winget template keeps the standard SOP sections and skips --source', () => {
    const markdown = buildWingetSopMarkdown({ id: 'Microsoft.VisualStudioCode', name: 'Visual Studio Code' });
    assert.match(markdown, /^# Visual Agent SOP File v1/);
    assert.match(markdown, /^ID: winget_microsoft-visualstudiocode$/m);
    for (const section of ['## Check', '## Install', '## Verify', '## Uninstall', '4. Error Handling']) {
        assert.ok(markdown.includes(section), `Missing ${section}`);
    }
    assert.ok(!markdown.includes('--source winget'));
});

test('msstore template adds the msstore source flag to install and uninstall', () => {
    const markdown = buildMicrosoftStoreSopMarkdown({ id: '9NBLGGH4NNS1', name: 'Xbox' });
    assert.match(markdown, /^ID: msstore_9nblggh4nns1$/m);
    assert.equal((markdown.match(/--source msstore/g) || []).length, 2);
});

test('store template escapes regex metacharacters from package fields', () => {
    const markdown = buildStoreSopMarkdown({ id: 'Vendor.App+Preview', name: 'App (Preview)' });
    assert.ok(markdown.includes('Vendor\\.App\\+Preview'));
    assert.ok(markdown.includes('App \\(Preview\\)'));
});

test('github template escapes single quotes for PowerShell string literals', () => {
    const markdown = buildGitHubReleaseSopMarkdown({
        fullName: 'owner/tool',
        name: 'Tool',
        assetName: "tool's-setup.exe",
        downloadUrl: "https://example.com/tool's-setup.exe",
        tagName: 'v1.0.0',
    });
    assert.match(markdown, /^ID: github_owner-tool_tool-s-setup-exe$/m);
    assert.ok(markdown.includes("tool''s-setup.exe"), 'Asset name must escape PowerShell quotes');
    assert.ok(markdown.includes("https://example.com/tool''s-setup.exe"));
    assert.ok(markdown.includes('Tag: v1.0.0'));
});

test('github asset filtering rejects checksums and non-installers', () => {
    assert.equal(isUsefulGitHubAsset({ name: 'tool-setup.exe' }), true);
    assert.equal(isUsefulGitHubAsset({ name: 'tool.zip' }), true);
    assert.equal(isUsefulGitHubAsset({ name: 'checksums.txt' }), false);
    assert.equal(isUsefulGitHubAsset({ name: 'tool.exe.sha256' }), false);
    assert.equal(isUsefulGitHubAsset({ name: 'source-code.zip' }), false);
    assert.equal(isUsefulGitHubAsset({ name: '' }), false);
});

test('github asset scoring prefers installers and penalises checksums and arm64', () => {
    assert.ok(scoreGitHubAsset({ name: 'Tool-Setup-x64.exe' }) > scoreGitHubAsset({ name: 'Tool-arm64.exe' }));
    assert.ok(scoreGitHubAsset({ name: 'Tool-Setup-x64.exe' }) > scoreGitHubAsset({ name: 'Tool-symbols.zip' }));
});

test('pickBestGitHubAsset chooses the highest scoring usable asset and keeps release metadata', () => {
    const best = pickBestGitHubAsset([
        { tag_name: 'v1', assets: [{ name: 'tool-arm64.zip', browser_download_url: 'https://example.com/arm.zip', size: 1 }] },
        {
            tag_name: 'v2',
            assets: [
                { name: 'checksums.txt', browser_download_url: 'https://example.com/sums.txt', size: 1 },
                { name: 'Tool-Setup-x64.exe', browser_download_url: 'https://example.com/setup.exe', size: 42 },
            ],
        },
    ]);
    assert.deepEqual(
        { tagName: best.tagName, assetName: best.assetName, downloadUrl: best.downloadUrl },
        { tagName: 'v2', assetName: 'Tool-Setup-x64.exe', downloadUrl: 'https://example.com/setup.exe' }
    );
    assert.equal(pickBestGitHubAsset([]), null);
    assert.equal(pickBestGitHubAsset([{ tag_name: 'v1', assets: [] }]), null);
});

console.log('\n[sop-templates.test] 7 passed');
