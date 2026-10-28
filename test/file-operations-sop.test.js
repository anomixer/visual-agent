'use strict';
const assert = require('node:assert/strict');
const path = require('node:path');
const { parseSOPFile } = require(path.join(__dirname, '..', 'src', 'sop-parser.js'));

let passed = 0;
const cases = [
    {
        slug: 'backup-user-files',
        id: 'sys_backup_user_files',
        sourceVariable: '$source',
    },
    {
        slug: 'restore-user-files',
        id: 'sys_restore_user_files',
        sourceVariable: '$backup',
    },
];

for (const testCase of cases) {
    const sop = parseSOPFile(path.join(__dirname, '..', 'sops', testCase.slug, 'SOP.md'));
    assert.equal(sop.id, testCase.id);
    assert.equal(sop.steps.check.commands.length, 1);
    assert.match(sop.steps.check.commands[0], /\$false/);
    assert.doesNotMatch(sop.steps.check.commands[0], /\$true/);
    passed++;

    assert.equal(sop.steps.install.commands.length, 1);
    assert.match(sop.steps.install.commands[0], /robocopy .+ \/E\b/i);
    assert.doesNotMatch(sop.steps.install.commands[0], /\/MIR\b/i);
    assert.doesNotMatch(sop.steps.install.commands[0], /Remove-Item\b/i);
    passed++;

    assert.equal(sop.steps.verify.commands.length, 1);
    const verify = sop.steps.verify.commands[0];
    assert.ok(verify.includes(testCase.sourceVariable));
    assert.match(verify, /Get-ChildItem .+ -Recurse -File -Force/i);
    assert.match(verify, /\.Length -ne \$file\.Length/);
    assert.match(verify, /\$true/);
    passed++;

    assert.equal(sop.steps.uninstall.commands.length, 0);
    passed++;
}

console.log(`\n[file-operations-sop.test] ${passed} passed`);
