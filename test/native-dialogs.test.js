'use strict';
const assert = require('node:assert/strict');
const path = require('node:path');
const { buildSaveFileDialogScript, pickSaveFilePath } = require(path.join(__dirname, '..', 'src', 'native-dialogs.js'));

let passed = 0;
function ok(name, condition) {
    assert.ok(condition, name);
    passed++;
}

const script = buildSaveFileDialogScript({
    filter: 'JSON Files (*.json)|*.json|All Files (*.*)|*.*',
    fileName: 'tasks.json',
    title: 'Export Tasks',
    initialDirectory: 'MyDocuments',
});
ok('adds WinForms and SaveFileDialog', script.includes('Add-Type -AssemblyName System.Windows.Forms')
    && script.includes('New-Object System.Windows.Forms.SaveFileDialog'));
ok('writes filter, name, title, folder', script.includes("$dlg.Filter = 'JSON Files (*.json)|*.json|All Files (*.*)|*.*'")
    && script.includes("$dlg.FileName = 'tasks.json'")
    && script.includes("$dlg.Title = 'Export Tasks'")
    && script.includes("[Environment]::GetFolderPath('MyDocuments')"));
ok('prints the selected path only on OK', script.includes('if ($res -eq [System.Windows.Forms.DialogResult]::OK)')
    && script.includes('Write-Output $dlg.FileName'));
ok('defaults to MyDocuments', buildSaveFileDialogScript({}).includes("[Environment]::GetFolderPath('MyDocuments')"));

const escaped = buildSaveFileDialogScript({ title: "Bob's export" });
ok('escapes single quotes for PowerShell', escaped.includes("$dlg.Title = 'Bob''s export'"));

let received = '';
const picked = pickSaveFilePath({ fileName: 'chosen.json' }, (dialogScript) => {
    received = dialogScript;
    return '  C:/tmp/chosen.json\r\n';
});
ok('passes the built script to the runner', received.includes("$dlg.FileName = 'chosen.json'"));
ok('trims the picked path', picked === 'C:/tmp/chosen.json');
ok('returns empty string when cancelled', pickSaveFilePath({}, () => '  \n') === '');

console.log(`\n[native-dialogs.test] ${passed} passed`);
